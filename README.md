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
| `child_agent_state_status` | Returns the current persistent state status including path, counts, and last save time |
| `child_agent_state_save` | Forces an immediate save of the current children and tasks state to disk |
| `child_agent_state_load` | Reloads state from disk and reports what was recovered |
| `child_agent_state_clear` | Clears the persisted state file (requires confirmation; does not kill active processes) |

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

## Persistent State and Recovery

The extension can persist child session and task queue metadata to disk, allowing state to survive Pi restarts or be inspected after crashes.

### What is persisted

- **Child session metadata**: ID, status, backend type, PID, start/stop times, scratch path, log path, policy mode, last command, exit reason.
- **Task queue metadata**: ID, title, command, status, priority, attempts, timestamps, timeout, result summary, error, associated child session ID.

### Where state is stored

| Platform | Default Path |
|----------|-------------|
| **Windows** | `%LOCALAPPDATA%/pi-child-agent/state/state.json` |
| **Linux/macOS** | `~/.pi-child-agent/state/state.json` |

The path can be overridden via the `stateDir` configuration option.

### What is NOT persisted

- Secrets, environment variables, or API keys
- Full environment
- Process memory or stdout/stderr buffers
- Temporary scratch directory contents

### Orphaned Children

On startup, child sessions that were previously `running` or `starting` are marked as **orphaned** — the extension does not reattach to unknown processes. Orphaned sessions can be inspected via `child_agent_list` and cleaned up with `child_agent_cleanup`.

### Interrupted Queue Tasks

On startup, tasks that were previously `running` are marked as **interrupted**. They are not automatically re-run unless `rerunInterruptedTasks: true` is configured (default: `false`). Queued tasks from a previous session remain queued if `recoverQueuedTasks: true` (default).

### State Management Tools

| Tool | Description |
|------|-------------|
| `child_agent_state_status` | Returns state path, persistence counts, last save time, and corrupt recovery status |
| `child_agent_state_save` | Forces an immediate save of all children and task states to disk |
| `child_agent_state_load` | Reloads state from disk and reports what was recovered |
| `child_agent_state_clear` | Clears the persisted state file (requires `confirm: true`; does not kill active processes) |

### Clearing State

```json
child_agent_state_clear({ confirm: true, includeHistory: true })
```

This clears the persisted state file and optionally removes completed session/task history from memory. Active child processes are **not** killed — use `child_agent_cleanup` separately.

### Privacy/Security Note

Persisted state intentionally excludes secrets, environment variables, and command output. The state file is a plain JSON file stored in a user-writable location. Treat it as potentially readable by other processes on the same machine.

| Capability | Status | Notes |
|------------|--------|-------|
| **Build & validation** | ✅ Verified | `tsc` zero errors; tool schema validates 18/18 tools |
| **Windows native backend** | ✅ Verified | 44-assertion smoke test + 23-assertion live workflow pass |
| **Phase 2 hardening** | ✅ Verified | 15/15 assertions pass |
| **Crash recovery** | ✅ Verified | 20/20 assertions pass |
| **Full lifecycle** | ✅ Verified | 23/23 assertions (canonical live workflow) |
| **Path protection** | ✅ Verified | Protected paths blocked |
| **Secret scrubbing** | ✅ Verified | API keys/tokens removed from child env |
| **High-risk command detection** | ✅ Verified | Dangerous commands detected |
| **Timeout enforcement** | ✅ Verified | Manager-side timeout auto-stops children |
| **Security policies** | ✅ Verified | Strict/standard/trusted modes pass |
| **Structured collect** | ✅ Verified | Deterministic log parsing passes |
| **Task Queue Mode** | ✅ Verified | 8/8 queue tests pass (priority, concurrency, security, cancel, history) |
| **State recovery** | 🟡 Pending | 19-assertion test written; pending local + CI verification |
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
