# pi-child-agent

Native Windows-friendly child-agent workflow extension for Pi. Spawn isolated worker agents for code audit, delegated tasks, and sub-process management — without compromising system stability or security.

## Setup

```bash
pi install npm:pi-child-agent
```

## Tools

The extension registers eight tools callable by the parent LLM agent:

| Tool | Description |
|------|-------------|
| `child_agent_create` | Creates an isolated child agent session with a specified backend |
| `child_agent_send` | Sends a command or task to a running child agent |
| `child_agent_status` | Retrieves the current status and metadata of a child agent |
| `child_agent_read` | Reads the current output/logs from a child agent |
| `child_agent_collect` | Reads the final output of a child agent and stops it |
| `child_agent_stop` | Stops a running child agent and cleans up its resources |
| `child_agent_list` | Lists all currently tracked child agent sessions |
| `child_agent_cleanup` | Stops all active child agents and cleans up resources |

## Commands

| Command | Description |
|---------|-------------|
| `/child-create` | Quickly create a child agent: `/child-create <scratchPath> [backendMode]` |

## Backends

| Backend | Platform | Description |
|---------|----------|-------------|
| `windows-native` | Windows | Uses `pwsh`, `powershell.exe`, or `cmd.exe` with full process tree cleanup |
| `local-shell` | Linux/macOS | Basic bash shell fallback |
| `tmux` | Linux/macOS | tmux sessions for persistent, isolated shells |
| `docker` | Windows/Linux/macOS | Docker container isolation with read-only workspace |
| `podman` | Windows/Linux/macOS | Podman container isolation (Docker alternative) |

## Security Model

> **⚠️ Important**: Extensions run with full system permissions. Only install from sources you trust.

Windows native mode provides **process isolation**, not a security sandbox. Container mode provides stronger isolation.

- **Path Protection**: The `SecurityGuard` blocks protected system paths (e.g., `C:\Windows`, `/etc`).
- **High-Risk Command Detection**: Commands like `rm -rf /`, `format`, `Set-ExecutionPolicy` are detected and require approval.
- **Secret Scrubbing**: Child process environment is stripped of sensitive variables unless `secretForwarding` is enabled.
- **Process Cleanup**: Full process tree killed (Windows: `taskkill /T /F`; Unix: process group).
- **No `Invoke-Expression`**: Windows commands dispatched through `cmd /c`, never PowerShell `iex`.

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `backendMode` | string | `"auto"` | One of: `auto`, `windows-native`, `tmux`, `docker`, `podman`, `local-shell` |
| `maxRuntime` | number | `3600000` | Max child runtime in ms (1 hour) |
| `maxLogSize` | number | `10485760` | Max log file size in bytes (10 MB) |
| `maxSimultaneousChildren` | number | `5` | Limit of concurrent child sessions |
| `secretForwarding` | boolean | `false` | Forward API keys/tokens to child (disabled by default) |

## Verification Status

| Capability | Status | Notes |
|------------|--------|-------|
| **Build & validation** | ✅ Verified | `tsc` zero errors; tool schema validates 8/8 tools |
| **Windows native backend** | ✅ Verified | 44-assertion smoke test + 23-assertion live workflow pass |
| **Phase 2 hardening** | ✅ Verified | 15/15 assertions pass |
| **Crash recovery** | ✅ Verified | 20/20 assertions pass |
| **Full lifecycle** | ✅ Verified | 23/23 assertions (canonical live workflow) |
| **Path protection** | ✅ Verified | Protected paths blocked |
| **Secret scrubbing** | ✅ Verified | API keys/tokens removed from child env |
| **High-risk command detection** | ✅ Verified | Dangerous commands detected |
| **Timeout enforcement** | ✅ Verified | Manager-side timeout auto-stops children |
| **Container mode** | ⚠ Implemented, SKIPPED locally | Docker/Podman not installed |
| **Autonomous LLM orchestration** | ⏸ Requires provider quota | 429 rate limit blocks LLM-driven workflow |
| **Interactive CLI tools** | ❌ Not implemented | No PTY support documented in `docs/pty-research.md` |

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

### Container: Docker with read-only workspace

```
child_agent_create({ backendMode: "docker", scratchPath: "/tmp/child-scratch" })
```

## License

This project is licensed under the [MIT License](LICENSE).
