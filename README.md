# pi-child-agent

**Native Windows-friendly child-agent workflow extension for Pi.**

Pi keeps the core minimal. This extension adds a controlled parent-child agent workflow where the main Pi agent (the Parent) spawns isolated worker agents (Children) to perform specific tasks, monitor their progress, and collect results — without compromising the primary session's stability or security.

Designed for non-interactive code-audit and delegated task workflows. Windows-native, no WSL required.

## Installation

### Via Pi (recommended)

```bash
# Local directory
pi install ./pi-child-agent

# GitHub repository
pi install https://github.com/ZachDreamZ/pi-child-agent
```

### Manual (development)

```bash
cd pi-child-agent
npm install --ignore-scripts
npm run build
npm run validate:tools
```

Then copy the extension to a Pi extensions directory:

```bash
# Global (all projects)
cp -r pi-child-agent ~/.pi/agent/extensions/pi-child-agent

# Project-local
cp -r pi-child-agent .pi/extensions/pi-child-agent
```

Restart Pi or run `/reload`.

## Tools

The extension registers eight tools callable by the parent LLM agent:

| Tool Name | Description |
|-----------|-------------|
| `child_agent_create` | Creates an isolated child agent session with a specified backend |
| `child_agent_send` | Sends a command or task to a running child agent |
| `child_agent_status` | Retrieves the current status and metadata of a child agent |
| `child_agent_read` | Reads the current output/logs from a child agent |
| `child_agent_collect` | Reads the final output of a child agent and stops it |
| `child_agent_stop` | Stops a running child agent and cleans up its resources |
| `child_agent_list` | Lists all currently tracked child agent sessions |
| `child_agent_cleanup` | Stops all active child agents and cleans up their resources |

### Slash Command

| Command | Usage |
|---------|-------|
| `/child-create` | `child-create <scratchPath> [backendMode]` — quickly create a child agent |

## Backends

| Backend | Platform | Description |
|---------|----------|-------------|
| `windows-native` | Windows | Uses `pwsh`, `powershell.exe`, or `cmd.exe` with full process tree cleanup via `taskkill /T /F` |
| `local-shell` | Linux/macOS | Basic bash shell fallback — spawns a child bash process |
| `tmux` | Linux/macOS | Leverages tmux sessions for persistent, isolated shells |
| `docker` | Linux/macOS/Windows | Docker container isolation with read-only workspace mount |
| `podman` | Linux/macOS/Windows | Podman container isolation (drop-in Docker alternative) |

### Backend Selection Logic

| OS | Auto Mode Priority | Fallback |
|----|--------------------|----------|
| Windows | 1. Container (if Docker/Podman enabled) | 2. Windows Native (pwsh → powershell → cmd) |
| Linux/macOS | 1. Container (if Docker/Podman enabled) | 2. Tmux (if available) → 3. Local Shell |

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `backendMode` | string | `"auto"` | One of: `auto`, `windows-native`, `tmux`, `docker`, `podman`, `local-shell` |
| `maxRuntime` | number | `3600000` | Max child runtime in ms (1 hour) |
| `maxLogSize` | number | `10485760` | Max log file size in bytes (10 MB) |
| `maxSimultaneousChildren` | number | `5` | Limit of concurrent child sessions |
| `secretForwarding` | boolean | `false` | Forward API keys/tokens to child (disabled by default) |

## Security Model

> **⚠️ Important**: Extensions run with your full system permissions and can execute arbitrary code. Only install from sources you trust.

Windows native mode provides **process isolation**, not a security sandbox. The child agent runs as a child process of the parent with the same Windows user context. Container mode (Docker/Podman) provides stronger isolation when available.

- **Path Protection**: The `SecurityGuard` prevents creating sessions in protected system paths (e.g., `C:\Windows`, `/etc`).
- **High-Risk Command Detection**: Commands like `rm -rf /`, `format`, `Set-ExecutionPolicy` are detected and require user approval.
- **Secret Scrubbing**: The child process environment is automatically stripped of sensitive variables (API keys, tokens, passwords) unless `secretForwarding` is explicitly enabled.
- **Process Cleanup**: On Windows, `taskkill /T /F` ensures no orphan processes remain. On Unix, the full process group is killed.
- **No `Invoke-Expression`**: The Windows backend dispatches commands through `cmd /c` sub-processes, never via PowerShell's `iex`. Each command runs in an isolated sub-shell with clear boundaries.

