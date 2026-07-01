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
    name: "child_agent_create",
    label: "Create Child Agent",
    description: "Creates an isolated child agent session with a specified backend.",
    parameters: Type.Object({
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
        const session = await manager.createSession(backend, scratchPath, logPath);
        
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

      // Security Check: Require approval for high-risk commands
      const guard = new SecurityGuard(manager.config.get("protectedPaths"));
      if (guard.isHighRiskCommand(params.command)) {
        const approved = await ctx.ui.confirm(
          "High-Risk Command Detected",
          `The command "${params.command}" is flagged as high-risk. Do you want to allow the child agent to execute this?`
        );
        if (!approved) {
          return { content: [{ type: "text", text: "Command blocked: User denied execution of high-risk command." }], details: {} };
        }
      }

      try {
        const targetId = session.pid ? session.pid.toString() : session.id;
        await session.backend.send(targetId, params.command);
        return {
          content: [{ type: "text", text: `Command sent to child agent ${params.id}.` }],
          details: {},
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Failed to send command: ${e.message}` }],
          details: {},
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
        let logs = await manager.readLog(params.id);
        // Clean up internal sentinels for the user view
        const cleanLogs = logs.replace(/\[PICA_CMD\].*?\n/g, "👉 **Command**: ").replace(/\[PICA_DONE\]\n/g, "\n✅ **Done**\n");
        
        return {
          content: [{ type: "text", text: `### 📝 Logs for \`${params.id}\`\n\n\`\`\`text\n${cleanLogs}\n\`\`\`` }],
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
    description: "Reads the final output of a child agent and stops it.",
    parameters: Type.Object({
      id: Type.String({ description: "The ID of the child agent session." }),
    }),
    execute: (async (_toolCallId, params, _signal, _onUpdate, ctx): Promise<any> => {
      try {
        const logs = await manager.readLog(params.id);
        await manager.stopSession(params.id);
        return {
          content: [{ type: "text", text: `Collected output for ${params.id} and stopped the agent.\n\nFinal Output:\n${logs}` }],
          details: {},
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Failed to collect result: ${e.message}` }],
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
          starting: "🟡", running: "🟢", done: "✅", failed: "❌", stopped: "🔴", timed_out: "⚠️",
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
    description: "Create a child agent (Usage: /child-create <scratchPath> [backendMode])",
    handler: (async (args: string, ctx): Promise<void> => {
      const parts = args ? args.split(" ") : [];
      const scratchPath = parts[0];
      const mode = parts[1] || "auto";

      if (!scratchPath) {
        ctx.ui.notify("Please provide a scratch path.", "error");
        return;
      }

      try {
        const backend = await BackendFactory.createBackend(mode as any, manager.config.getConfig());
        const logPath = path.join(os.tmpdir(), "pi-child-agent", "logs", `child_${Date.now()}.log`);
        const session = await manager.createSession(backend, scratchPath, logPath);
        ctx.ui.notify(`Child agent ${session.id} created!`, "info");
      } catch (e: any) {
        ctx.ui.notify(`Error: ${e.message}`, "error");
      }
    }) as CommandHandler,
  });

  pi.on("session_start", async (_event: any, ctx: any) => {
    ctx.ui.notify("Pi Child Agent extension loaded.", "info");
  });

  pi.on("session_shutdown", async (_event: any, ctx: any) => {
    await manager.cleanupAll();
  });
}
