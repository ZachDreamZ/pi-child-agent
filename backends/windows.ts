import { spawn, ChildProcess, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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
 * Visible mode:
 *   When visible: true is set, the child process spawns with a visible
 *   console window. The REPL echoes commands and sentinels to the
 *   console via > CON (cmd.exe) or Write-Host (pwsh), so the user
 *   can watch execution live on their desktop.
 *
 * Security:
 *   • The shell REPL never calls Invoke-Expression / iex.
 *   • Every command is dispatched via 'cmd /c $line' (cmd.exe sub-process).
 *   • High-risk checking happens on the Node side BEFORE dispatch.
 *   • Environment is scrubbed of sensitive keys before spawn.
 */
export class WindowsNativeBackend extends SessionBackend {
  name = "windows-native";
  private visible: boolean = false;

  constructor(options?: { visible?: boolean }) {
    super();
    if (options?.visible) this.visible = true;
  }

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
    const windowTitle = this.visible ? `Pi Child Agent — ${path.basename(scratchPath)}` : undefined;

    // ── Build the REPL command string ─────────────────────────────────────
    //
    //   Headless mode (default): quiet, pipes output to the log only.
    //   Visible mode: opens a terminal window the user can watch.
    //
    let cmd: string;

    if (shell === "cmd") {
      if (this.visible) {
        // Visible REPL — shows commands and results in the console window
        cmd = `${shell} /d /q /v:on /c "(title ${windowTitle}` +
          ` & echo.` +
          ` & (for /f "delims=" %l in ('more') do @if not "%l"=="" (` +
          `echo.[PICA_CMD] %l` +
          ` & echo [CMD] %l > CON` +
          ` & cmd /c %l` +
          ` & echo.[PICA_DONE]` +
          ` & echo [DONE] > CON)))"`;
      } else {
        // Headless REPL — silent, sentinels go to the pipe only
        cmd = `${shell} /d /q /v:on /c "(for /f "delims=" %l in ('more') do @if not "%l"=="" cmd /c "%l" & echo.[PICA_DONE])"`;
      }
    } else if (shell === "pwsh") {
      if (this.visible) {
        // Visible pwsh — Write-Host for console, echo for pipe
        cmd = `${shell} -NoProfile -NonInteractive -Command "` +
          `$Host.UI.RawUI.WindowTitle='${windowTitle}'; ` +
          `Write-Host '=== Pi Child Agent ===' -ForegroundColor Cyan; ` +
          `Set-Location '${scratchPath}'; ` +
          `while($true){` +
          `try{$l=[Console]::In.ReadLine()}catch{break}` +
          `if($l -eq $null -or $l -eq '[PICA_EXIT]'){break}` +
          `Write-Host "[CMD] $l" -ForegroundColor Yellow; ` +
          `try{cmd /c $l 2>&1}catch{}; ` +
          `echo '[PICA_DONE]'; ` +
          `Write-Host '[DONE]' -ForegroundColor Green}`;
      } else {
        // Headless pwsh
        cmd = `${shell} -NoProfile -NonInteractive -Command "Set-Location '${scratchPath}'; while($true){try{$l=[Console]::In.ReadLine()}catch{break}if($l -eq $null -or $l -eq '[PICA_EXIT]'){break}try{cmd /c $l 2>&1}catch{}echo '[PICA_DONE]'}`;
      }
    } else {
      // powershell (Windows PowerShell 5.1)
      if (this.visible) {
        cmd = `${shell} -NoProfile -NonInteractive -Command "` +
          `$Host.UI.RawUI.WindowTitle='${windowTitle}'; ` +
          `Write-Host '=== Pi Child Agent ===' -ForegroundColor Cyan; ` +
          `Set-Location '${scratchPath}'; ` +
          `while($true){` +
          `try{$l=[Console]::In.ReadLine()}catch{break}` +
          `if($l -eq $null -or $l -eq '[PICA_EXIT]'){break}` +
          `Write-Host "[CMD] $l" -ForegroundColor Yellow; ` +
          `try{cmd /c $l 2>&1}catch{}; ` +
          `echo '[PICA_DONE]'; ` +
          `Write-Host '[DONE]' -ForegroundColor Green}`;
      } else {
        cmd = `${shell} -NoProfile -NonInteractive -Command "Set-Location '${scratchPath}'; while($true){try{$l=[Console]::In.ReadLine()}catch{break}if($l -eq $null -or $l -eq '[PICA_EXIT]'){break}try{cmd /c $l 2>&1}catch{}echo '[PICA_DONE]'}`;
      }
    }

    const child = spawn(cmd, [], {
      cwd,
      shell: true,
      windowsHide: !this.visible,
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
