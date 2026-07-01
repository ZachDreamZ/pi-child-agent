export type PolicyMode = "strict" | "standard" | "trusted";

export interface SecurityPolicy {
  allowWorkspaceWrite: boolean;
  allowNetworkCommands: boolean;
  allowPackageInstall: boolean;
  allowGitWrite: boolean;
  allowSecretForwarding: boolean;
  requireApprovalForHighRisk: boolean;
  blockedCommands: string[];
  allowedCommands: string[];
  protectedPaths: string[];
}

export const DEFAULT_POLICIES: Record<PolicyMode, SecurityPolicy> = {
  strict: {
    allowWorkspaceWrite: false,
    allowNetworkCommands: false,
    allowPackageInstall: false,
    allowGitWrite: false,
    allowSecretForwarding: false,
    requireApprovalForHighRisk: true,
    blockedCommands: [],
    allowedCommands: [],
    protectedPaths: [],
  },
  standard: {
    allowWorkspaceWrite: false,
    allowNetworkCommands: true,
    allowPackageInstall: false,
    allowGitWrite: false,
    allowSecretForwarding: false,
    requireApprovalForHighRisk: true,
    blockedCommands: [],
    allowedCommands: [],
    protectedPaths: [],
  },
  trusted: {
    allowWorkspaceWrite: true,
    allowNetworkCommands: true,
    allowPackageInstall: true,
    allowGitWrite: true,
    allowSecretForwarding: false,
    requireApprovalForHighRisk: true,
    blockedCommands: [],
    allowedCommands: [],
    protectedPaths: [],
  },
};

export function resolvePolicy(config: any): SecurityPolicy {
  const mode = (config.policyMode as PolicyMode) || "standard";
  const base = DEFAULT_POLICIES[mode] || DEFAULT_POLICIES.standard;

  return {
    ...base,
    allowWorkspaceWrite: config.allowWorkspaceWrite ?? base.allowWorkspaceWrite,
    allowNetworkCommands: config.allowNetworkCommands ?? base.allowNetworkCommands,
    allowPackageInstall: config.allowPackageInstall ?? base.allowPackageInstall,
    allowGitWrite: config.allowGitWrite ?? base.allowGitWrite,
    allowSecretForwarding: config.allowSecretForwarding ?? base.allowSecretForwarding,
    requireApprovalForHighRisk: config.requireApprovalForHighRisk ?? base.requireApprovalForHighRisk,
    blockedCommands: config.blockedCommands || base.blockedCommands,
    allowedCommands: config.allowedCommands || base.allowedCommands,
    protectedPaths: config.protectedPaths || base.protectedPaths,
  };
}

export interface PolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
}
