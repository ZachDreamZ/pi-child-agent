import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SessionBackend } from "./backends/base.js";
import { isWindows, getOSType } from "./utils/os.js";
import { ConfigLoader } from "./config/loader.js";
import { SecurityGuard } from "./security/guard.js";
import { resolvePolicy } from "./security/policy.js";
import { Logger } from "./utils/logging.js";
import { collectStructuredResult, StructuredResult } from "./utils/structuredCollect.js";
import { QueueManager } from "./queue/queueManager.js";
import { StateStore, PersistedChildSession, PersistedTask, getDefaultStateDir } from "./state/stateStore.js";
import path from "node:path";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

// Read package version at module load time — always reflects actual release
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_VERSION = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf-8")).version;

export interface ChildSession {
  id: string;
  status: "starting" | "running" | "done" | "failed" | "stopped" | "timed_out" | "orphaned";
  backendType: string;
  osType: string;
  startTime: number;
  pid?: number;
  logPath: string;
  scratchPath: string;
  backend: SessionBackend;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  timedOut?: boolean;
  policyMode?: string;
  lastCommand?: string;
  exitReason?: string;
}

export class ChildSessionManager {
  private sessions: Map<string, ChildSession> = new Map();
  public config: ConfigLoader;
  public guard: SecurityGuard;
  private logger: Logger;
  private baseDir: string;
  public queue: QueueManager;
  public state: StateStore;
  private initialized: boolean = false;

