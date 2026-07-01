# PTY Research for pi-child-agent

## Current Approach

The extension currently uses a **stdin-pipe + log-file** architecture:

1. A shell process (`cmd.exe` on Windows, `bash` on Unix) is spawned with `stdio: ["pipe", "pipe", "pipe"]`
2. Commands are written to `stdin` as text lines
3. `stdout`/`stderr` are piped to a log file
4. The parent reads the log file to see output

**Pros**: Simple, cross-platform, no additional dependencies, works for non-interactive commands.

**Cons**: No PTY attached — programs that require a real terminal will not work correctly:
- Text editors (vim, nano, code)
- SSH sessions
- `npm init` / `dotnet new` wizards
- `docker exec -it` interactive mode
- Password prompts
- Progress bars/TUI applications

## node-pty Approach

[`node-pty`](https://github.com/microsoft/node-pty) provides pseudoterminal (PTY) support:

```typescript
import { spawn } from "node-pty";

const pty = spawn("powershell.exe", [], {
  name: "xterm-color",
  cols: 80,
  rows: 30,
  cwd: scratchPath,
  env: filteredEnv,
});

pty.onData((data) => logStream.write(data));
pty.write(command + "\r\n");
```

**Pros**:
- Full terminal emulation
- Interactive programs work (vim, ssh, docker run -it)
- Proper signal handling (SIGINT, SIGTERM)
- Consistent column/row dimensions

**Cons**:
- **Native compilation required** — `node-pty` uses N-API / node-gyp
- Windows requires Windows Build Tools or `windows-build-tools` npm package
- Adds ~2MB to the extension size
- May fail in restricted environments (corporate laptops, CI runners without build tools)
- Not compatible with all Node.js versions without rebuild

## Windows ConPTY Limitations

Windows 10+ includes the **ConPTY API** (pseudoconsole), but there are limitations:

1. **ConPTY requires a Win32 console host** — spawning from a non-console process (like a Node.js background process) can be tricky
2. **UTF-8 quirks on older Windows 10 builds** (pre-1903)
3. **`node-pty` on Windows uses WinPTY** (third-party DLL) which may trigger antivirus false positives
4. **No built-in Node.js ConPTY binding** — must use `node-pty` or a native addon

## When PTY Is Needed

| Use Case | Current Behavior | PTY Needed? |
|----------|-----------------|-------------|
| `echo`, `dir`, `grep`, `findstr` | ✅ Works | No |
| `node -e "..."` | ✅ Works | No |
| `npm install` | ⚠️ May work (no progress bars) | Nice to have |
| `git clone`, `git log` | ✅ Works | No |
| `ssh user@host` | ❌ Fails | Yes |
| `vim`, `nano` | ❌ Fails | Yes |
| `docker run -it` | ❌ Fails | Yes |
| `powershell` with complex prompts | ⚠️ May have issues | Yes (for interactive use) |

## Recommendation

For the first production version:
- **Keep the current stdin/log approach** — it is simple, zero-dependency, and handles 90% of code-audit use cases (grep, findstr, dir, node scripts).
- **Add PTY support in a follow-up phase** using `node-pty` as an optional backend. The backend abstraction (`SessionBackend`) already supports adding new backends — a `PtyBackend` can be added alongside the existing ones without changing the architecture.
- **Document PTY usage clearly**: `npm install node-pty` + Windows Build Tools requirement.

## Implementation Sketch for Future PtyBackend

```typescript
import type { IPty } from "node-pty";
import { spawn } from "node-pty";

export class PtyBackend extends SessionBackend {
  name = "pty";
  private sessions: Map<string, IPty> = new Map();

  async start(cwd: string, scratchPath: string, logPath: string) {
    const shell = process.platform === "win32" ? "powershell.exe" : "bash";
    const pty = spawn(shell, [], {
      name: "xterm-color",
      cols: 120,
      rows: 40,
      cwd: scratchPath,
      env: { ...process.env, TERM: "xterm-256color" },
    });
    // ... pipe pty.onData to log file
  }
}
```
