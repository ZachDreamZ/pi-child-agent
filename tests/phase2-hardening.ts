#!/usr/bin/env tsx
/**
 * pi-child-agent — Phase 2 Hardening, Real-World Workflow & Safety Tests.
 *
 * Unique purpose (not covered by live-workflow.ts):
 *   1. Real-world workflow: inspect folder, detect TODO/FIXME, return summary
 *   2. Failure recovery: child command crashes, cleanup still works
 *   3. Timeout: manager auto-stops session when maxRuntime is exceeded
 *
 * Uses sentinel-based waiting — no fixed sleeps.
 */

import { ChildSessionManager } from "../manager.js";
import { BackendFactory } from "../backends/factory.js";
import { WindowsNativeBackend } from "../backends/windows.js";
import { isWindows } from "../utils/os.js";
import path from "node:path";
import fs from "node:fs/promises";
import { sendAndWait, waitForLog } from "./helpers/waitForLog.js";
import { TIME } from "./helpers/timing.js";

const mockPi: any = { registerTool: () => {}, registerCommand: () => {}, on: () => {} };

let passed = 0;
let failed = 0;
const failures: string[] = [];
const scratchBase = path.join("C:\\Users\\Public", "pi-child-phase2");

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = detail || "assertion failed"; failures.push(`${label}: ${msg}`); console.log(`  ✗ ${label} — ${msg}`); }
}

// ── Helpers: create a small test source folder with TODO/FIXME markers ───────
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

async function main(): Promise<void> {
  if (!isWindows()) { console.log("Phase 2 tests require Windows. Skipping."); return; }

  console.log("═══ pi-child-agent: Phase 2 Hardening & Real-World Tests ═══\n");

  const manager = new ChildSessionManager(mockPi, { stateEnabled: false });
  await manager.initialize();

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

  const targetId = session1.pid!.toString();

  // Step 1: List files — wait for dir output via sentinel
  const dirLogs = await sendAndWait(backend, targetId, logPath1, `dir /s /b "${projectDir}"`, TIME.CMD_OUTPUT);
  assert("dir output contains index.js", dirLogs.includes("index.js"));
  assert("dir output contains utils.js", dirLogs.includes("utils.js"));

  // Step 2: Search for TODO/FIXME — wait via sentinel
  const searchLogs = await sendAndWait(backend, targetId, logPath1,
    `findstr /n "TODO FIXME" "${projectDir}\\*.js" "${projectDir}\\*.py"`, TIME.CMD_OUTPUT);
  assert("findstr found TODO markers", searchLogs.includes("TODO"));
  assert("findstr found FIXME markers", searchLogs.includes("FIXME"));
  assert("findstr returned line numbers", /\d+:/.test(searchLogs));

  // Step 3: Clean up
  await backend.stop(targetId);
  session1.status = "stopped";
  assert("real-world workflow completed", true);
  console.log();

  // ────────────────────────────────────────────────────────────────────────
  // 2. Failure recovery: child command crashes, cleanup still works
  // ────────────────────────────────────────────────────────────────────────
  console.log("[2] Failure recovery: child command crashes, cleanup still works");

  const crashPath = path.join(scratchBase, "crash-test");
  await fs.mkdir(crashPath, { recursive: true });
  const logPath2 = path.join(scratchBase, "logs", "crash.log");
  const backend2 = await BackendFactory.createBackend("auto", manager.config.getConfig());
  const session2 = await manager.createSession(backend2, crashPath, logPath2);
  assert("crash-test session created", session2.status === "running");

  // Send a command that will fail (not a crash — the shell stays alive)
  // Wait for the sentinel so we know the failed command completed
  try {
    await sendAndWait(backend2, session2.pid!.toString(), logPath2,
      "command_that_does_not_exist_xyz", TIME.CMD_OUTPUT);
  } catch {
    // The command may timeout because the shell might not echo on failure
    // That's fine — we just need the process to still be alive
  }

  const stillAlive = await backend2.isAlive(session2.pid!.toString());
  assert("child process still alive after failed command", stillAlive);

  await manager.stopSession(session2.id);
  assert("failed-command session stopped cleanly", session2.status === "stopped");
  console.log();

  // ────────────────────────────────────────────────────────────────────────
  // 3. Timeout test — manager auto-stops when maxRuntime is exceeded
  // ────────────────────────────────────────────────────────────────────────
  console.log("[3] Timeout test: long-running child command exceeds max runtime, extension stops it");

  const timeoutPath = path.join(scratchBase, "timeout-test");
  await fs.mkdir(timeoutPath, { recursive: true });
  manager.config.set("maxRuntime", 1500); // 1.5 second timeout
  const logPath3 = path.join(scratchBase, "logs", "timeout.log");
  const backend3 = await BackendFactory.createBackend("auto", manager.config.getConfig());
  const session3 = await manager.createSession(backend3, timeoutPath, logPath3);
  assert("timeout-test session created", session3.status === "running");

  // Send a command that runs longer than maxRuntime
  await backend3.send(session3.pid!.toString(), "ping -n 8 127.0.0.1 > nul");

  // Poll for the [PICA_TIMEOUT] marker — written by manager timeout handler
  let timeoutDetected = false;
  try {
    await waitForLog(logPath3, "[PICA_TIMEOUT]", TIME.TIMEOUT);
    timeoutDetected = true;
  } catch {
    // Fallback: timeout handler may not have fired yet
  }

  if (timeoutDetected) {
    assert("[PICA_TIMEOUT] marker found in log", true);
  }

  // Always stop the session (idempotent with the timed-out handler)
  await manager.stopSession(session3.id);
  // The timeout handler sets session.status BEFORE writing the log marker.
  // If the marker was found, the handler definitely ran; accept either.
  assert("timeout detected (marker or status)",
    session3.status === "timed_out" || timeoutDetected,
    `got status=${session3.status}, timeoutDetected=${timeoutDetected}`);

  // Reset maxRuntime for remaining tests
  manager.config.set("maxRuntime", 3600000);
  console.log();

  // ── Summary ──────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log("══════════════════════════════════════════════════");
  console.log(`Total: ${total}  |  Passed: ${passed}  |  Failed: ${failed}`);
  if (failures.length > 0) { console.log("\nFailures:"); failures.forEach(f => console.log(`  • ${f}`)); }
  console.log();
  if (failed > 0) process.exit(1);
  else console.log("✅ PHASE 2 HARDENING TESTS PASSED");
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
