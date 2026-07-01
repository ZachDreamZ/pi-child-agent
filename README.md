# pi-child-agent

`pi-child-agent` is a Pi extension that enables a "Parent-Child" agent workflow. It allows the main Pi agent (the Parent) to spawn isolated worker agents (Children) to perform specific tasks, monitor their progress, and collect results without compromising the primary session's stability or security.

## Features

- **Multi-Backend Support**:
  - **Windows Native**: Uses `pwsh`, `powershell.exe`, or `cmd.exe` with full process tree cleanup.
  - **Tmux**: Leverages `tmux` sessions for persistent, isolated shells on Linux/macOS.
  - **Containers**: Integration with Docker or Podman for strong isolation with read-only workspace mounts.
  - **Local Shell**: A basic shell fallback for Unix environments.
- **Security First**:
  - **Path Protection**: Blocks access to critical system directories (e.g., `C:\\Windows`, `/etc`).
  - **Risk Detection**: Identifies and warns about high-risk commands.
  - **Isolated Scratch Space**: Each child agent is assigned its own writable scratch directory.
- **Lifecycle Management**: Tools to create, send tasks, monitor status, read logs, and cleanup child agents.

## Installation

1. Copy the `pi-child-agent` folder to your Pi extensions directory:
   - Global: `~/.pi/agent/extensions/pi-child-agent`
   - Project-local: `.pi/extensions/pi-child-agent`
2. Run `npm install --ignore-scripts` inside the extension directory to install dependencies.
3. Install the extension using one of the following:
   - **Linux/macOS**: `npm run install:pi`
   - **Windows**: `npm run install:win`
4. Restart Pi or use `/reload`.

To install from the command line:
```bash
cd ~/.pi/agent/extensions
cp -r /path/to/pi-child-agent .
cd pi-child-agent && npm install --ignore-scripts && npm run install:pi
```

## Usage

### Tools for the Agent

The extension provides tools callable by the parent LLM agent:

| Tool Name | Description |
|-----------|-------------|
| `child_agent_create` | Spawn a new child agent with a specified backend |
| `child_agent_send` | Send a command or task to a running child |
| `child_agent_status` | Get metadata and current state |
| `child_agent_read` | Read output logs from a child |
| `child_agent_stop` | Terminate a child agent (kills full process tree) |
| `child_agent_collect` | Read final logs and terminate |
| `child_agent_list` | List all active child sessions |
| `child_agent_cleanup` | Stop all children and clean up resources |

### Slash Commands
- `/child-create <scratchPath> [backendMode]`: Quickly create a child agent.

## Real-World Workflow Examples

### Windows: Inspect source code for TODO/FIXME markers

The parent asks the child agent to audit a folder:
```
child_agent_create({ scratchPath: "C:\\Users\\Public\\audit-project" })
  → ID: child_12345
child_agent_send({ id: "child_12345", command: "dir /s /b ." })
child_agent_send({ id: "child_12345", command: "findstr /n \"TODO FIXME\" *.js *.ts *.py" })
child_agent_read({ id: "child_12345" })
child_agent_collect({ id: "child_12345" })
```

### Windows: Node.js inline script
```
child_agent_create({ scratchPath: "C:\\Users\\Public\\node-test" })
child_agent_send({ id: "child_67890", command: "node -e \"console.log('CHILD_AGENT_OK')\"" })
child_agent_read({ id: "child_67890" })
```

### Windows: PowerShell (if pwsh/powershell is the detected shell)
```
child_agent_send({ id: "child_111", command: "Get-ChildItem -Recurse ./src | Select-String -Pattern \"TODO\"" })
```

### Linux/macOS: Tmux session
```
child_agent_create({ backendMode: "tmux", scratchPath: "/tmp/child-work" })
```

