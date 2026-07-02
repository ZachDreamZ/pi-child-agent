import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import { SessionBackend } from "./base.js";

export class ContainerBackend extends SessionBackend {
  name = "container";
  get shellType(): string { return "bash"; }
  private binary: string = "docker";
  private image: string = "node:latest";

  constructor(options: { binary?: string; image?: string }) {
    super();
    if (options.binary) this.binary = options.binary;
    if (options.image) this.image = options.image;
  }

  async start(cwd: string, scratchPath: string, logPath: string): Promise<{ pid: number }> {
    const containerId = `pi_child_${Date.now()}`;
    
    // We run the container in the background with a sleep infinity to keep it alive
    // Workspace is mounted RO, scratch is mounted RW
    const runCmd = `${this.binary} run -d --name ${containerId} \\
      -v "${cwd}:/workspace:ro" \\
      -v "${scratchPath}:/scratch:rw" \\
      ${this.image} sleep infinity`;
    
    try {
      const id = execSync(runCmd).toString().trim();
      
      // To handle logs, we can set up a background process that streams docker logs to our log file
      const logProc = spawn(`${this.binary} logs -f ${id}`);
      logProc.stdout?.pipe(fs.createWriteStream(logPath, { flags: "a" }));
      logProc.stderr?.pipe(fs.createWriteStream(logPath, { flags: "a" }));

      // We return a dummy PID or the logProc PID because Docker manages the actual process
      return { pid: logProc.pid || 0 };
    } catch (e) {
      throw new Error(`Failed to start container: ${e}`);
    }
  }

  async send(id: string, command: string): Promise<void> {
    try {
      // Execute command in /scratch directory
      execSync(`${this.binary} exec ${id} sh -c "cd /scratch && ${command}"`);
    } catch (e) {
      throw new Error(`Failed to execute command in container ${id}: ${e}`);
    }
  }

  async read(id: string): Promise<string> {
    try {
      return execSync(`${this.binary} logs ${id}`).toString();
    } catch (e) {
      throw new Error(`Failed to read container logs ${id}: ${e}`);
    }
  }

  async stop(id: string): Promise<void> {
    try {
      execSync(`${this.binary} stop ${id}`);
      execSync(`${this.binary} rm ${id}`);
    } catch (e) {
      // Container might already be gone
    }
  }

  async isAlive(id: string): Promise<boolean> {
    try {
      execSync(`${this.binary} inspect ${id}`);
      return true;
    } catch {
      return false;
    }
  }
}
