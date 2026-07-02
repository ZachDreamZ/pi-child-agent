import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ChildSessionManager } from "./manager.js";
import { isWindows, getOSType } from "./utils/os.js";
import { SecurityGuard } from "./security/guard.js";
import { ConfigLoader } from "./config/loader.js";
import { BackendFactory } from "./backends/factory.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

type ToolHandler = (
  toolCallId: string,
  params: any,
  signal: AbortSignal,
  onUpdate: (update: any) => void,
  ctx: { ui: { confirm: (msg: string, title: string) => Promise<boolean>, notify: (msg: string, level: string) => void } }
) => Promise<any>;

type CommandHandler = (
  args: string,
  ctx: { ui: { notify: (msg: string, level: string) => void } }
) => Promise<void>;

export default async function (pi: ExtensionAPI) {
  const manager = new ChildSessionManager(pi);
  await manager.initialize();

  // --- Tools ---

  pi.registerTool({
    name: "child_agent_enqueue",
    label: "Enqueue Child Task",
    description: "Adds a task to the delegated queue for asynchronous execution.",
    parameters: Type.Object({
      title: Type.String({ description: "Short descriptive title for the task." }),
      command: Type.String({ description: "The command to execute." }),
      priority: Type.Optional(Type.String({ description: "Priority: low, normal, high. Default: normal." })),
      maxAttempts: Type.Optional(Type.Number({ description: "Max retry attempts. Default: 1." })),
      timeoutMs: Type.Optional(Type.Number({ description: "Task-specific timeout in ms." })),
      policyMode: Type.Optional(Type.String({ description: "Policy mode: strict, standard, trusted. Default: standard." })),
    }),
    execute: (async (_toolCallId, params, _signal, _onUpdate, ctx): Promise<any> => {
      try {
        const task = await manager.enqueueTask(params);
        return {
          content: [{ type: "text", text: `### 📥 Task Enqueued\n\n**Task ID**: \`${task.id}\`\n**Title**: ${task.title}\n**Status**: \`${task.status}\`\n\nUse \`child_agent_queue_start\` to begin processing.` }],
          details: { success: true, taskId: task.id, status: task.status },
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `❌ **Failed to enqueue task**: ${e.message}` }], details: { success: false } };
      }
    }) as ToolHandler,
  });

  pi.registerTool({
    name: "child_agent_queue_start",
    label: "Start Task Queue",
    description: "Starts processing the delegated task queue.",
    parameters: Type.Object({
      maxConcurrentTasks: Type.Optional(Type.Number({ description: "Maximum concurrent tasks to run." })),
    }),
    execute: (async (_toolCallId, params, _signal, _onUpdate, ctx): Promise<any> => {
      try {
        const status = await manager.startQueue(params.maxConcurrentTasks);
        return {
          content: [{ type: "text", text: `### ⚙️ Queue Started\n\n**Running**: ${status.running}\n**Queued**: ${status.queued}\n**Active Tasks**: ${status.runningTasks}` }],
          details: status,
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `❌ **Failed to start queue**: ${e.message}` }], details: { success: false } };
      }
    }) as ToolHandler,
  });

  pi.registerTool({
    name: "child_agent_queue_status",
    label: "Queue Status",
    description: "Retrieves the current status of the task queue and a list of tasks.",
    parameters: Type.Object({
      includeCompleted: Type.Optional(Type.Boolean({ description: "Whether to include completed/failed tasks. Default: false." })),
    }),
    execute: (async (_toolCallId, params, _signal, _onUpdate, ctx): Promise<any> => {
      try {
        const status = await manager.getQueueStatus();
        const tasks = await manager.queue.listTasks({ includeCompleted: params.includeCompleted ?? false });
        
        let table = `### 📋 Queue Status\n\n**Active**: ${status.running} | **Queued**: ${status.queued} | **Running**: ${status.runningTasks} | **Succeeded**: ${status.succeeded} | **Failed**: ${status.failed}\n\n`;
        if (tasks.length > 0) {
          table += `| ID | Title | Status | Priority |\n|---|---|---|---|\n`;
          for (const t of tasks) {
            table += `| \`${t.id}\` | ${t.title} | \`${t.status}\` | ${t.priority} |\n`;
          }
        } else {
          table += "_No tasks matching criteria._";
        }

        return {
          content: [{ type: "text", text: table }],
          details: { ...status, tasks },
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `❌ **Failed to get queue status**: ${e.message}` }], details: { success: false } };
      }
    }) as ToolHandler,
  });

  pi.registerTool({
    name: "child_agent_queue_cancel",
    label: "Cancel Queue Task",
    description: "Cancels a queued or running task.",
    parameters: Type.Object({
      taskId: Type.String({ description: "The ID of the task to cancel." }),
    }),
    execute: (async (_toolCallId, params, _signal, _onUpdate, ctx): Promise<any> => {
      try {
        await manager.cancelTask(params.taskId);
        return {
          content: [{ type: "text", text: `### 🛑 Task Canceled\n\nTask \`${params.taskId}\` has been canceled.` }],
          details: { success: true, taskId: params.taskId, status: "canceled" },
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `❌ **Failed to cancel task**: ${e.message}` }], details: { success: false } };
      }
    }) as ToolHandler,
  });

  pi.registerTool({
    name: "child_agent_queue_collect",
    label: "Collect Queue Results",
    description: "Collects structured results for a specific task or all completed tasks.",
    parameters: Type.Object({
      taskId: Type.Optional(Type.String({ description: "The ID of the task to collect results for." })),
      allCompleted: Type.Optional(Type.Boolean({ description: "Collect results for all completed tasks. Default: false." })),
    }),
    execute: (async (_toolCallId, params, _signal, _onUpdate, ctx): Promise<any> => {
      try {
        const completed = await manager.queue.listTasks({ status: ["succeeded", "failed", "timed_out", "canceled"], includeCompleted: true });
        let report = `### 📦 Batch Results (${completed.length} tasks)\n\n`;
        for (const t of completed) {
          report += `- \`${t.id}\` (${t.title}): \`${t.status}\`\n`;
        }
        return {
          content: [{ type: "text", text: report }],
          details: { success: true, tasks: completed },
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `❌ **Failed to collect queue result**: ${e.message}` }], details: { success: false } };
      }
    }) as ToolHandler,
  });

  pi.registerTool({
    name: "child_agent_queue_clear",
    label: "Clear Queue History",
    description: "Clears completed, canceled, or failed tasks from the queue history.",
    parameters: Type.Object({
      includeSucceeded: Type.Optional(Type.Boolean({ description: "Clear succeeded tasks. Default: true." })),
      includeFailed: Type.Optional(Type.Boolean({ description: "Clear failed/timed_out tasks. Default: false." })),
      includeCanceled: Type.Optional(Type.Boolean({ description: "Clear canceled tasks. Default: true." })),
    }),
    execute: (async (_toolCallId, params, _signal, _onUpdate, ctx): Promise<any> => {
      try {
        const removed = manager.clearQueue({
          includeSucceeded: params.includeSucceeded ?? true,
          includeFailed: params.includeFailed ?? false,
          includeCanceled: params.includeCanceled ?? true,
        });
        return {
          content: [{ type: "text", text: `### 🧹 Queue Cleared\n\nRemoved ${removed} tasks from history.` }],
          details: { success: true, removed },
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `❌ **Failed to clear queue**: ${e.message}` }], details: { success: false } };
      }
    }) as ToolHandler,
  });

  // ── State Tools ──

  pi.registerTool({
    name: "child_agent_state_status",
    label: "State Status",
    description: "Returns the current persistent state status including path, counts, and last save time.",
    parameters: Type.Object({}),
    execute: (async (_toolCallId, _params, _signal, _onUpdate, ctx): Promise<any> => {
      try {
        const status = await manager.getStateStatus();
        const s = status as any;
        const report = `### 📁 Persistent State Status\n\n` +
          `**Enabled**: ${s.stateEnabled ? "✅" : "❌"}\n` +
          `**State Path**: \`${s.statePath}\`\n` +
          `**Children Persisted**: ${s.childrenPersisted}\n` +
          `**Tasks Persisted**: ${s.tasksPersisted}\n` +
          `**Last Saved**: ${new Date(s.lastSavedAt).toLocaleString()}\n` +
          `**Corrupt State Recovered**: ${s.corruptStateRecovered ? "⚠️ Yes" : "No"}`;
        return {
          content: [{ type: "text", text: report }],
          details: s,
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `❌ **Failed to get state status**: ${e.message}` }], details: { success: false } };
      }
    }) as ToolHandler,
  });

  pi.registerTool({
    name: "child_agent_state_save",
    label: "Save State",
    description: "Forces an immediate save of the current children and tasks state to disk.",
    parameters: Type.Object({}),
    execute: (async (_toolCallId, _params, _signal, _onUpdate, ctx): Promise<any> => {
      try {
        const result = await manager.saveState();
        const r = result as any;
        return {
          content: [{ type: "text", text: `### 💾 State Saved\n\n**Saved At**: ${new Date(r.savedAt).toLocaleString()}\n**State Path**: \`${r.statePath}\`` }],
          details: r,
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `❌ **Failed to save state**: ${e.message}` }], details: { success: false } };
      }
    }) as ToolHandler,
  });

  pi.registerTool({
    name: "child_agent_state_load",
    label: "Load State",
    description: "Reloads state from disk and reports what was recovered.",
    parameters: Type.Object({}),
    execute: (async (_toolCallId, _params, _signal, _onUpdate, ctx): Promise<any> => {
      try {
        const result = await manager.loadState();
        const r = result as any;
        const report = `### 🔄 State Reloaded\n\n` +
          `**Children Recovered**: ${r.childrenRecovered}\n` +
          `**Tasks Recovered**: ${r.tasksRecovered}\n` +
          `**Orphaned Children**: ${r.orphanedChildren}\n` +
          `**Interrupted Tasks**: ${r.interruptedTasks}\n` +
          (r.message ? `**Message**: ${r.message}\n` : "");
        return {
          content: [{ type: "text", text: report }],
          details: r,
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `❌ **Failed to load state**: ${e.message}` }], details: { success: false } };
      }
    }) as ToolHandler,
  });

  pi.registerTool({
    name: "child_agent_state_clear",
    label: "Clear State",
    description: "Clears the persisted state file. Requires confirm: true. Does not kill active child processes.",
    parameters: Type.Object({
      confirm: Type.Boolean({ description: "Must be true to confirm clearing state." }),
      includeHistory: Type.Optional(Type.Boolean({ description: "Also clear completed session/task history from memory. Default: true." })),
    }),
    execute: (async (_toolCallId, params, _signal, _onUpdate, ctx): Promise<any> => {
      try {
        const result = await manager.clearState(params.confirm, params.includeHistory ?? true);
        const r = result as any;
        if (!r.success) {
          return { content: [{ type: "text", text: `❌ **${r.error}**` }], details: r };
        }
        return {
          content: [{ type: "text", text: `### 🧹 State Cleared\n\n**State Path**: \`${r.statePath}\`\n\nActive child processes were not killed. Use \`child_agent_cleanup\` to stop them.` }],
          details: r,
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `❌ **Failed to clear state**: ${e.message}` }], details: { success: false } };
      }
    }) as ToolHandler,
  });

  pi.registerTool({
    name: "child_agent_create",
    label: "Create Child Agent",
    description: "Creates an isolated child agent session with a specified backend.",
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: "Optional friendly name for referencing this session (e.g. 'audit-script')." })),
      backendMode: Type.Optional(Type.String({ description: "Backend mode: auto, tmux, windows-native, docker, podman, local-shell. Default is auto." })),
      scratchPath: Type.String({ description: "Path to the writable scratch directory for the child agent." }),
    }),
    execute: (async (_toolCallId, params, _signal, _onUpdate, ctx): Promise<any> => {
      const mode = (params.backendMode as any) || "auto";
      const backend = await BackendFactory.createBackend(mode, manager.config.getConfig());
      
      // Ensure we have a scratch path. If not provided, create a per-child one in a safe public dir.
      let scratchPath = params.scratchPath;
      if (!scratchPath) {
        const root = process.platform === 'win32' 
          ? path.join("C:\\Users\\Public", "pi-child-agent", "scratch") 
          : path.join(os.tmpdir(), "pi-child-agent", "scratch");
        scratchPath = path.join(root, `child_${Date.now()}`);
      }

      try {
        // Ensure the scratch directory actually exists
        await fs.mkdir(scratchPath, { recursive: true });
        
        const logPath = path.join(os.tmpdir(), "pi-child-agent", "logs", `child_${Date.now()}.log`);
        const session = await manager.createSession(backend, scratchPath, logPath, params.name);
        
        return {
          content: [{ 
            type: "text", 
            text: `### 🚀 Child Agent Created\n\n${manager.formatStatus(session)}\n\n**Next Step**: Use \`child_agent_send\` to assign a task to this agent.` 
          }],
          details: {},
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `❌ **Failed to create child agent**: ${e.message}` }],
          details: {},
        };
      }
    }) as ToolHandler,
  });

  pi.registerTool({
    name: "child_agent_send",
    label: "Send Task to Child",
    description: "Sends a command or task to a running child agent.",
    parameters: Type.Object({
      id: Type.String({ description: "The ID of the child agent session." }),
      command: Type.String({ description: "The command or task to execute." }),
    }),
    execute: (async (_toolCallId, params, _signal, _onUpdate, ctx): Promise<any> => {
      const session = manager.getSession(params.id);
      if (!session) return { content: [{ type: "text", text: `Error: Child session ${params.id} not found.` }], details: {} };
      if (session.status !== "running") return { content: [{ type: "text", text: `Error: Child session ${params.id} is not running (Status: ${session.status}).` }], details: {} };

      // Security Check: Evaluate command through Policy system
      const decision = manager.guard.checkCommand(params.command);
      const policyMode = manager.config.get("policyMode");

      if (!decision.allowed) {
        if (decision.requiresApproval) {
          const approved = await ctx.ui.confirm(
            `${decision.category.toUpperCase()} Command Detected`,
            `The command "${params.command}" is flagged as ${decision.severity} risk.\n\n**Reason**: ${decision.reason}\n**Policy**: ${policyMode}\n\nDo you want to allow this execution?`
          );
          if (!approved) {
            return { 
              content: [{ type: "text", text: `Command blocked: User denied ${decision.category} command.` }], 
              details: {
                success: false,
                sent: false,
                blocked: true,
                approved: false,
                policyMode,
                category: decision.category,
                severity: decision.severity,
                reason: decision.reason,
                childId: params.id,
                command: params.command
              }
            };
          }
        } else {
          return { 
            content: [{ type: "text", text: `❌ **Blocked**: ${decision.reason}` }], 
            details: {
              success: false,
              sent: false,
              blocked: true,
              approved: false,
              policyMode,
              category: decision.category,
              severity: decision.severity,
              reason: decision.reason,
              childId: params.id,
              command: params.command
            }
          };
        }
      }

      try {
        const targetId = session.pid ? session.pid.toString() : session.id;
        await session.backend.send(targetId, params.command);
        return {
          content: [{ type: "text", text: `Command sent to child agent ${params.id}.` }],
          details: {
            success: true,
            sent: true,
            blocked: false,
            approved: decision.requiresApproval,
            policyMode,
            category: decision.category,
            severity: decision.severity,
            reason: decision.reason,
            childId: params.id,
            command: params.command
          },
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Failed to send command: ${e.message}` }],
          details: {
            success: false,
            sent: false,
            blocked: false,
            approved: false,
            policyMode,
            category: decision.category,
            severity: decision.severity,
            reason: e.message,
            childId: params.id,
            command: params.command
          },
        };
      }
    }) as ToolHandler,
  });

  pi.registerTool({
    name: "child_agent_status",
    label: "Check Child Status",
    description: "Retrieves the current status and metadata of a child agent.",
    parameters: Type.Object({
      id: Type.String({ description: "The ID of the child agent session." }),
    }),
    execute: (async (_toolCallId, params, _signal, _onUpdate, ctx): Promise<any> => {
      const session = manager.getSession(params.id);
      if (!session) return { content: [{ type: "text", text: `❌ **Error**: Child session \`${params.id}\` not found.` }], details: {} };

      return {
        content: [{ type: "text", text: `### 📊 Session Status\n\n${manager.formatStatus(session)}` }],
        details: {},
      };
    }) as ToolHandler,
  });

  pi.registerTool({
    name: "child_agent_read",
    label: "Read Child Output",
    description: "Reads the current output/logs from a child agent.",
    parameters: Type.Object({
      id: Type.String({ description: "The ID of the child agent session." }),
    }),
    execute: (async (_toolCallId, params, _signal, _onUpdate, ctx): Promise<any> => {
      try {
        const logs = await manager.readLog(params.id);
        const formattedLogs = manager.formatLogs(logs);
        return {
          content: [{ type: "text", text: `### 📝 Logs for \`${params.id}\`\n\n\`\`\`text\n${formattedLogs}\n\`\`\`` }],
          details: {},
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `❌ **Failed to read logs**: ${e.message}` }],
          details: {},
        };
      }
    }) as ToolHandler,
  });

  pi.registerTool({
    name: "child_agent_stop",
    label: "Stop Child Agent",
    description: "Stops a running child agent and cleans up its resources.",
    parameters: Type.Object({
      id: Type.String({ description: "The ID of the child agent session." }),
    }),
    execute: (async (_toolCallId, params, _signal, _onUpdate, ctx): Promise<any> => {
      try {
        await manager.stopSession(params.id);
        return {
          content: [{ type: "text", text: `Child agent ${params.id} stopped successfully.` }],
          details: {},
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Failed to stop child agent: ${e.message}` }],
          details: {},
        };
      }
    }) as ToolHandler,
  });

  pi.registerTool({
    name: "child_agent_collect",
    label: "Collect Child Result",
    description: "Reads the final output of a child agent and stops it. Optionally returns a structured summary.",
    parameters: Type.Object({
      id: Type.String({ description: "The ID of the child agent session." }),
      structured: Type.Optional(Type.Boolean({ description: "Whether to return a structured result instead of raw logs. Defaults to false." })),
    }),
    execute: (async (_toolCallId, params, _signal, _onUpdate, ctx): Promise<any> => {
      try {
        const result = await manager.collect(params.id, params.structured);
        
        if (params.structured && typeof result !== "string") {
          // Return structured result as a formatted Markdown table/list in content
          const s = result as any;
          const summary = `### ✅ Structured Result: \`${s.childId}\`\n\n` +
            `**Status**: ${s.status} | **Timed Out**: ${s.timedOut}\n` +
            `**Summary**: ${s.summary}\n\n` +
            `**Errors**: ${s.errors.length} | **Warnings**: ${s.warnings.length}\n` +
            `**Files Mentioned**: ${s.filesMentioned.join(", ") || "None"}\n` +
            `**Commands Run**: ${s.commandsRun.length}\n\n` +
            `**Log Path**: \`${s.logPath}\``;

          return {
            content: [{ type: "text", text: summary }],
            details: s,
          };
        }

        const logs = result as string;
        const formattedLogs = manager.formatLogs(logs);
        return {
          content: [{ type: "text", text: `### ✅ Result Collected\n\nChild agent \`${params.id}\` has been stopped.\n\n**Final Output**:\n\`\`\`text\n${formattedLogs}\n\`\`\`` }],
          details: {},
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `❌ **Failed to collect result**: ${e.message}` }],
          details: {},
        };
      }
    }) as ToolHandler,
  });

  pi.registerTool({
    name: "child_agent_list",
    label: "List Child Agents",
    description: "Lists all currently tracked child agent sessions.",
    parameters: Type.Object({}),
    execute: (async (_toolCallId, _params, _signal, _onUpdate, ctx): Promise<any> => {
      const sessions = manager.listSessions();
      if (sessions.length === 0) return { content: [{ type: "text", text: "No active child agents found." }], details: {} };

      let table = `### 📋 Active Child Agents\n\n| ID | Status | Backend |\n|---|---|---|\n`;
      for (const s of sessions) {
        const statusEmoji = {
          starting: "🟡", running: "🟢", done: "✅", failed: "❌", stopped: "🔴", timed_out: "⚠️", orphaned: "👻",
        }[s.status] || "⚪";
        table += `| \`${s.id}\` | ${statusEmoji} ${s.status} | \`${s.backendType}\` |\n`;
      }

      return {
        content: [{ type: "text", text: table }],
        details: {},
      };
    }) as ToolHandler,
  });

  pi.registerTool({
    name: "child_agent_cleanup",
    label: "Cleanup Child Agents",
    description: "Stops all active child agents and cleans up their resources.",
    parameters: Type.Object({}),
    execute: (async (_toolCallId, _params, _signal, _onUpdate, ctx): Promise<any> => {
      try {
        await manager.cleanupAll();
        return {
          content: [{ type: "text", text: "All child agents have been cleaned up." }],
          details: {},
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Cleanup failed: ${e.message}` }],
          details: {},
        };
      }
    }) as ToolHandler,
  });

  // --- Commands ---

  pi.registerCommand("child-create", {
    description: "Create a child agent (Usage: /child-create <scratchPath> [backendMode] [name])",
    handler: (async (args: string, ctx): Promise<void> => {
      const parts = args ? args.split(" ") : [];
      const scratchPath = parts[0];
      const mode = parts[1] || "auto";
      const sessionName = parts[2] || undefined;

      if (!scratchPath) {
        ctx.ui.notify("Please provide a scratch path.", "error");
        return;
      }

      try {
        const backend = await BackendFactory.createBackend(mode as any, manager.config.getConfig());
        const logPath = path.join(os.tmpdir(), "pi-child-agent", "logs", `child_${Date.now()}.log`);
        const session = await manager.createSession(backend, scratchPath, logPath, sessionName);
        ctx.ui.notify(`Child agent ${session.id} created!${sessionName ? ` (name: ${sessionName})` : ""}`, "info");
      } catch (e: any) {
        ctx.ui.notify(`Error: ${e.message}`, "error");
      }
    }) as CommandHandler,
  });

  // ── Interactive Dashboard Widget ──

  pi.on("session_start", async (_event: any, ctx: any) => {
    ctx.ui.notify("Pi Child Agent extension loaded.", "info");

    // Static status indicator (shows extension is active)
    ctx.ui.setStatus("child-agent", ctx.ui.theme.fg("accent", "🧒"));

    // Live dashboard widget above editor — reads manager state on each render
    ctx.ui.setWidget("child-agent-dashboard", (_tui: any, theme: any) => {
      return {
        render() {
          const sessions = manager.listSessions();
          const running = sessions.filter(s => s.status === "running").length;

          if (sessions.length === 0) return [];

          const lines: string[] = [
            theme.fg("accent", theme.bold(` Child Agents: ${sessions.length} total, ${running} running`)),
            theme.fg("muted", `  ${["ID", "Name", "Status", "Backend", "Uptime"].join(" │ ")}`),
          ];
          for (const s of sessions.slice(0, 8)) {
            const uptime = Math.floor((Date.now() - s.startTime) / 1000);
            const icon = ({ starting: "🟡", running: "🟢", done: "✅", failed: "❌", stopped: "🔴", timed_out: "⚠️", orphaned: "👻" } as any)[s.status] || "⚪";
            const idShort = s.id.length > 16 ? s.id.slice(-16) : s.id;
            lines.push(`  ${idShort.padEnd(16)} │ ${(s.name || "—").padEnd(12)} │ ${icon} ${s.status.padEnd(10)} │ ${s.backendType.padEnd(12)} │ ${uptime}s`);
          }
          if (sessions.length > 8) {
            lines.push(theme.fg("dim", `  … and ${sessions.length - 8} more`));
          }
          return lines;
        },
        invalidate() {},
      };
    });
  });

  pi.on("session_shutdown", async (_event: any, ctx: any) => {
    ctx.ui.setStatus("child-agent", undefined);
    ctx.ui.setWidget("child-agent-dashboard", undefined);
    await manager.cleanupAll();
  });

  // ── Interactive Slash Commands ──

  pi.registerCommand("child-list", {
    description: "List all child agent sessions",
    handler: async (args: string, ctx: any) => {
      const sessions = manager.listSessions();
      if (sessions.length === 0) {
        ctx.ui.notify("No child agents.", "info");
        return;
      }
      let table = "### 🧒 Child Agents\n\n| Name | ID | Status | Backend | Uptime |\n|---|---|---|---|---|\n";
      for (const s of sessions) {
        const uptime = Math.floor((Date.now() - s.startTime) / 1000);
        table += `| ${s.name || "—"} | \`${s.id.slice(-16)}\` | ${s.status} | ${s.backendType} | ${uptime}s |\n`;
      }
      ctx.ui.notify(table, "info");
    },
  });

  pi.registerCommand("child-stop", {
    description: "Stop a child agent (Usage: /child-stop <id|name>)",
    handler: async (args: string, ctx: any) => {
      const id = args?.trim();
      if (!id) {
        ctx.ui.notify("Usage: /child-stop <id|name>", "error");
        return;
      }
      try {
        await manager.stopSession(id);
        ctx.ui.notify(`Child agent **${id}** stopped.`, "info");
      } catch (e: any) {
        ctx.ui.notify(`Error: ${e.message}`, "error");
      }
    },
  });

  pi.registerCommand("child-logs", {
    description: "Show recent logs for a child agent (Usage: /child-logs <id|name>)",
    handler: async (args: string, ctx: any) => {
      const id = args?.trim();
      if (!id) {
        ctx.ui.notify("Usage: /child-logs <id|name>", "error");
        return;
      }
      try {
        const logs = await manager.readLog(id);
        const tail = logs.length > 2000 ? logs.slice(-2000) : logs;
        ctx.ui.notify(`📝 Logs for **${id}**:\n\`\`\`\n${tail}\n\`\`\``, "info");
      } catch (e: any) {
        ctx.ui.notify(`Error: ${e.message}`, "error");
      }
    },
  });

  pi.registerCommand("child-cleanup", {
    description: "Stop all child agents and clean up",
    handler: async (args: string, ctx: any) => {
      try {
        await manager.cleanupAll();
        ctx.ui.notify("All child agents stopped.", "info");
      } catch (e: any) {
        ctx.ui.notify(`Error: ${e.message}`, "error");
      }
    },
  });

  pi.registerCommand("child-queue", {
    description: "Show task queue status",
    handler: async (args: string, ctx: any) => {
      const status = manager.queue.getQueueStatus();
      ctx.ui.notify(
        "### 📋 Queue Status\n\n" +
        `**Active**: ${status.running ? "✅" : "❌"}` +
        ` | **Running**: ${status.runningTasks}` +
        ` | **Queued**: ${status.queued}` +
        ` | **Succeeded**: ${status.succeeded}` +
        ` | **Failed**: ${status.failed}`,
        "info"
      );
    },
  });

  pi.registerCommand("child-help", {
    description: "Show available child-agent commands",
    handler: async (args: string, ctx: any) => {
      ctx.ui.notify(
        "## 🧒 Child Agent Commands\n\n" +
        "| Command | Description |\n" +
        "|---------|-------------|\n" +
        "| `/child-create <path> [backend] [name]` | Create child agent |\n" +
        "| `/child-list` | List all sessions |\n" +
        "| `/child-stop <id\|name>` | Stop a session |\n" +
        "| `/child-logs <id\|name>` | View logs |\n" +
        "| `/child-cleanup` | Stop all |\n" +
        "| `/child-queue` | Queue status |\n" +
        "| `/child-help` | This help |\n\n" +
        "Also use the **18 tools** listed in the LLM tool menu.",
        "info"
      );
    },
  });
}
