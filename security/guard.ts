import path from "node:path";
import { isWindows } from "../utils/os.js";

export class SecurityGuard {
  constructor(private protectedPaths: string[]) {}

  isPathProtected(filePath: string): boolean {
    const normalizedPath = path.resolve(filePath);

    for (const protectedPattern of this.protectedPaths) {
      // Component-based matching (no fragile regex escaping)
      const pattern = protectedPattern;
      const pathLower = normalizedPath.toLowerCase();
      const patternLower = pattern.toLowerCase();

      // If pattern has no wildcard, do a simple starts-with check
      if (!pattern.includes("*")) {
        if (pathLower.startsWith(patternLower)) {
          // Ensure it's a proper path prefix (separator or end-of-string after match)
          const after = pathLower.slice(patternLower.length);
          if (after.length === 0 || after[0] === "\\" || after[0] === "/") {
            return true;
          }
        }
        continue;
      }

      // Wildcard pattern: extract prefix (before *) and suffix (after *)
      const starIdx = patternLower.indexOf("*");
      const prefix = patternLower.slice(0, starIdx);
      const suffix = patternLower.slice(starIdx + 1);

      // Check both prefix and suffix with proper path separators
      if (pathLower.startsWith(prefix) && pathLower.includes(suffix)) {
        const afterPrefix = pathLower.slice(prefix.length);
        const suffixIdx = afterPrefix.indexOf(suffix);
        if (suffixIdx >= 0) {
          const wildPart = afterPrefix.slice(0, suffixIdx);
          // Wild part must not contain path separators (single component match)
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

  isHighRiskCommand(command: string): boolean {
    const highRiskPatterns = [
      /rm\s+-rf\s+\/.*$/,
      /format\s+.*$/,
      /mkfs\s+.*$/,
      /reg\s+add\s+.*$/,
      /Set-ExecutionPolicy\s+.*$/,
      /del\s+.*\/Users\/.*$/,
      /rmdir\s+.*\/Users\/.*$/,
    ];

    return highRiskPatterns.some(pattern => pattern.test(command));
  }

  validatePath(filePath: string): { allowed: boolean; reason?: string } {
    if (this.isPathProtected(filePath)) {
      return { allowed: false, reason: `Access to protected path is denied: ${filePath}` };
    }
    return { allowed: true };
  }
}