## Real-World Workflow Examples

### Windows: Inspect source code for TODO/FIXME markers

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

### Container: Docker with read-only workspace

```
child_agent_create({ backendMode: "docker", scratchPath: "/tmp/child-scratch" })
```

## Verification Status

| Capability | Status | Notes |
|------------|--------|-------|
| **Build & validation** | ✅ Verified | `tsc` zero errors; tool schema validates 8/8 tools |
| **Windows native backend** | ✅ Verified | 44-assertion smoke test + 23-assertion live workflow pass |
| **Phase 2 hardening (TODO/FIXME workflow, failure recovery, timeout)** | ✅ Verified | 15/15 assertions pass |
| **Crash recovery (missing files, double cleanup, send-after-stop)** | ✅ Verified | 20/20 assertions pass |
| **Full lifecycle (create, send, read, status, collect, stop, list, cleanup)** | ✅ Verified | 23/23 assertions (canonical live workflow) |
| **Path protection** | ✅ Verified | `C:\Windows`, `C:\Program Files`, `C:\Program Files (x86)` blocked |
| **Secret scrubbing** | ✅ Verified | `API_KEY`, `TOKEN`, `SECRET`, `PASSWORD` removed from child env |
| **High-risk command detection** | ✅ Verified | `rm -rf /`, `format`, `Set-ExecutionPolicy` detected |
| **Timeout enforcement** | ✅ Verified | Manager-side timeout auto-stops long-running children |
| **Container mode** | ⚠ Implemented, SKIPPED locally | Docker/Podman not installed on host; `npm run test:container` exits 0 gracefully |
| **Autonomous LLM orchestration** | ⏸ Requires provider quota | Extension tools register correctly; 429 rate limit blocks LLM-driven workflow |
| **PTY support (interactive CLI)** | ❌ Not implemented | Documented in `docs/pty-research.md` |
| **GitHub Actions CI** | 🔄 Trigger on push | `.github/workflows/ci.yml` runs on main/master |

## Troubleshooting

### npm install lifecycle script conflict

If `npm install` crashes with ENOENT trying to run an `install` script:

**Cause**: A prior version had an `"install"` script in `package.json`, which npm tries to run automatically.

**Fix**: Use `npm install --ignore-scripts` to bypass lifecycle hooks, then run `npm run install:pi` or `npm run install:win` explicitly.

### Missing @types/node

If `tsc` fails with `error TS2688: Cannot find type definition file for 'node'`:

```bash
npm install --save-dev @types/node
```

### Missing Pi runtime typings

If `tsc` fails with `Module '"@earendil-works/pi-coding-agent"' has no exported member 'ExtensionAPI'`:

**Cause**: The Pi runtime package isn't installed in CI. A type shim is included at `types/pi-coding-agent.d.ts`. Ensure `tsconfig.json` includes `"types/**/*.d.ts"` in its `include` array.

### Docker / Podman unavailable

