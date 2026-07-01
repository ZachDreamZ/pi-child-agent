# pi-child-agent

Native Windows-friendly child-agent workflow extension for Pi. Spawn isolated worker agents for code audit, delegated tasks, and sub-process management — without compromising system stability or security.

## Setup

```bash
pi install npm:pi-child-agent
```

## Tools

The extension registers fourteen tools callable by the parent LLM agent:

| Tool | Description |
|------|-------------|
| `child_agent_create` | Creates an isolated child agent session with a specified backend |
| `child_agent_send` | Sends a command or task to a running child agent |
| `child_agent_status` | Retrieves the current status and metadata of a child agent |
| `child_agent_read` | Reads the current output/logs from a child agent |
| `child_agent_collect` | Reads the final output of a child agent and stops it. Supports structured result extraction |
| `child_agent_stop` | Stops a running child agent and cleans up its resources |
| `child_agent_list` | Lists all currently tracked child agent sessions |
| `child_agent_cleanup` | Stops all active child agents and cleans up resources |
| `child_agent_enqueue` | Adds a task to the delegated queue for asynchronous execution |
| `child_agent_queue_start` | Starts processing the delegated task queue |
| `child_agent_queue_status` | Retrieves the current status of the task queue and a list of tasks |
| `child_agent_queue_cancel` | Cancels a queued or running task |
| `child_agent_queue_collect` | Collects structured results for a task or all completed tasks |
| `child_agent_queue_clear` | Clears completed, canceled, or failed tasks from history |

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

### Security Policies

The extension uses a policy-based security system to control child agent capabilities.

| Mode | Workspace Write | Package Install | Git Write | Network | Protected Paths |
|---|---|---|---|---|---|
| `strict` | ❌ | ⚠ Approval | ⚠ Approval | ❌ | 🚫 Blocked |
| `standard` (Default) | ❌ | ⚠ Approval | ⚠ Approval | ✅ Allowed | 🚫 Blocked |
| `trusted` | ✅ Allowed | ✅ Allowed | ✅ Allowed | ✅ Allowed | 🚫 Blocked |

**Example Config**:
```json
{
  "policyMode": "strict",
  "allowNetworkCommands": true,
  "requireApprovalForHighRisk": true
}
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `backendMode` | string | `"auto"` | One of: `auto`, `windows-native`, `tmux`, `docker`, `podman`, `local-shell` |
| `maxRuntime` | number | `3600000` | Max child runtime in ms (1 hour) |
| `maxLogSize` | number | `10485760` | Max log file size in bytes (10 MB) |
| `maxSimultaneousChildren` | number | `5` | Limit of concurrent child sessions |
| `secretForwarding` | boolean | `false` | Forward API keys/tokens to child (disabled by default) |
| `queueEnabled` | boolean | `true` | Enable the delegated task queue system |
| `maxConcurrentTasks` | number | `2` | Max tasks to run simultaneously in the queue |
| `defaultTaskMaxAttempts` | number | `1` | Default retry attempts for failed tasks |
| `cleanupTaskChildren` | boolean | `true` | Stop child sessions automatically after task completion |
| `taskResultStructured` | boolean | `true` | Use structured extraction for queue results |

## Task Queue Mode

The extension includes a **Delegated Task Queue** that allows the parent agent to enqueue multiple tasks and process them asynchronously. This is ideal for batch operations like auditing multiple files or running a sequence of independent scripts.

### Queue Lifecycle
1. **Enqueue**: Add tasks with titles, commands, and priority (`low`, `normal`, `high`).
2. **Start**: Begin processing. The queue respects `maxConcurrentTasks`.
3. **Monitor**: Use `child_agent_queue_status` to track progress.
4. **Collect**: Retrieve structured results from completed tasks.
5. **Cleanup**: Clear history using `child_agent_queue_clear`.

### Example Workflow
```
child_agent_enqueue({ title: "Audit Auth", command: "node audit-auth.js" })
child_agent_enqueue({ title: "Audit DB", command: "node audit-db.js", priority: "high" })
child_agent_queue_start({ maxConcurrentTasks: 2 })
child_agent_queue_status({ includeCompleted: true })
child_agent_queue_collect({ allCompleted: true })
```

## Verification Status

| Capability | Status | Notes |
|------------|--------|-------|
| **Build & validation** | ✅ Verified | `tsc` zero errors; tool schema validates 14/14 tools |
| **Windows native backend** | ✅ Verified | 44-assertion smoke test + 23-assertion live workflow pass |
| **Phase 2 hardening** | ✅ Verified | 15/15 assertions pass |
| **Crash recovery** | ✅ Verified | 20/20 assertions pass |
| **Full lifecycle** | ✅ Verified | 23/23 assertions (canonical live workflow) |
| **Path protection** | ✅ Verified | Protected paths blocked |
| **Secret scrubbing** | ✅ Verified | API keys/tokens removed from child env |
| **High-risk command detection** | ✅ Verified | Dangerous commands detected |
| **Timeout enforcement** | ✅ Verified | Manager-side timeout auto-stops children |
| **Task Queue Mode** | ✅ Verified | 8/8 core queue scenarios pass |
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