  constructor(private pi: ExtensionAPI, initialConfig?: Partial<import("./config/loader.js").ChildAgentConfig>) {
    this.config = new ConfigLoader(initialConfig);
    this.guard = new SecurityGuard(resolvePolicy(this.config.getConfig()));
    
    const tmpRoot = process.platform === 'win32' 
      ? path.join("C:\\Users\\Public", "pi-child-agent") 
      : path.join(os.tmpdir(), "pi-child-agent");

    this.baseDir = tmpRoot;
    this.logger = new Logger(path.join(this.baseDir, "logs"));
    this.queue = new QueueManager(this, this.guard);

    // Initialize state store
    const cfg = this.config.getConfig();
    this.state = new StateStore({
      stateEnabled: cfg.stateEnabled,
      stateDir: cfg.stateDir || undefined,
      stateFile: cfg.stateFile,
      maxPersistedTasks: cfg.maxPersistedTasks,
      maxPersistedChildren: cfg.maxPersistedChildren,
      packageVersion: PKG_VERSION,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    await this.logger.ensureDir();
    await this.state.ensureStateDir();

    // Startup recovery
    await this.recoverState();
  }

  // ════════════════════════════════════════
  // State Recovery
  // ════════════════════════════════════════

  private async recoverState(): Promise<void> {
    const loaded = await this.state.load();
    if (!loaded) {
      console.log("State recovery: No existing state found (first run).");
      return;
    }

    const cfg = this.config.getConfig();

    // Recover children
    let childrenRecovered = 0;
    let orphanedChildren = 0;
    for (const persisted of loaded.children) {
      // Determine current status based on PID and previous status
      const recoveredStatus = this.reconcileChildStatus(persisted);
      
      if (recoveredStatus === "running" && cfg.persistStoppedChildren) {
        // PID might still be alive — mark as orphaned (we don't reattach)
        const session: ChildSession = {
          id: persisted.id,
          status: "orphaned",
          backendType: persisted.backendType,
          osType: getOSType(),
          startTime: persisted.startedAt,
          pid: persisted.pid,
          logPath: persisted.logPath,
          scratchPath: persisted.scratchPath,
          backend: null as any, // No backend reference for recovered sessions
          policyMode: persisted.policyMode,
          lastCommand: persisted.lastCommand,
          exitReason: "Recovered from persistent state — PID may be stale",
        };
        this.sessions.set(persisted.id, session);
        orphanedChildren++;
        childrenRecovered++;
      } else if (cfg.persistStoppedChildren) {
        const session: ChildSession = {
          id: persisted.id,
          status: recoveredStatus as any,
          backendType: persisted.backendType,
          osType: getOSType(),
          startTime: persisted.startedAt,
          pid: persisted.pid,
          logPath: persisted.logPath,
          scratchPath: persisted.scratchPath,
          backend: null as any,
          policyMode: persisted.policyMode,
          lastCommand: persisted.lastCommand,
          exitReason: persisted.exitReason,
        };
        this.sessions.set(persisted.id, session);
        childrenRecovered++;
      }
    }

    // Recover queue tasks
    let tasksRecovered = 0;
    let interruptedTasks = 0;
    for (const persisted of loaded.tasks) {
      const recoveredStatus = this.reconcileTaskStatus(persisted, cfg);

      if (recoveredStatus === "interrupted") {
        interruptedTasks++;
      }

      // Add to queue in-memory state
      if (recoveredStatus === "queued" && cfg.recoverQueuedTasks) {
        // Re-enqueue as queued
        this.queue.recoverTask({
          id: persisted.id,
          title: persisted.title,
          command: persisted.command,
          status: "queued",
          priority: persisted.priority as any,
          attempts: persisted.attempts,
          maxAttempts: persisted.maxAttempts,
          createdAt: persisted.createdAt,
          startedAt: persisted.startedAt,
          finishedAt: persisted.finishedAt,
          timeoutMs: persisted.timeoutMs,
          policyMode: persisted.policyMode,
          result: persisted.result,
          error: persisted.error,
          logPath: persisted.logPath,
          scratchPath: persisted.scratchPath,
          childId: persisted.childId,
        });
        tasksRecovered++;
      } else if (cfg.persistCompletedTasks) {
        // Add as historical record
        this.queue.recoverTask({
          id: persisted.id,
          title: persisted.title,
          command: persisted.command,
          status: recoveredStatus as any,
          priority: persisted.priority as any,
          attempts: persisted.attempts,
          maxAttempts: persisted.maxAttempts,
          createdAt: persisted.createdAt,
          startedAt: persisted.startedAt,
          finishedAt: persisted.finishedAt,
          timeoutMs: persisted.timeoutMs,
          policyMode: persisted.policyMode,
          result: persisted.result,
          error: persisted.error,
          logPath: persisted.logPath,
          scratchPath: persisted.scratchPath,
          childId: persisted.childId,
        });
        tasksRecovered++;
      }
    }

    console.log(
      `State recovery complete: ${childrenRecovered} children (${orphanedChildren} orphaned), ` +
      `${tasksRecovered} tasks (${interruptedTasks} interrupted)`
    );
  }

  private reconcileChildStatus(persisted: PersistedChildSession): string {
    // If previous status was timed_out, keep it as timed_out
    if (persisted.status === "timed_out") return "timed_out";
    // If previous status was stopped, keep it as stopped
    if (persisted.status === "stopped" || persisted.status === "done" || persisted.status === "failed") {
      return persisted.status;
    }
    // If previous status was running or starting, check if PID is alive
    if (persisted.status === "running" || persisted.status === "starting") {
      // We can't reliably check PID cross-platform without additional tooling
      // Mark as orphaned — user can inspect and clean up
      return "orphaned";
    }
    return persisted.status;
  }

  private reconcileTaskStatus(persisted: PersistedTask, cfg: any): string {
    // Completed statuses stay as-is
    if (["succeeded", "failed", "timed_out", "canceled", "blocked"].includes(persisted.status)) {
      return persisted.status;
    }
    // Queued tasks remain queued if recovery is enabled
    if (persisted.status === "queued" && cfg.recoverQueuedTasks) {
      return "queued";
    }
    // Running or approval_required tasks become interrupted
    if (persisted.status === "running" || persisted.status === "approval_required") {
      return "interrupted";
    }
    return persisted.status;
  }

  // ════════════════════════════════════════
  // State Persistence Helpers
  // ════════════════════════════════════════

  async persistChildrenState(): Promise<void> {
    const persisted: PersistedChildSession[] = [];
    for (const session of this.sessions.values()) {
      persisted.push({
        id: session.id,
        status: session.status,
        backendType: session.backendType,
        pid: session.pid,
        startedAt: session.startTime,
        scratchPath: session.scratchPath,
        logPath: session.logPath,
        policyMode: session.policyMode || "standard",
        lastCommand: session.lastCommand,
        exitReason: session.exitReason,
      });
    }
    await this.state.setChildSessions(persisted);
  }

  async persistTasksState(): Promise<void> {
    const tasks = this.queue.getAllTasks();
    await this.state.setTasks(tasks);
  }

  async persistAllState(): Promise<void> {
    await this.persistChildrenState();
    await this.persistTasksState();
  }

  // ════════════════════════════════════════
  // Session Management
  // ════════════════════════════════════════

  async createSession(backend: SessionBackend, scratchPath: string, logPath: string): Promise<ChildSession> {
    const id = `child_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    
    // Check limits
    if (this.sessions.size >= this.config.get("maxSimultaneousChildren")) {
      throw new Error("Maximum number of simultaneous child agents reached.");
    }

    // Validate scratch path
    const validation = this.guard.validatePath(scratchPath);
    if (!validation.allowed) {
      // Provide a helpful hint for Windows users hitting AppData protection
      const hint = process.platform === 'win32' && scratchPath.toLowerCase().includes('appdata')
        ? ' On Windows, use a path under C:\\Users\\Public\\ instead of AppData.'
        : '';
      throw new Error(validation.reason + hint);
    }

    // Ensure the log directory exists before starting backend
    await fs.mkdir(path.dirname(logPath), { recursive: true });

    // Start the backend
    const { pid } = await backend.start(process.cwd(), scratchPath, logPath);

    const session: ChildSession = {
      id,
      status: "running",
      backendType: backend.name,
      osType: getOSType(),
      startTime: Date.now(),
      pid,
      logPath,
      scratchPath,
      backend,
      policyMode: this.config.get("policyMode"),
    };

    // Enforce max runtime timeout
    const maxRuntime = this.config.get("maxRuntime");
    if (maxRuntime > 0) {
      session.timeoutTimer = setTimeout(async () => {
        const current = this.getSession(id);
        if (!current || current.status !== "running") return;

        // Mark timed out FIRST so stopSession() sees it even if stop throws
        current.timedOut = true;
        current.status = "timed_out";

        try {
          // Log timeout reason
          await this.logger.write(
            current.logPath,
            `[PICA_TIMEOUT] Child agent exceeded max runtime of ${maxRuntime}ms. Stopping.`
          );
          // Stop the child
          const targetId = current.pid ? current.pid.toString() : id;
          await current.backend.stop(targetId);
          // Persist state after timeout
          current.exitReason = "timed_out";
          await this.persistChildrenState();
        } catch (e) {
          console.error(`Timeout handler failed for session ${id}:`, e);
        }
      }, maxRuntime);
      // unref() the timer so it doesn't keep Node.js alive if all other work is done.
      session.timeoutTimer.unref?.();
    }

    this.sessions.set(id, session);
    await this.persistChildrenState();
    return session;
  }

  getSession(id: string): ChildSession | undefined {
    return this.sessions.get(id);
  }

  formatStatus(session: ChildSession): string {
    const statusEmoji = {
      starting: "🟡",
      running: "🟢",
      done: "✅",
      failed: "❌",
      stopped: "🔴",
      timed_out: "⚠️",
      orphaned: "👻",
    }[session.status] || "⚪";

    return [
      `**Session ID**: \`${session.id}\``,
      `**Status**: ${statusEmoji} ${session.status.toUpperCase()}`,
      `**Backend**: \`${session.backendType}\``,
      `**OS**: \`${session.osType}\``,
      `**Started**: ${new Date(session.startTime).toLocaleString()}`,
      `**PID**: \`${session.pid || "N/A"}\``,
      `**Scratch**: \`${session.scratchPath}\``,
    ].join("\n");
  }

  listSessions(): ChildSession[] {
    return Array.from(this.sessions.values());
  }

  async stopSession(id: string): Promise<void> {
    const session = this.getSession(id);
    if (!session) throw new Error(`Session ${id} not found`);

    // Clear timeout timer if active
    if (session.timeoutTimer) {
      clearTimeout(session.timeoutTimer);
      session.timeoutTimer = undefined;
    }

    // Use the PID for backends that require it (Windows/Shell) 
    // or the sessionId for those that do (Tmux/Container)
    const targetId = session.pid ? session.pid.toString() : id;
    await session.backend.stop(targetId);
    session.status = session.timedOut ? "timed_out" : "stopped";
    session.exitReason = session.timedOut ? "timed_out" : "stopped_by_user";
    
    await this.persistChildrenState();
  }

  async readLog(id: string): Promise<string> {
    const session = this.getSession(id);
    if (!session) throw new Error(`Session ${id} not found`);
    return await this.logger.read(session.logPath, this.config.get("maxLogSize"));
  }

  formatLogs(logs: string): string {
    return logs
      .replace(/\[PICA_CMD\] (.*)\n/g, "👉 **Command**: $1\n")
      .replace(/\[PICA_DONE\]\n/g, "✅ **Done**\n")
      .replace(/\[PICA_DONE\]$/g, "✅ **Done**");
  }

  async collect(id: string, structured = false): Promise<string | StructuredResult> {
    const session = this.getSession(id);
    if (!session) throw new Error(`Session ${id} not found`);

    const logs = await this.readLog(id);
    await this.stopSession(id);

    if (structured) {
      const result = collectStructuredResult(session, logs);
      await this.persistChildrenState();
      return result;
    }

    await this.persistChildrenState();
    return logs;
  }

  async cleanupAll(): Promise<void> {
    for (const session of this.listSessions()) {
      try {
        await this.stopSession(session.id);
      } catch (e) {
        console.error(`Failed to stop session ${session.id}:`, e);
      }
    }
    this.sessions.clear();
    await this.persistChildrenState();
  }

  // ════════════════════════════════════════
  // Queue Integration (persist hooks)
  // ════════════════════════════════════════

  async startQueue(maxConcurrent?: number) {
    const result = await this.queue.startQueue(maxConcurrent);
    await this.persistTasksState();
    return result;
  }

  async stopQueue() {
    await this.queue.stopQueue();
    await this.persistTasksState();
  }

  async enqueueTask(data: any) {
    const task = await this.queue.enqueue(data);
    await this.persistTasksState();
    return task;
  }

  async getQueueStatus() {
    return this.queue.getQueueStatus();
  }

  async cancelTask(id: string) {
    const result = await this.queue.cancelTask(id);
    await this.persistTasksState();
    return result;
  }

  async collectTaskResult(id: string) {
    return await this.queue.collectTaskResult(id);
  }

  async clearQueue(options: any) {
    const removed = this.queue.clearCompleted(options);
    await this.persistTasksState();
    return removed;
  }

  // ════════════════════════════════════════
  // State Tools
  // ════════════════════════════════════════

  async getStateStatus() {
    return {
      ...this.state.getStatus(),
      success: true,
    };
  }

  async saveState() {
    await this.persistAllState();
    return {
      success: true,
      savedAt: new Date().toISOString(),
      statePath: this.state.statePath_,
    };
  }

  async loadState() {
    const loaded = await this.state.load();
    if (!loaded) {
      return {
        success: true,
        childrenRecovered: 0,
        tasksRecovered: 0,
        orphanedChildren: 0,
        interruptedTasks: 0,
        message: "No state file found.",
      };
    }

    // Clear current in-memory sessions/tasks and reload
    this.sessions.clear();
    this.queue.clearAllTasks();

    // Recover
    const orphanedChildren: string[] = [];
    const interruptedTasks: string[] = [];

    for (const persisted of loaded.children) {
      const recoveredStatus = this.reconcileChildStatus(persisted);
      if (recoveredStatus === "orphaned") orphanedChildren.push(persisted.id);
      
      this.sessions.set(persisted.id, {
        id: persisted.id,
        status: recoveredStatus as any,
        backendType: persisted.backendType,
        osType: getOSType(),
        startTime: persisted.startedAt,
        pid: persisted.pid,
        logPath: persisted.logPath,
        scratchPath: persisted.scratchPath,
        backend: null as any,
        policyMode: persisted.policyMode,
        lastCommand: persisted.lastCommand,
        exitReason: persisted.exitReason || "Recovered from state",
      });
    }

    const cfg = this.config.getConfig();
    for (const persisted of loaded.tasks) {
      const recoveredStatus = this.reconcileTaskStatus(persisted, cfg);
      if (recoveredStatus === "interrupted") interruptedTasks.push(persisted.id);

      this.queue.recoverTask({
        id: persisted.id,
        title: persisted.title,
        command: persisted.command,
        status: recoveredStatus as any,
        priority: persisted.priority as any,
        attempts: persisted.attempts,
        maxAttempts: persisted.maxAttempts,
        createdAt: persisted.createdAt,
        startedAt: persisted.startedAt,
        finishedAt: persisted.finishedAt,
        timeoutMs: persisted.timeoutMs,
        policyMode: persisted.policyMode,
        result: persisted.result,
        error: persisted.error,
        logPath: persisted.logPath,
        scratchPath: persisted.scratchPath,
        childId: persisted.childId,
      });
    }

    return {
      success: true,
      childrenRecovered: loaded.children.length,
      tasksRecovered: loaded.tasks.length,
      orphanedChildren: orphanedChildren.length,
      interruptedTasks: interruptedTasks.length,
    };
  }

  async clearState(confirm: boolean, includeHistory: boolean) {
    if (!confirm) {
      return {
        success: false,
        cleared: false,
        error: "Confirmation required. Set confirm: true to clear state.",
      };
    }

    // Clear state file (does not kill active processes)
    await this.state.clear();

    // If includeHistory, also clear in-memory completed sessions/tasks
    if (includeHistory) {
      // Only clear non-active items from in-memory maps
      for (const [id, session] of this.sessions) {
        if (session.status !== "running" && session.status !== "starting") {
          this.sessions.delete(id);
        }
      }
      this.queue.clearAllHistory();
    }

    return {
      success: true,
      cleared: true,
      statePath: this.state.statePath_,
    };
  }
}
