# Agents Context: pi-child-agent

This extension provides a "Parent-Child" agent architecture. It allows the primary Pi agent (the Parent) to spawn isolated worker agents (Children) to perform specific, delegated tasks.

## Core Philosophy

Use child agents when a task requires:
- **Isolation**: The task involves risky commands or experimental changes that should not affect the main session.
- **Parallelism**: You need to run a long-running process (like a deep code audit) while remaining responsive to the user in the main session.
- **Focused Context**: You want a "clean slate" for a specific sub-task to avoid context pollution in the main session.
- **Verification**: You want to run a command and capture its full log output cleanly without cluttering the primary chat.

## Orchestration Workflow

When delegating to a child agent, follow this canonical sequence:

### 1. Creation (`child_agent_create`)
Determine the appropriate `backendMode`:
- `windows-native`: For standard Windows tasks (default).
- `docker`/`podman`: For tasks requiring strong isolation or a specific environment.
- `tmux`: For persistent sessions on Linux/macOS.
- `auto`: Let the extension decide based on the OS.

**Always** provide a unique `scratchPath` (e.g., `C:\Users\Public\pi-child-audit-1`) to ensure the child has a writable workspace.

### 2. Execution (`child_agent_send`)
Send commands to the child. Use sentinels or specific markers if you are running complex scripts to know when they are complete.
- For simple checks: `dir /s /b .` or `ls -R`.
- For audits: `grep` or `findstr` commands.
- For scripts: `node -e "..."` or `python -c "..."`.

### 3. Monitoring (`child_agent_read` / `child_agent_status`)
Periodically read the logs to verify progress. Check the status to ensure the child is still `running`.

### 4. Finalization (`child_agent_collect`)
Once the task is complete, use `child_agent_collect`. This reads the final log output and terminates the session in one step.

### 5. Cleanup (`child_agent_cleanup`)
If you have multiple orphaned children or are ending a complex phase, run `child_agent_cleanup` to ensure no zombie processes remain.

## Security & Guardrails

The Parent agent must adhere to the following security constraints:

- **Protected Paths**: Do not attempt to create sessions in `C:\Windows`, `C:\Program Files`, or `/etc`. The `SecurityGuard` will block these.
- **High-Risk Commands**: Be aware that commands like `rm -rf /` or `format` will trigger approval flows. Always explain to the user why a high-risk command is necessary before sending it.
- **Secret Management**: By default, children do not receive environment secrets. If a child needs an API key, you must explicitly enable `secretForwarding: true` (use with caution).

## Error Handling Patterns

- **Session Not Found**: If a `child_agent_send` fails because the session is missing, check `child_agent_list` to see if it crashed or timed out.
- **Timeout**: If a child stops unexpectedly, check if it exceeded `maxRuntime`.
- **Permission Denied**: If a child cannot write to its scratch path, verify the path is not in a protected system directory.

## Example Persona: The Auditor

When acting as an Auditor using this extension:
1. Spawn a child agent with `windows-native` backend.
2. Use `child_agent_send` to run a recursive search for `TODO`, `FIXME`, or `BUG` markers.
3. Read the logs to identify the most critical issues.
4. Summarize the findings in the main chat.
5. Collect and terminate the child session.
