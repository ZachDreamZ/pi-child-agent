#!/usr/bin/env tsx
/**
 * Live Pi tool-calling workflow test.
 * Runs the full parent-child workflow in a single process.
 */
import { ChildSessionManager } from "../manager.js";
import { BackendFactory } from "../backends/factory.js";
import path from "node:path";
import fs from "node:fs/promises";

const mockPi: any = { registerTool: () => {}, registerCommand: () => {}, on: () => {} };

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = detail || "failed"; failures.push(`${label}: ${msg}`); console.log(`  ✗ ${label} — ${msg}`); }
}

async function main(): Promise<void> {
  console.log("═══ Live Pi Tool-Calling Workflow ═══\n");
  console.log("[1] child_agent_create\n");

  const manager = new ChildSessionManager(mockPi);
  await manager.initialize();

  const scratchPath = path.join("C:\\Users\\Public", "pi-live-workflow-" + Date.now());
  const logPath = path.join(scratchPath, "..", "logs", "live-workflow.log");
  await fs.mkdir(path.dirname(logPath), { recursive: true });

  const backend = await BackendFactory.createBackend("auto", manager.config.getConfig());
  const session = await manager.createSession(backend, scratchPath, logPath);

  assert("session created", session.status === "running");
  assert("session has ID", session.id.length > 0);
  assert("session has PID", (session.pid ?? 0) > 0);
  assert("backend is windows-native", session.backendType === "windows-native");
  assert("scratch path set", session.scratchPath === scratchPath);
  console.log(`     Session ID: ${session.id}`);
  console.log(`     PID: ${session.pid}`);
  console.log(`     Backend: ${session.backendType}`);
  console.log();

  // [2] Send first command
  console.log("[2] child_agent_send: echo CHILD_AGENT_OK\n");
  await backend.send(session.pid!.toString(), "echo CHILD_AGENT_OK");
  // Wait for output to flush
  await new Promise(r => setTimeout(r, 1500));

  // [3] Read output
  console.log("[3] child_agent_read\n");
  let logContent = await manager.readLog(session.id);
  assert("log content is non-empty", logContent.length > 0);
  assert("log contains CHILD_AGENT_OK", logContent.includes("CHILD_AGENT_OK"), logContent);
  console.log(`     Log preview: ${logContent.substring(0, 200)}`);
  console.log();

  // [4] Send second command (prove persistence)
  console.log("[4] child_agent_send: echo SECOND_COMMAND_OK\n");
  await backend.send(session.pid!.toString(), "echo SECOND_COMMAND_OK");
  await new Promise(r => setTimeout(r, 1500));

  // [5] Status
  console.log("[5] child_agent_status\n");
  const s = manager.getSession(session.id)!;
  assert("status is running", s.status === "running");
  assert("PID matches", s.pid === session.pid);
  assert("backend type matches", s.backendType === "windows-native");
  assert("scratch path matches", s.scratchPath === scratchPath);
  assert("log path matches", s.logPath === logPath);
  assert("startTime is set", s.startTime > 0);
  console.log();

  // [6] Read again (should have both commands)
  console.log("[6] child_agent_read (after second command)\n");
  logContent = await manager.readLog(session.id);
  assert("log contains CHILD_AGENT_OK (persisted)", logContent.includes("CHILD_AGENT_OK"));
  assert("log contains SECOND_COMMAND_OK", logContent.includes("SECOND_COMMAND_OK"));
  console.log(`     Log preview: ${logContent.substring(0, 300)}`);
  console.log();

  // [7] Collect (read + stop)
  console.log("[7] child_agent_collect\n");
  const finalLog = await manager.readLog(session.id);
  await manager.stopSession(session.id);
  assert("final log contains expected output", finalLog.includes("CHILD_AGENT_OK") && finalLog.includes("SECOND_COMMAND_OK"));
  assert("session stopped after collect", s.status === "stopped" || s.status === "timed_out");
  console.log();

  // [8] Stop (idempotent)
  console.log("[8] child_agent_stop (idempotent)\n");
  try {
    await manager.stopSession(session.id);
    assert("second stop is idempotent (no throw)", true);
  } catch {
    assert("second stop is idempotent (no throw)", false);
  }
  console.log();

  // [9] List
  console.log("[9] child_agent_list\n");
  const sessions = manager.listSessions();
  assert("session still in list", sessions.length > 0);
  assert("session status is stopped/timed_out", sessions[0].status === "stopped" || sessions[0].status === "timed_out");
  console.log();

  // [10] Cleanup
  console.log("[10] child_agent_cleanup\n");
  await manager.cleanupAll();
  assert("sessions cleared after cleanup", manager.listSessions().length === 0);
  console.log();

  // Summary
  const total = passed + failed;
  console.log("═══════════════════════════════════════════");
  console.log(`Total: ${total}  |  Passed: ${passed}  |  Failed: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  • ${f}`));
    process.exit(1);
  } else {
    console.log("✅ LIVE PI WORKFLOW PASSED");
  }
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