### Container: Docker/Podman with RO workspace
```
child_agent_create({ backendMode: "docker", scratchPath: "/tmp/child-scratch" })
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `backendMode` | string | `"auto"` | One of: `auto`, `windows-native`, `tmux`, `docker`, `podman`, `local-shell` |
| `maxRuntime` | number | `3600000` | Max child runtime in ms (1 hour) |
| `maxLogSize` | number | `10485760` | Max log file size in bytes (10 MB) |
| `maxSimultaneousChildren` | number | `5` | Limit of concurrent child sessions |
| `secretForwarding` | boolean | `false` | Forward API keys/tokens to child (disabled by default) |

## Security Model

> **⚠️ Important**: Windows native mode provides **process isolation**, not a security sandbox. The child agent runs as a child process of the parent with the same Windows user context. Use container mode (Docker/Podman) when stronger isolation is needed.

1. **Workspace Isolation**: In container mode, the main workspace is mounted as **read-only**. All writes must occur in the designated `scratchPath`.
2. **System Protection**: The `SecurityGuard` prevents the creation of sessions in protected system paths and blocks known destructive commands.
3. **Secret Scrubbing**: The child process environment is automatically stripped of sensitive variables (API keys, tokens, passwords) unless `secretForwarding` is explicitly enabled.
4. **Process Cleanup**: On Windows, `tree-kill` (`taskkill /T /F`) is used to ensure that no orphan processes remain after a child agent is stopped.
5. **No `Invoke-Expression`**: The Windows backend dispatches commands through `cmd /c` sub-processes, never via PowerShell's dangerous `iex` (`Invoke-Expression`). Each command runs in an isolated sub-shell with clear boundaries.

## Backend Selection Logic

| OS | Auto Mode Priority | Fallback |
|----|-------------------|----------|
| Windows | 1. Container (if Docker/Podman enabled) | 2. Windows Native (pwsh → powershell → cmd) |
| Linux/macOS | 1. Container (if Docker/Podman enabled) | 2. Tmux (if available) → 3. Local Shell |

## Verification Status

| Capability | Status | Notes |
|------------|--------|-------|
| **Windows native non-interactive workflows** | ✅ Verified | 48-assertion smoke test, 20-assertion hardening test, 20-assertion crash recovery test all pass |
| **Direct Pi tool invocation** | ✅ Verified | Full 10-step workflow (create, send, read, status, collect, stop, list, cleanup) — 21/21 assertions pass |
| **Path protection** | ✅ Verified | `C:\Windows`, `C:\Program Files`, `C:\Program Files (x86)` blocked |
| **Secret scrubbing** | ✅ Verified | `API_KEY`, `TOKEN`, `SECRET`, `PASSWORD` removed from child env |
| **High-risk command detection** | ✅ Verified | `rm -rf /`, `format`, `Set-ExecutionPolicy` detected |
| **Timeout enforcement** | ✅ Verified | Manager-side timeout auto-stops long-running children |
| **Container mode** | ⚠ Implemented, not verified locally | Backend in `backends/container.ts`; test available at `npm run test:container` — requires Docker Desktop or Podman Desktop |
| **Autonomous LLM orchestration** | ⏸ Requires provider quota | Extension tools register correctly; 429 rate limit on free tier blocks LLM-driven workflow |
| **PTY support (interactive CLI)** | ❌ Not implemented | Documented in `docs/pty-research.md` — future phase |
| **GitHub Actions CI** | 🔄 Will run after push to GitHub | Workflow at `.github/workflows/ci.yml` — push to trigger |

## Known Limitations

- **Interactive CLI tools**: No PTY is attached, so programs requiring a real terminal (editors like vim/nano, SSH prompts, interactive wizards) will not work correctly.
- **Container mode**: Requires Docker Desktop or Podman Desktop to be installed and running.
- **State loss on restart**: Child sessions are tracked in-memory only. Restarting Pi loses all child state.
- **Output latency**: Stdout pipe buffers may introduce ~300-1500ms latency for log reading.
- **LLM provider quota**: Full Pi-based parent-child workflows require the active LLM provider to have available API quota. A 429 rate limit error means the extension is working but the provider cannot accept prompts.

## Install Verification

After installing, run the doctor script to verify the environment:

```bash
cd pi-child-agent
npx tsx scripts/doctor.ts
```

Expected output (Windows):
```
pi CLI available                           ✓ ok
pi-child-agent installed                   ✓ ok
dependencies installed                     ✓ ok
OS detection                               ✓ ok       win32 → win32
shell: pwsh                                ✓ ok       available
shell: powershell                          ✓ ok       available
shell: cmd                                 ✓ ok       available
auto backend selection                     ✓ ok       → windows-native
protected path: C:\Windows                 ✓ ok       BLOCKED
protected path: C:\Program Files (x86)     ✓ ok       BLOCKED
non-protected path: C:\Users\Public        ✓ ok       ALLOWED
secret env scrub (API_KEY)                 ✓ ok       API_KEY removed
temp directory writable                    ✓ ok
container: docker                          ⚠ warn    (if not installed)
container: podman                          ⚠ warn    (if not installed)
```

Then run the smoke test to verify end-to-end functionality:

```bash
npx tsx tests/windows-native-smoke.ts
```

All 48 assertions should pass. If they do, the extension is ready for use.

## Troubleshooting

### 429 Rate Limit (Provider Quota Exhausted)

**Error**: `429: {"type":"FreeUsageLimitError","message":"Rate limit exceeded. Please try again later."}`

**Cause**: Your LLM provider (e.g., OpenCode free tier) has hit its request quota.

**Solution**: 
- Wait for the rate limit to reset (typically 1–24 hours on free tiers).
- Add a paid provider API key to Pi's configuration.
- Use `pi config set provider your-paid-provider` to switch providers.

The extension loads, tools register, and child sessions can be created via the test suite. Only LLM-driven tool orchestration is affected.

### Missing Docker Desktop (Container Mode)

**Error**: Container backend fails to start, or `container: docker` shows `warn` in doctor output.

**Solution**: Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) or [Podman Desktop](https://podman-desktop.io/) and ensure the daemon is running. Then re-run `npm run test:container`.

### Missing tmux (Linux/macOS)

**Issue**: On Linux/macOS, the auto backend prefers tmux. If tmux is not installed, it falls back to local-shell.

**Solution**: Install tmux via your package manager:
- Ubuntu: `sudo apt install tmux`
- macOS: `brew install tmux`
- Verify: `tmux -V`

The extension works without tmux using the LocalShell backend, but persistence across commands is weaker.

### Missing PowerShell (Windows)

**Issue**: The doctor shows `shell: powershell ✗ fail`

**Cause**: PowerShell is not in your system PATH, or Windows PowerShell was removed.

**Solution**: Install PowerShell Core (`pwsh`) from [GitHub Releases](https://github.com/PowerShell/PowerShell/releases), or ensure `C:\Windows\System32\WindowsPowerShell\v1.0` is in your PATH.

The extension falls back to `cmd.exe` if no PowerShell variant is found.

### Permission Denied

**Issue**: "Access denied" when trying to create a child session.

**Cause**:
- The scratch path is inside a protected system directory (e.g., `C:\Windows`).
- The process lacks write permission on the scratch path.

**Solution**:
- Use `C:\Users\Public\pi-child-*` or a dedicated workspace directory as the scratch path.
- Ensure the scratch path exists and is writable by the current user.
- Do not use `C:\Windows`, `C:\Program Files`, or other protected paths.

### Extension Fails to Load in Pi

**Issue**: "Failed to load extension" or "Module not found" errors.

**Cause**: Dependencies are not installed, or the extension path is incorrect.

**Solution**:
1. Run `npm install` in the extension directory.
2. Verify the extension is in a Pi extensions directory:
   - `~/.pi/agent/extensions/pi-child-agent/` (global)
   - `.pi/extensions/pi-child-agent/` (project-local)
3. Run `pi list` to confirm it appears in the list.
4. Restart Pi or run `/reload`.
5. If still failing, run `npx tsx scripts/doctor.ts` for diagnostics.

### Build Errors (TypeScript)

**Issue**: `npx tsc -p tsconfig.json` fails.

**Solution**:
- Ensure Node.js 18+ and TypeScript 5+ are installed.
- Run `npm install` to update dependencies.
- Check for syntax errors in modified files.

