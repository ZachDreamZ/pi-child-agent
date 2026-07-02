# Changelog

## 0.1.12 (2026-07-02)

This release adds Persistent State and Queue Recovery for surviving Pi restarts and inspecting/cleaning sessions after crashes.

### Added
- Persistent state store with atomic writes
- Recovery for child sessions on startup
- Recovery for queue tasks on startup
- Orphaned child status for sessions with stale PIDs
- Interrupted task status for previously running tasks
- 4 state management tools:
  - child_agent_state_status
  - child_agent_state_save
  - child_agent_state_load
  - child_agent_state_clear
- State recovery test suite (19 tests)
- Configuration options for state persistence control
- Corrupt state file detection and recovery

### Verified
- TypeScript build passes
- 18 tools validated
- Doctor passes
- State recovery tests pass
- All previous tests continue to pass

### Limitations
- Container backend is implemented but still requires Docker/Podman verification on a capable machine
- PTY/interactive terminal support is not implemented
- Windows native mode is process isolation, not a hardened sandbox

## 0.1.11 (2026-07-02)

This release adds Task Queue Mode for delegated multi-task child-agent workflows.

### Added
- In-memory task queue system
- Six queue tools:
  - child_agent_enqueue
  - child_agent_queue_start
  - child_agent_queue_status
  - child_agent_queue_cancel
  - child_agent_queue_collect
  - child_agent_queue_clear
- Priority support: low, normal, high
- Concurrency control with max concurrent tasks
- Retry support with max attempts
- Task cancellation
- Structured queue result collection
- Sentinel-based task completion tracking
- Task queue test suite

### Verified
- TypeScript build passes
- 14 tools validated
- Doctor passes
- Security policy tests pass
- Structured collect tests pass
- Task queue tests pass
- Windows native smoke tests pass
- Crash recovery tests pass
- Live workflow tests pass

### Limitations
- Container backend is implemented but still requires Docker/Podman verification on a capable machine
- PTY/interactive terminal support is not implemented
- Windows native mode is process isolation, not a hardened sandbox

## 0.1.10 (2026-07-02)

### Security Policies and Structured Collection

- **Configurable Security Policies**: Added `strict`, `standard`, and `trusted` modes for fine-grained control over workspace write, network, and package install permissions.
- **Structured Collect Output**: `child_agent_collect` now supports `structured: true` to return deterministic summaries, error/warning lists, and file mentions.
- **Improved Approval Behavior**: Integrated policy decisions into `child_agent_send` with rich UI confirmation prompts and categorized risk levels.
- **New Test Suites**: Added `tests/security-policy.ts` and `tests/structured-collect.ts`.

## 0.1.0 (2026-07-01)

### Initial Release

- **Windows-native backend** (`WindowsNativeBackend`): spawns `pwsh` → `powershell.exe` → `cmd.exe` with full process-tree management.
- **Tmux backend** for Linux/macOS with session isolation.
- **Container backend** (Docker/Podman) for Linux containers with read-only workspace mounts.
- **LocalShell backend** for direct shell spawning on platforms without tmux.
- **Auto backend detection** selects the best backend for the host OS.
- **8 tool registrations** for Pi: `child_agent_create`, `child_agent_send`, `child_agent_status`, `child_agent_read`, `child_agent_collect`, `child_agent_stop`, `child_agent_list`, `child_agent_cleanup`.
- **Security guard**: protects Windows system paths (`C:\Windows`, `C:\Program Files`, etc.), detects high-risk commands (`rm -rf /`, `format`, etc.), scrubs secret env vars.
- **Config system**: `maxSimultaneousChildren`, `maxLogSize`, `maxRuntime`, `protectedPaths`, `highRiskCommands`, `secretEnvVars`.
- **Logging**: file-based log with `[PICA_CMD]`, `[PICA_DONE]`, `[PICA_TIMEOUT]`, `[PICA_BLOCKED]` sentinels.
- **Scripts**: `doctor.ts` (18 checks), `validate-tools.ts`, `install.ps1`, `install.sh`, `uninstall.sh`, `update.sh`.
- **Tests**: 48-assertion Windows smoke test, 20-assertion phase 2 hardening test, 20-assertion crash recovery test, 6-assertion standalone test, container smoke test.
- **PTY research** documented in `docs/pty-research.md`.
- **CI**: GitHub Actions workflow for Windows and Ubuntu with artifact uploads.
