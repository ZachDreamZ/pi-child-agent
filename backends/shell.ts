import { spawn, ChildProcess } from "node:child_process";
import fs from "node:fs";
import { SessionBackend } from "./base.js";
import { killProcessTree } from "../utils/process.js";

/**
 * LocalShellBackend — spawns a local shell (bash on Unix, cmd on Windows).
 *
 * After stop():
 *  - child process is killed (process group on Unix, tree-kill on Windows)
 *  - stdin is closed
 *  - stdout/stderr are un-piped, destroyed, and all listeners removed
 *  - log WriteStream is closed (flushes + releases the fd)
 */
export class LocalShellBackend extends SessionBackend {
  name = "local-shell";
  get shellType(): string { return "bash"; }
  private processes: Map<string, ChildProcess> = new Map();
  private logStreams: Map<string, fs.WriteStream> = new Map();

  async start(cwd: string, scratchPath: string, logPath: string): Promise<{ pid: number }> {
    const logStream = fs.createWriteStream(logPath, { flags: "a" });

    // Start a basic bash shell in the scratch directory
    const child = spawn("bash", ["-c", `cd ${scratchPath} && exec bash`], {
      cwd,
      shell: true,
      detached: process.platform !== "win32",
    });

    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);

    if (!child.pid) throw new Error("Failed to obtain PID for local shell process.");

    const pidStr = child.pid.toString();
    this.processes.set(pidStr, child);
    this.logStreams.set(pidStr, logStream);

    return { pid: child.pid };
  }

  async send(id: string, command: string): Promise<void> {
    const session = this.processes.get(id);
    if (!session) throw new Error(`No active process found for ID ${id}`);
    session.stdin?.write(command + "\n");
  }

  async read(_id: string): Promise<string> {
    return "Logs are streamed to the log file.";
  }

  async stop(id: string): Promise<void> {
    const proc = this.processes.get(id);
    const logStream = this.logStreams.get(id);

    // ── Kill the process ──────────────────────────────────────────────────
    if (proc && proc.pid) {
      try {
        if (process.platform !== "win32") {
          // Unix: kill the whole process group, then force-kill
          try { process.kill(-proc.pid, "SIGTERM"); } catch {}
          await new Promise((r) => setTimeout(r, 200));
          try { process.kill(-proc.pid, "SIGKILL"); } catch {}
        } else {
          // Windows: tree-kill handles the full tree
          await killProcessTree(proc.pid);
        }
      } catch {
        // Process may already be dead — ESRCH is expected
      }
    }

    // ── Close stdin ───────────────────────────────────────────────────────
    try { proc?.stdin?.end(); } catch {}

    // ── Un-pipe + destroy stdout/stderr ───────────────────────────────────
    if (logStream) {
      try { proc?.stdout?.unpipe(logStream); } catch {}
      try { proc?.stderr?.unpipe(logStream); } catch {}
    }
    try { proc?.stdout?.destroy(); } catch {}
    try { proc?.stderr?.destroy(); } catch {}

    // ── Remove all listeners so they don't hold references ────────────────
    try { proc?.removeAllListeners(); } catch {}

    // ── Close the log WriteStream ─────────────────────────────────────────
    if (logStream) {
      try { logStream.end(); } catch {}
      this.logStreams.delete(id);
    }

    // ── Release the child process reference ───────────────────────────────
    this.processes.delete(id);
  }

  async isAlive(id: string): Promise<boolean> {
    const proc = this.processes.get(id);
    if (!proc) return false;
    try {
      process.kill(proc.pid!, 0);
      return true;
    } catch {
      this.processes.delete(id);
      return false;
    }
  }
}
