import path from "node:path";

export type BackendMode = "auto" | "tmux" | "windows-native" | "docker" | "podman" | "local-shell";

export interface ChildAgentConfig {
  queueEnabled: boolean;
  maxConcurrentTasks: number;
  defaultTaskMaxAttempts: number;
  cleanupTaskChildren: boolean;
  taskResultStructured: boolean;
  policyMode: "strict" | "standard" | "trusted";
  backendMode: BackendMode;
  defaultShell: string;
  maxRuntime: number; // in milliseconds
  maxLogSize: number; // in bytes
  maxSimultaneousChildren: number;
  workspaceReadOnly: boolean;
  containerImage: string;
  secretForwarding: boolean;
  protectedPaths: string[];
  requireApprovalForHighRisk: boolean;
}

const DEFAULT_CONFIG: ChildAgentConfig = {
  queueEnabled: true,
  maxConcurrentTasks: 2,
  defaultTaskMaxAttempts: 1,
  cleanupTaskChildren: true,
  taskResultStructured: true,
  policyMode: "standard",
  backendMode: "auto",
  defaultShell: "", // Determined by OS
  maxRuntime: 3600000, // 1 hour
  maxLogSize: 10 * 1024 * 1024, // 10 MB
  maxSimultaneousChildren: 5,
  workspaceReadOnly: true,
  containerImage: "node:latest",
  secretForwarding: false,
  protectedPaths: [
    "C:\\Windows",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "C:\\Users\\*\\AppData",
    "C:\\Users\\*\\.ssh",
    "C:\\Users\\*\\.aws",
    "C:\\Users\\*\\.azure",
    "C:\\Users\\*\\.docker",
    "/etc",
    "/root",
    "/boot",
    "/sys",
    "/proc",
  ],
  requireApprovalForHighRisk: true,
};

export class ConfigLoader {
  private config: ChildAgentConfig;

  constructor(initialConfig: Partial<ChildAgentConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...initialConfig };
  }

  get<K extends keyof ChildAgentConfig>(key: K): ChildAgentConfig[K] {
    return this.config[key];
  }

  set<K extends keyof ChildAgentConfig>(key: K, value: ChildAgentConfig[K]): void {
    this.config[key] = value;
  }

  getConfig(): ChildAgentConfig {
    return { ...this.config };
  }
}
