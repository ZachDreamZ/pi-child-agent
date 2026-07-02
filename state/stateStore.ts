import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

export interface PersistedChildSession {
  id: string;
  name?: string;
  status: "starting" | "running" | "done" | "failed" | "stopped" | "timed_out" | "orphaned";
  backendType: string;
  pid?: number;
  startedAt: number;
  stoppedAt?: number;
  scratchPath: string;
  logPath: string;
  policyMode: string;
  lastCommand?: string;
  exitReason?: string;
}

export interface PersistedTask {
  id: string;
  title: string;
  command: string;
  status: "queued" | "running" | "succeeded" | "failed" | "timed_out" | "canceled" | "blocked" | "approval_required" | "interrupted";
  priority: string;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  timeoutMs?: number;
  policyMode: string;
  result?: any;
  error?: string;
  logPath?: string;
  scratchPath?: string;
  childId?: string;
}

export interface PersistentState {
  version: number;
  savedAt: string;
  children: PersistedChildSession[];
  tasks: PersistedTask[];
  metadata: {
    packageVersion: string;
    platform: string;
  };
}

// ──────────────────────────────────────────
// Defaults
// ──────────────────────────────────────────

export function getDefaultStateDir(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, "pi-child-agent", "state");
  }
  return path.join(os.homedir(), ".pi-child-agent", "state");
}

// ──────────────────────────────────────────
// StateStore
// ──────────────────────────────────────────

export class StateStore {
  private stateDir: string;
  private statePath: string;
  private state: PersistentState;
  private enabled: boolean;
  private maxPersistedChildren: number;
  private maxPersistedTasks: number;
  private corruptRecovered: boolean = false;

  constructor(options: {
    stateEnabled?: boolean;
    stateDir?: string;
    stateFile?: string;
    maxPersistedTasks?: number;
    maxPersistedChildren?: number;
    packageVersion?: string;
  } = {}) {
    this.enabled = options.stateEnabled ?? true;
    this.stateDir = options.stateDir || getDefaultStateDir();
    this.statePath = path.join(this.stateDir, options.stateFile || "state.json");
    this.maxPersistedTasks = options.maxPersistedTasks ?? 200;
    this.maxPersistedChildren = options.maxPersistedChildren ?? 100;

    this.state = this.createEmptyState(options.packageVersion || "0.0.0");
  }

  private createEmptyState(packageVersion: string): PersistentState {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      children: [],
      tasks: [],
      metadata: {
        packageVersion,
        platform: process.platform,
      },
    };
  }

  get enabled_(): boolean {
    return this.enabled;
  }

  get statePath_(): string {
    return this.statePath;
  }

  get corruptRecovered_(): boolean {
    return this.corruptRecovered;
  }

  get lastSavedAt_(): string {
    return this.state.savedAt;
  }

  get children_(): PersistedChildSession[] {
    return [...this.state.children];
  }

  get tasks_(): PersistedTask[] {
    return [...this.state.tasks];
  }

  async ensureStateDir(): Promise<void> {
    if (!this.enabled) return;
    await fs.mkdir(this.stateDir, { recursive: true });
  }

  async save(children: PersistedChildSession[], tasks: PersistedTask[]): Promise<void> {
    if (!this.enabled) return;

    // Trim to max limits before saving
    const trimmedChildren = this.trimChildren(children);
    const trimmedTasks = this.trimTasks(tasks);

    this.state = {
      version: 1,
      savedAt: new Date().toISOString(),
      children: trimmedChildren,
      tasks: trimmedTasks,
      metadata: {
        ...this.state.metadata,
      },
    };

    // Atomic write: write to .tmp then rename
    const tmpPath = this.statePath + ".tmp";
    try {
      await fs.mkdir(path.dirname(this.statePath), { recursive: true });
      await fs.writeFile(tmpPath, JSON.stringify(this.state, null, 2), "utf-8");
      await fs.rename(tmpPath, this.statePath);
    } catch (e) {
      // If atomic write fails, try direct write as fallback
      try {
        await fs.writeFile(this.statePath, JSON.stringify(this.state, null, 2), "utf-8");
      } catch (e2) {
        console.error("StateStore: Failed to save state file:", e2);
      }
    }
  }

  async load(): Promise<{ children: PersistedChildSession[]; tasks: PersistedTask[] } | null> {
    if (!this.enabled) return null;

    try {
      const data = await fs.readFile(this.statePath, "utf-8");
      const parsed = JSON.parse(data) as PersistentState;

      // Validate version
      if (!parsed.version || parsed.version < 1) {
        throw new Error("Invalid state version");
      }

      // Validate structure
      if (!Array.isArray(parsed.children) || !Array.isArray(parsed.tasks)) {
        throw new Error("Invalid state structure");
      }

      this.state = parsed;
      this.corruptRecovered = false;
      return {
        children: parsed.children,
        tasks: parsed.tasks,
      };
    } catch (e: any) {
      // Handle corrupt state
      if (e.code === "ENOENT") {
        // File doesn't exist yet — first run
        return null;
      }

      // Corrupt state — rename and start fresh
      const timestamp = Date.now();
      const corruptPath = this.statePath.replace(/\.json$/, `.corrupt.${timestamp}.json`);
      try {
        await fs.rename(this.statePath, corruptPath);
        console.warn(`StateStore: Corrupt state file renamed to ${corruptPath}`);
      } catch (renameErr) {
        console.error("StateStore: Failed to rename corrupt state file:", renameErr);
      }

      this.state = this.createEmptyState(this.state.metadata.packageVersion || "0.0.0");
      this.corruptRecovered = true;
      return {
        children: [],
        tasks: [],
      };
    }
  }

  async clear(): Promise<void> {
    if (!this.enabled) return;

    this.state = this.createEmptyState(this.state.metadata.packageVersion || "0.0.0");
    try {
      await fs.writeFile(this.statePath, JSON.stringify(this.state, null, 2), "utf-8");
    } catch (e) {
      console.error("StateStore: Failed to clear state file:", e);
    }
  }

  async setChildSessions(children: PersistedChildSession[]): Promise<void> {
    this.state.children = this.trimChildren(children);
    await this.save(this.state.children, this.state.tasks);
  }

  async setTasks(tasks: PersistedTask[]): Promise<void> {
    this.state.tasks = this.trimTasks(tasks);
    await this.save(this.state.children, this.state.tasks);
  }

  private trimChildren(children: PersistedChildSession[]): PersistedChildSession[] {
    if (children.length <= this.maxPersistedChildren) return children;
    // Keep newest ones, sorted by startedAt descending
    return children.sort((a, b) => b.startedAt - a.startedAt).slice(0, this.maxPersistedChildren);
  }

  private trimTasks(tasks: PersistedTask[]): PersistedTask[] {
    if (tasks.length <= this.maxPersistedTasks) return tasks;
    // Keep newest ones, sorted by createdAt descending
    return tasks.sort((a, b) => b.createdAt - a.createdAt).slice(0, this.maxPersistedTasks);
  }

  getStatus(): {
    stateEnabled: boolean;
    statePath: string;
    childrenPersisted: number;
    tasksPersisted: number;
    lastSavedAt: string;
    corruptStateRecovered: boolean;
  } {
    return {
      stateEnabled: this.enabled,
      statePath: this.statePath,
      childrenPersisted: this.state.children.length,
      tasksPersisted: this.state.tasks.length,
      lastSavedAt: this.state.savedAt,
      corruptStateRecovered: this.corruptRecovered,
    };
  }
}
