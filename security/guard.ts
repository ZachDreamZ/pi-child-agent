import path from "node:path";
import { isWindows } from "../utils/os.js";
import { SecurityPolicy, PolicyDecision, PolicyMode } from "./policy.js";

export class SecurityGuard {
  constructor(private policy: SecurityPolicy) {}

  setPolicy(policy: SecurityPolicy) {
    this.policy = policy;
  }

  private getCommandCategory(command: string): { category: string; severity: PolicyDecision["severity"] } {
    const cmd = command.toLowerCase();

    // Destructive
    if (
      /rm\s+-rf\s+\/.*$/.test(cmd) ||
      /format\s+.*$/.test(cmd) ||
      /diskpart.*$/.test(cmd) ||
      /remove-item\s+-recurse\s+-force\s+c:\\.*$/.test(cmd) ||
      /shutdown.*$/.test(cmd) ||
      /bcdedit.*$/.test(cmd) ||
      /del\s+\/s.*$/.test(cmd) ||
      /rmdir\s+\/s.*$/.test(cmd)
    ) {
      return { category: "destructive", severity: "critical" };
    }

    // Package Install
    if (
      /npm\s+install.*$/.test(cmd) ||
      /pnpm\s+add.*$/.test(cmd) ||
      /yarn\s+add.*$/.test(cmd) ||
      /pip\s+install.*$/.test(cmd) ||
      /winget\s+install.*$/.test(cmd) ||
      /choco\s+install.*$/.test(cmd) ||
      /apt\s+install.*$/.test(cmd) ||
      /apt-get\s+install.*$/.test(cmd)
    ) {
      return { category: "package-install", severity: "medium" };
    }

    // Git Write
    if (
      /git\s+push.*$/.test(cmd) ||
      /git\s+reset\s+--hard.*$/.test(cmd) ||
      /git\s+clean\s+-fd.*$/.test(cmd) ||
      /git\s+commit.*$/.test(cmd) ||
      /git\s+checkout\s+-f.*$/.test(cmd)
    ) {
      return { category: "git-write", severity: "medium" };
    }

    // Network
    if (
      /curl.*$/.test(cmd) ||
      /wget.*$/.test(cmd) ||
      /invoke-webrequest.*$/.test(cmd) ||
      /\biwr\b.*$/.test(cmd) ||
      /netsh.*$/.test(cmd) ||
      /ssh.*$/.test(cmd) ||
      /scp.*$/.test(cmd)
    ) {
      return { category: "network", severity: "low" };
    }

    // Registry
    if (
      /reg\s+add.*$/.test(cmd) ||
      /reg\s+delete.*$/.test(cmd) ||
      /set-itemproperty.*$/.test(cmd) ||
      /new-itemproperty.*$/.test(cmd)
    ) {
      return { category: "registry", severity: "high" };
    }

    // PowerShell Policy
    if (/set-executionpolicy.*$/.test(cmd)) {
      return { category: "powershell-policy", severity: "high" };
    }

    // Secret Access
    if (
      /\.env\b/.test(cmd) ||
      /\.pem\b/.test(cmd) ||
      /\.key\b/.test(cmd) ||
      /id_rsa/.test(cmd) ||
      /\.ssh\b/.test(cmd) ||
      /appdata\b/.test(cmd)
    ) {
      return { category: "secret-access", severity: "critical" };
    }

    return { category: "unknown", severity: "low" };
  }

  checkCommand(command: string): PolicyDecision {
    const { category, severity } = this.getCommandCategory(command);

    // 1. Check explicitly blocked commands
    if (this.policy.blockedCommands.some(bc => command.toLowerCase().includes(bc.toLowerCase()))) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: `Command is explicitly blocked by policy: ${command}`,
        category,
        severity: "critical",
      };
    }

    // 2. Check explicitly allowed commands
    if (this.policy.allowedCommands.some(ac => command.toLowerCase().includes(ac.toLowerCase()))) {
      return {
        allowed: true,
        requiresApproval: false,
        reason: "Command is explicitly allowed by policy.",
        category,
        severity: "low",
      };
    }

    // 3. Category-based rules
    switch (category) {
      case "destructive":
        return {
          allowed: false,
          requiresApproval: this.policy.requireApprovalForHighRisk,
          reason: "Destructive commands are blocked by default.",
          category,
          severity: "critical",
        };
      case "package-install":
        return {
          allowed: this.policy.allowPackageInstall,
          requiresApproval: !this.policy.allowPackageInstall && this.policy.requireApprovalForHighRisk,
          reason: "Package installation requires approval or explicit policy permission.",
          category,
          severity,
        };
      case "git-write":
        return {
          allowed: this.policy.allowGitWrite,
          requiresApproval: !this.policy.allowGitWrite && this.policy.requireApprovalForHighRisk,
          reason: "Git write operations require approval or explicit policy permission.",
          category,
          severity,
        };
      case "network":
        return {
          allowed: this.policy.allowNetworkCommands,
          requiresApproval: !this.policy.allowNetworkCommands && this.policy.requireApprovalForHighRisk,
          reason: "Network commands require approval or explicit policy permission.",
          category,
          severity,
        };
      case "registry":
      case "powershell-policy":
        return {
          allowed: false,
          requiresApproval: this.policy.requireApprovalForHighRisk,
          reason: "System configuration changes require approval.",
          category,
          severity,
        };
      case "secret-access":
        return {
          allowed: false,
          requiresApproval: false,
          reason: "Access to secrets or sensitive credential folders is strictly forbidden.",
          category,
          severity,
        };
      default:
        return {
          allowed: true,
          requiresApproval: false,
          reason: "Command is allowed under current policy.",
          category,
          severity,
        };
    }
  }

  isPathProtected(filePath: string): boolean {
    const normalizedPath = path.resolve(filePath);

    for (const protectedPattern of this.policy.protectedPaths) {
      const pattern = protectedPattern;
      const pathLower = normalizedPath.toLowerCase();
      const patternLower = pattern.toLowerCase();

      if (!pattern.includes("*")) {
        if (pathLower.startsWith(patternLower)) {
          const after = pathLower.slice(patternLower.length);
          if (after.length === 0 || after[0] === "\\" || after[0] === "/") {
            return true;
          }
        }
        continue;
      }

      const starIdx = patternLower.indexOf("*");
      const prefix = patternLower.slice(0, starIdx);
      const suffix = patternLower.slice(starIdx + 1);

      if (pathLower.startsWith(prefix) && pathLower.includes(suffix)) {
        const afterPrefix = pathLower.slice(prefix.length);
        const suffixIdx = afterPrefix.indexOf(suffix);
        if (suffixIdx >= 0) {
          const wildPart = afterPrefix.slice(0, suffixIdx);
          if (!wildPart.includes("\\") && !wildPart.includes("/")) {
            const afterSuffix = afterPrefix.slice(suffixIdx + suffix.length);
            if (afterSuffix.length === 0 || afterSuffix[0] === "\\" || afterSuffix[0] === "/") {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  validatePath(filePath: string): { allowed: boolean; reason?: string } {
    if (this.isPathProtected(filePath)) {
      return { allowed: false, reason: `Access to protected path is denied: ${filePath}` };
    }
    return { allowed: true };
  }
}
