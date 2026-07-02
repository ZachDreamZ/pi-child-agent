import { spawn, ChildProcess, execSync } from "node:child_process";
import fs from "node:fs";
import { SessionBackend } from "./base.js";
import { killProcessTree } from "../utils/process.js";

/**
 * WindowsNativeBackend
 *
 * Architecture:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  Node.js (this backend)                                 │
 *   │   • send() → writes safe-looking command chunk to stdin │
 *   │   • stdout/stderr → piped to log file                   │
 *   │   • stop() → killProcessTree(PID)                       │
 *   └────────────────────┬────────────────────────────────────┘
 *                        │ spawn(…, { shell: true })
 *                        ▼
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  Shell process (cmd /d /q or pwsh REPL)                 │
 *   │   • reads lines from stdin                              │
 *   │   • dispatches via cmd /c sub-process (never iex)       │
 *   │   • exits on [PICA_EXIT] sentinel                       │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Security:
 *   • The shell REPL never calls Invoke-Expression / iex.
 *   • Every command is dispatched via 'cmd /c $line' (cmd.exe sub-process).
 *   • High-risk checking happens on the Node side BEFORE dispatch.
 *   • Environment is scrubbed of sensitive keys before spawn.
 */
export class WindowsNativeBackend extends SessionBackend {
  name = "windows-native";
  /** Return the detected shell dialect for sentinel wrapping */
  get shellType(): string { return this.shellType_; }
  private processes: Map<string, ChildProcess> = new Map();
  private shellType_: "cmd" | "pwsh" | "powershell" = "cmd";

  private detectShell(): string {
    const shells = ["pwsh", "powershell", "cmd"];
    for (const shell of shells) {
      try {
        execSync(`where ${shell} 2>nul`, { stdio: "pipe" });
        return shell;
      } catch {
        continue;
      }
    }
    throw new Error("No suitable Windows shell found (pwsh, powershell, or cmd).");
  }

  /**
   * Strip sensitive environment variables before passing to child process.
   */
  private filterEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const filtered = { ...env };
    const sensitiveKeys = [
      "API_KEY", "TOKEN", "SECRET", "PASSWORD", "SSH_AUTH_SOCK",
      "AWS_SECRET", "AZURE_SECRET", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
    ];
    for (const key of Object.keys(filtered)) {
      if (sensitiveKeys.some(s => key.toUpperCase().includes(s))) {
        delete filtered[key];
      }
    }
    return filtered;
  }

  async start(cwd: string, scratchPath: string, logPath: string): Promise<{ pid: number }> {
    const shell = this.detectShell();
    this.shellType_ = shell as typeof this.shellType_;
    const logStream = fs.createWriteStream(logPath, { flags: "a" });

    // ── Build the REPL command string ─────────────────────────────────────
    //
    //   cmd.exe:  /d /q  — stays interactive reading from stdin using
    //             a FOR loop that dispatches each line via cmd /c.
    //
    //       The FOR loop reads stdin, executes each non-empty line through
    //       a cmd /c sub-process (never iex), and echoes a sentinel line
    //       so the Node side can detect command boundaries.
    //
    //   pwsh/powershell:  A while(1) loop reading [Console]::In.ReadLine()
    //             and dispatching via cmd /c (still through cmd.exe sub-shell).
    //             This avoids ever calling Invoke-Expression.
    //
    let cmd: string;

    if (shell === "cmd") {
      // cmd /d /q  + FOR /F loop that reads stdin and executes each line
      // via cmd /c, outputting a boundary sentinel after each command.
      cmd = `${shell} /d /q /v:on /c "(for /f \"delims=\" %l in ('more') do @if not \"%l\"==\"\" cmd /c \"%l\" & echo.[PICA_DONE])"`;
    } else if (shell === "pwsh") {
      // pwsh REPL — uses [Console]::In.ReadLine(), dispatches via cmd /c
      cmd = `${shell} -NoProfile -NonInteractive -Command "Set-Location '${scratchPath}'; while(` +
        `$true){` +
        `try{$l=[Console]::In.ReadLine()}catch{break}` +
        `if($l -eq $null -or $l -eq '[PICA_EXIT]'){break}` +
        `try{cmd /c $l 2>&1}catch{}` +
        `echo '[PICA_DONE]'}`;
    } else {
      // powershell (Windows PowerShell 5.1) — same REPL as pwsh
      cmd = `${shell} -NoProfile -NonInteractive -Command "Set-Location '${scratchPath}'; while(` +
        `$true){` +
        `try{$l=[Console]::In.ReadLine()}catch{break}` +
        `if($l -eq $null -or $l -eq '[PICA_EXIT]'){break}` +
        `try{cmd /c $l 2>&1}catch{}` +
        `echo '[PICA_DONE]'}`;
    }

    const child = spawn(cmd, [], {
      cwd,
      shell: true,
      windowsHide: true,
      env: this.filterEnv(process.env),
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdout?.on("data", (data: Buffer) => logStream.write(data));
    child.stderr?.on("data", (data: Buffer) => logStream.write(data));

    child.on("exit", () => {
      logStream.end();
      const pidStr = child.pid?.toString();
      if (pidStr) this.processes.delete(pidStr);
    });

    if (!child.pid) throw new Error("Failed to obtain PID for Windows child process.");

    const pidStr = child.pid.toString();
    this.processes.set(pidStr, child);

    // Give shell time to start
    await new Promise(r => setTimeout(r, 500));

    return { pid: child.pid };
  }

  async send(id: string, command: string): Promise<void> {
    const session = this.processes.get(id);
    if (!session) throw new Error(`No active process found for ID ${id}`);
    if (!session.stdin?.writable) throw new Error("Stdin is not writable (process may have exited)");

    // Log the command being sent (goes to both the shell's stdout and the log file)
    session.stdin.write(`echo.[PICA_CMD] ${command}\r\n`);
    // Execute the actual command
    session.stdin.write(command + "\r\n");
  }

  async read(id: string): Promise<string> {
    return "Logs are streamed to the log file. Use manager.readLog()";
  }

  async stop(id: string): Promise<void> {
    const proc = this.processes.get(id);
    if (!proc) return;
    try {
      // Send exit sentinel first (clean shutdown)
      if (proc.stdin?.writable) {
        proc.stdin.write("[PICA_EXIT]\r\n");
        await new Promise(r => setTimeout(r, 200));
      }
      await killProcessTree(parseInt(id));
    } catch {
      // Process may already be dead
    }
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
