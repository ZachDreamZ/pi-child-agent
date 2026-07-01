import { spawn, ChildProcess } from "node:child_process";
import fs from "node:fs";
import { SessionBackend } from "./base.js";
import { killProcessTree } from "../utils/process.js";

export class LocalShellBackend extends SessionBackend {
  name = "local-shell";
  private processes: Map<string, ChildProcess> = new Map();

  async start(cwd: string, scratchPath: string, logPath: string): Promise<{ pid: number }> {
    const logStream = fs.createWriteStream(logPath, { flags: "a" });

    // Start a basic bash shell in the scratch directory
    const child = spawn("bash", ["-c", `cd ${scratchPath} && exec bash`], {
      cwd,
      shell: true
    });

    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);

    if (!child.pid) throw new Error("Failed to obtain PID for local shell process.");
    
    this.processes.set(child.pid!.toString(), child);

    return { pid: child.pid };
  }

  async send(id: string, command: string): Promise<void> {
    const session = this.processes.get(id);
    if (!session) throw new Error(`No active process found for ID ${id}`);
    session.stdin?.write(command + "\n");
  }

  async read(id: string): Promise<string> {
    return "Logs are streamed to the log file.";
  }

  async stop(id: string): Promise<void> {
    const pid = parseInt(id);
    await killProcessTree(pid);
    this.processes.delete(id);
  }

  async isAlive(id: string): Promise<boolean> {
    const proc = this.processes.get(id);
    if (!proc) return false;
    try {
      process.kill(proc.pid!, 0);
      return true;
    } catch {
      return false;
    }
  }
}
