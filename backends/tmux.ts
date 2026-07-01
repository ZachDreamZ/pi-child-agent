import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import { SessionBackend } from "./base.js";

export class TmuxBackend extends SessionBackend {
  name = "tmux";
  private sessions: Set<string> = new Set();

  async start(cwd: string, scratchPath: string, logPath: string): Promise<{ pid: number }> {
    const sessionId = `pi_child_${Date.now()}`;
    
    // Create a detached tmux session
    // We run a shell in the session that redirects output to our log file
    const startCmd = `tmux new-session -d -s ${sessionId} 'sh -c "cd ${scratchPath} && exec bash 2>&1 | tee ${logPath}"'`;
    
    try {
      execSync(startCmd);
    } catch (e) {
      throw new Error(`Failed to start tmux session: ${e}`);
    }

    this.sessions.add(sessionId);

    // Tmux doesn't have a single PID for the session in the way we want, 
    // but we can find the PID of the pane.
    const pidStr = execSync(`tmux pid-of -t ${sessionId}`).toString().trim();
    return { pid: parseInt(pidStr) };
  }

  async send(id: string, command: string): Promise<void> {
    // id here is the sessionId (mapped by manager)
    try {
      execSync(`tmux send-keys -t ${id} "${command}" C-m`);
    } catch (e) {
      throw new Error(`Failed to send command to tmux session ${id}: ${e}`);
    }
  }

  async read(id: string): Promise<string> {
    try {
      return execSync(`tmux capture-pane -p -t ${id}`).toString();
    } catch (e) {
      throw new Error(`Failed to read tmux pane ${id}: ${e}`);
    }
  }

  async stop(id: string): Promise<void> {
    try {
      execSync(`tmux kill-session -t ${id}`);
    } catch (e) {
      // Session might already be gone
    }
    this.sessions.delete(id);
  }

  async isAlive(id: string): Promise<boolean> {
    try {
      execSync(`tmux has-session -t ${id}`);
      return true;
    } catch {
      return false;
    }
  }
}
