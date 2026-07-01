import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SessionBackend } from "./backends/base.js";
import { getOSType } from "./utils/os.js";
import { ConfigLoader } from "./config/loader.js";
import { SecurityGuard } from "./security/guard.js";
import { Logger } from "./utils/logging.js";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

export interface ChildSession {
  id: string;
  status: "starting" | "running" | "done" | "failed" | "stopped" | "timed_out";
  backendType: string;
  osType: string;
  startTime: number;
  pid?: number;
  logPath: string;
  scratchPath: string;
  backend: SessionBackend;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  timedOut?: boolean;
}

export class ChildSessionManager {
  private sessions: Map<string, ChildSession> = new Map();
  public config: ConfigLoader;
  private guard: SecurityGuard;
  private logger: Logger;
  private baseDir: string;

  constructor(private pi: ExtensionAPI) {
    this.config = new ConfigLoader();
    this.guard = new SecurityGuard(this.config.get("protectedPaths"));
    
    this.baseDir = path.join(os.tmpdir(), "pi-child-agent");
    this.logger = new Logger(path.join(this.baseDir, "logs"));
  }

  async initialize(): Promise<void> {
    await this.logger.ensureDir();
  }

  async createSession(backend: SessionBackend, scratchPath: string, logPath: string): Promise<ChildSession> {
    const id = `child_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    
    // Check limits
    if (this.sessions.size >= this.config.get("maxSimultaneousChildren")) {
      throw new Error("Maximum number of simultaneous child agents reached.");
    }

    // Validate scratch path
    const validation = this.guard.validatePath(scratchPath);
    if (!validation.allowed) {
      throw new Error(validation.reason);
    }

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
        } catch (e) {
          console.error(`Timeout handler failed for session ${id}:`, e);
        }
      }, maxRuntime);
      // unref() the timer so it doesn't keep Node.js alive if all other work is done.
      session.timeoutTimer.unref?.();
    }

    this.sessions.set(id, session);
    return session;
  }

  getSession(id: string): ChildSession | undefined {
    return this.sessions.get(id);
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
  }

  async readLog(id: string): Promise<string> {
    const session = this.getSession(id);
    if (!session) throw new Error(`Session ${id} not found`);
    return await this.logger.read(session.logPath, this.config.get("maxLogSize"));
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
  }
}