The container backend is implemented but skipped if no container runtime is detected. The test exits with code 0 and a clear `SKIPPED` message. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) or [Podman Desktop](https://podman-desktop.io/) to run container tests: `npm run test:container`.

### tmux unavailable

On macOS/Linux, if tmux is not installed, the auto backend falls back to `local-shell`. Install tmux via your package manager:
- Ubuntu: `sudo apt install tmux`
- macOS: `brew install tmux`
- Verify: `tmux -V`

### PowerShell unavailable (Windows)

If the doctor script shows `shell: powershell ✗ fail`, ensure `C:\Windows\System32\WindowsPowerShell\v1.0` is in your PATH, or install PowerShell Core (`pwsh`) from [GitHub Releases](https://github.com/PowerShell/PowerShell/releases). The extension falls back to `cmd.exe` automatically.

### 429 provider quota

The error `FreeUsageLimitError` on free tier providers means the provider has hit its request limit. Child sessions can still be created and tested via `npm run test:full`, but LLM-driven orchestration is blocked until quota resets or a paid key is added.

### GitHub Actions log artifacts missing

If CI log artifacts aren't available after a workflow run, the `logs/` directory may not have been created. The workflow creates it explicitly:
- Windows: `New-Item -ItemType Directory -Path logs -Force`
- Ubuntu: `mkdir -p logs`

### Tests hang after printing PASS

If a test prints "All tests passed successfully!" but Node.js doesn't exit, open handles (child processes, streams, or timers) are keeping the event loop alive. Fixes applied:
- `backends/shell.ts`: Closes stdin, destroys stdout/stderr, closes log WriteStream on stop.
- `manager.ts`: `unref()`s timeout timers so they don't keep Node alive.
- `tests/test-extension.ts`: Calls `manager.cleanupAll()` in a `finally` block.
- CI: Jobs have `timeout-minutes: 10` and Ubuntu uses `timeout 60` wrappers.

## Development

### Quick start

```bash
git clone https://github.com/ZachDreamZ/pi-child-agent.git
cd pi-child-agent
npm install --ignore-scripts
npm run build
npm run validate:tools
npm run doctor
```

### Test commands

| Command | Description |
|---------|-------------|
| `npm run build` | TypeScript compilation (must zero-error) |
| `npm run validate:tools` | Tool schema validation + README consistency check |
| `npm run doctor` | Environment diagnostics |
| `npm run test:fast` | Fast CI suite: standalone + windows-native + live-workflow + container |
| `npm run test:full` | Full suite: all tests including phase2, crash, live-workflow |
| `npm run test:ci:windows` | CI-optimized Windows suite |
| `npm run test:ci:ubuntu` | CI-optimized Ubuntu suite |

### Project structure

```
pi-child-agent/
├── index.ts                  # Extension entry point (8 tools, 1 command)
├── manager.ts                # ChildSessionManager — session lifecycle
├── backends/
│   ├── base.ts               # SessionBackend interface
│   ├── windows.ts            # WindowsNativeBackend (pwsh/powershell/cmd)
│   ├── shell.ts              # LocalShellBackend (bash)
│   ├── tmux.ts               # TmuxBackend
│   ├── container.ts          # ContainerBackend (Docker/Podman)
│   └── factory.ts            # BackendFactory — auto-selects backend
├── security/
│   └── guard.ts              # SecurityGuard — path protection, risk detection, secret scrubbing
├── config/
│   └── loader.ts             # ConfigLoader — settings with defaults
├── utils/
│   ├── os.ts                 # OS detection
│   ├── process.ts            # killProcessTree (graceful, cross-platform)
│   └── logging.ts            # Logger — file-based log I/O
├── tests/
│   ├── helpers/
│   │   ├── waitForLog.ts     # Sentinel-based log polling (no fixed sleeps)
│   │   └── timing.ts         # Shared timing constants
│   ├── test-extension.ts     # Standalone self-test
│   ├── windows-native-smoke.ts   # Windows-specific smoke test (44 assertions)
│   ├── phase2-hardening.ts   # Real-world workflow + timeout + failure recovery
│   ├── crash-recovery.ts     # Edge cases: missing files, double cleanup, send-after-stop
│   ├── live-workflow.ts      # Canonical full lifecycle (23 assertions)
│   └── container-smoke.ts    # Container mode detection (skipped if no Docker/Podman)
├── scripts/
│   ├── doctor.ts             # Environment diagnostics script
│   ├── validate-tools.ts     # Tool schema + README consistency validation
│   ├── install.sh            # Linux/macOS installer
│   ├── install.ps1           # Windows PowerShell installer
│   └── uninstall.sh / update.sh
├── types/
│   └── pi-coding-agent.d.ts  # Type shim for Pi runtime (CI-safe)
├── docs/
│   └── pty-research.md       # PTY support research (future phase)
└── package.json              # Pi package metadata
```
