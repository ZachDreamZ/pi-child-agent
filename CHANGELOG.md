# Changelog

## 0.1.11 (2026-07-02)

### Task Queue Mode

- **In-memory Task Queue**: Added ability to enqueue multiple tasks with priority and retry logic.
- **Concurrency Control**: Implemented `maxConcurrentTasks` to prevent system overload.
- **Sentinel-based Tracking**: Added specific markers (`PICA_TASK_DONE`) for precise task completion detection.
- **New Toolset**: Added 6 new queue-management tools (`enqueue`, `start`, `status`, `cancel`, `collect`, `clear`).
- **Structured Queue Results**: Integrated structured result extraction into the queue collection workflow.
- **Queue Tests**: Added comprehensive test suite for priority, concurrency, and retry behavior.

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
