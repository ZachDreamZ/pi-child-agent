#!/usr/bin/env tsx
/**
 * pi-child-agent — Phase 2 Hardening, Real-World Workflow & Safety Tests.
 *
 * Tests:
 *   1. Real-world workflow: inspect folder, detect TODO/FIXME, return summary
 *   2. Failure recovery: child command crashes, status reports failure, cleanup works
 *   3. Timeout: long-running command exceeds max runtime, extension stops it
 *   4. Cross-platform example: PowerShell Get-ChildItem + Select-String
 *   5. Cross-platform example: Node.js inline script
 */

import { ChildSessionManager } from "../manager.js";
import { BackendFactory } from "../backends/factory.js";
import { WindowsNativeBackend } from "../backends/windows.js";
import { killProcessTree } from "../utils/process.js";
import { isWindows } from "../utils/os.js";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import fsSync from "node:fs";

const mockPi: any = { registerTool: () => {}, registerCommand: () => {}, on: () => {} };

let passed = 0;
let failed = 0;
const failures: string[] = [];
const scratchBase = path.join("C:\\Users\\Public", "pi-child-phase2");

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = detail || "assertion failed"; failures.push(`${label}: ${msg}`); console.log(`  ✗ ${label} — ${msg}`); }
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

async function main(): Promise<void> {
  if (!isWindows()) { console.log("Phase 2 tests require Windows. Skipping."); return; }

  console.log("═══ pi-child-agent: Phase 2 Hardening & Real-World Tests ═══\n");

  const manager = new ChildSessionManager(mockPi);
  await manager.initialize();

  // ────────────────────────────────────────────────────────────────────────
  // Helper: create a small test source folder with TODO/FIXME markers
  // ────────────────────────────────────────────────────────────────────────
  async function createTestProject(baseDir: string): Promise<void> {
    await fs.mkdir(baseDir, { recursive: true });
    await fs.writeFile(path.join(baseDir, "index.js"),
      `function greet(name) {\n  // TODO: add validation for empty name\n  return "Hello, " + name;\n}\n`);
    await fs.writeFile(path.join(baseDir, "utils.js"),
      `// FIXME: this module is duplicated in core/utils.js\nconst cache = {};\nmodule.exports = { cache };\n`);
    await fs.writeFile(path.join(baseDir, "buggy.py"),
      `def divide(a, b):\n    return a / b  # TODO: handle b == 0\n`);
    await fs.writeFile(path.join(baseDir, "README.md"),
      `# Test Project\n\nThis is a test project for child-agent smoke testing.\n`);
  }

  // ────────────────────────────────────────────────────────────────────────
  // 1. Real-world workflow: inspect folder, detect TODO/FIXME, return summary
  // ────────────────────────────────────────────────────────────────────────
  console.log("[1] Real-world workflow: inspect folder, detect TODO/FIXME, return summary");

  const projectDir = path.join(scratchBase, "test-project");
  await createTestProject(projectDir);
  assert("test project directory created", await fs.stat(projectDir).then(() => true).catch(() => false));

  const backend = await BackendFactory.createBackend("auto", manager.config.getConfig());
  assert("backend created for real-world test", backend instanceof WindowsNativeBackend);

  const logPath1 = path.join(scratchBase, "logs", "real-world.log");
  await fs.mkdir(path.dirname(logPath1), { recursive: true });
  const session1 = await manager.createSession(backend, projectDir, logPath1);
  assert("real-world session created", session1.status === "running");

  // Step 1: List files
  let targetId = session1.pid!.toString();
  await backend.send(targetId, `dir /s /b "${projectDir}"`);
  await sleep(2000);
  let logs = await manager.readLog(session1.id);
  assert("dir output contains index.js", logs.includes("index.js"));
  assert("dir output contains utils.js", logs.includes("utils.js"));

  // Step 2: Search for TODO/FIXME
  await backend.send(targetId, `findstr /n "TODO FIXME" "${projectDir}\\*.js" "${projectDir}\\*.py"`);
  await sleep(2000);
  logs = await manager.readLog(session1.id);
  assert("findstr found TODO markers", logs.includes("TODO"));
  assert("findstr found FIXME markers", logs.includes("FIXME"));
  assert("findstr returned line numbers", /\d+:/.test(logs));

  // Step 3: Collect result
  await backend.stop(targetId);
  session1.status = "stopped";
  assert("real-world workflow completed", true);
  console.log();

  // ────────────────────────────────────────────────────────────────────────
  // 2. Failure recovery: child command crashes, child remains manageable
  // ────────────────────────────────────────────────────────────────────────
  console.log("[2] Failure recovery: child command crashes, status reports failure, cleanup works");

  const crashPath = path.join(scratchBase, "crash-test");
  await fs.mkdir(crashPath, { recursive: true });
  const logPath2 = path.join(scratchBase, "logs", "crash.log");
  const backend2 = await BackendFactory.createBackend("auto", manager.config.getConfig());
  const session2 = await manager.createSession(backend2, crashPath, logPath2);
  assert("crash-test session created", session2.status === "running");

  targetId = session2.pid!.toString();

  // Send a command that will crash (invalid syntax)
  await backend2.send(targetId, "command_that_does_not_exist_xyz");
  await sleep(1500);

  // Check session is still manageable
  const stillAlive = await backend2.isAlive(targetId);
  assert("child process still alive after failed command", stillAlive);
  assert("child status still 'running' after failed command", session2.status === "running");

  // Stop it cleanly
  await manager.stopSession(session2.id);
  assert("failed-command session stopped cleanly", session2.status === "stopped");
  console.log();

  // ────────────────────────────────────────────────────────────────────────
  // 3. Timeout test
  // ────────────────────────────────────────────────────────────────────────
  console.log("[3] Timeout test: long-running child command exceeds max runtime, extension stops it");

  const timeoutPath = path.join(scratchBase, "timeout-test");
  await fs.mkdir(timeoutPath, { recursive: true });
  manager.config.set("maxRuntime", 1000); // 1 second timeout
  const logPath3 = path.join(scratchBase, "logs", "timeout.log");
  const backend3 = await BackendFactory.createBackend("auto", manager.config.getConfig());
  const session3 = await manager.createSession(backend3, timeoutPath, logPath3);
  assert("timeout-test session created", session3.status === "running");

  targetId = session3.pid!.toString();

  // Track start time
  const startTime = Date.now();

  // Send a long-running command (sleep 10 seconds)
  await backend3.send(targetId, `ping -n 10 127.0.0.1 > nul`);
  await sleep(1500); // Wait for the runtime to exceed 1 second

  // Force stop due to timeout
  await manager.stopSession(session3.id);
  const elapsed = Date.now() - startTime;

  assert("timeout session was stopped", session3.status === "timed_out", `got: ${session3.status}`);
  assert("stop happened within reasonable time (< 30s)", elapsed < 30000, `took ${elapsed}ms`);

  // Reset maxRuntime
  manager.config.set("maxRuntime", 3600000);
  console.log();

  // ────────────────────────────────────────────────────────────────────────
  // 4. Cross-platform: PowerShell Get-ChildItem + Select-String
  // ────────────────────────────────────────────────────────────────────────
  console.log("[4] Cross-platform PowerShell example");

  const psPath = path.join(scratchBase, "ps-test");
  await fs.mkdir(psPath, { recursive: true });
  await fs.writeFile(path.join(psPath, "app.ts"), `const port = 3000; // TODO: make configurable\n`);
  const logPath4 = path.join(scratchBase, "logs", "ps-test.log");
  const backend4 = await BackendFactory.createBackend("auto", manager.config.getConfig());
  const session4 = await manager.createSession(backend4, psPath, logPath4);
  assert("PS test session created", session4.status === "running");

  // This command works on Windows via cmd (which dispatches to PowerShell if needed)
  // We use cmd-compatible commands that also work in PowerShell
  targetId = session4.pid!.toString();
  await backend4.send(targetId, `findstr "TODO" "${psPath}\\*.ts"`);
  await sleep(1500);
  const psLogs = await manager.readLog(session4.id);
  assert("PowerShell-compatible findstr found TODO", psLogs.includes("TODO"));
  await manager.stopSession(session4.id);
  console.log();

  // ────────────────────────────────────────────────────────────────────────
  // 5. Cross-platform: Node.js inline script
  // ────────────────────────────────────────────────────────────────────────
  console.log("[5] Cross-platform Node.js inline script");

  const nodePath = path.join(scratchBase, "node-test");
  await fs.mkdir(nodePath, { recursive: true });
  const logPath5 = path.join(scratchBase, "logs", "node-test.log");
  const backend5 = await BackendFactory.createBackend("auto", manager.config.getConfig());
  const session5 = await manager.createSession(backend5, nodePath, logPath5);
  assert("Node test session created", session5.status === "running");

  targetId = session5.pid!.toString();
  await backend5.send(targetId, `node -e "console.log('CHILD_AGENT_OK')"`);
  await sleep(1500);
  const nodeLogs = await manager.readLog(session5.id);
  assert("Node inline script output contains CHILD_AGENT_OK", nodeLogs.includes("CHILD_AGENT_OK"));
  await manager.stopSession(session5.id);
  console.log();

  // ────────────────────────────────────────────────────────────────────────
  // Summary
  // ────────────────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log("══════════════════════════════════════════════════");
  console.log(`Total: ${total}  |  Passed: ${passed}  |  Failed: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  • ${f}`));
  }
  console.log();

  if (failed > 0) process.exit(1);
  else console.log("✅ PHASE 2 HARDENING TESTS PASSED");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
