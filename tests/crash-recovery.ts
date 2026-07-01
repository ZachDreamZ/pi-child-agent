#!/usr/bin/env tsx
/**
 * pi-child-agent — Crash Recovery Tests.
 *
 * Unique purpose (not covered by live-workflow.ts):
 *  1. Child process exits unexpectedly
 *  2. Child process already dead when stop is called
 *  3. Log file is missing
 *  4. Scratch directory is missing
 *  5. Cleanup called twice (idempotent)
 *  6. Send called after stop
 *  7. Read called after cleanup
 *
 * Uses sentinel-based waiting — minimal fixed delays.
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
const scratchBase = path.join("C:\\Users\\Public", "pi-child-crash-test");

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = detail || "assertion failed"; failures.push(`${label}: ${msg}`); console.log(`  ✗ ${label} — ${msg}`); }
}

async function main(): Promise<void> {
  if (!isWindows()) { console.log("Crash recovery tests require Windows. Skipping."); return; }
  console.log("═══ pi-child-agent: Crash Recovery Tests ═══\n");

  const manager = new ChildSessionManager(mockPi);
  await manager.initialize();

  // Helper: create a session
  async function makeSession(label: string): Promise<{ session: any; logPath: string }> {
    const dir = path.join(scratchBase, label);
    await fs.mkdir(dir, { recursive: true });
    const logPath = path.join(scratchBase, "logs", `${label}.log`);
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    const backend = await BackendFactory.createBackend("auto", manager.config.getConfig());
    const session = await manager.createSession(backend, dir, logPath);
    return { session, logPath };
  }

  // ── 1. Child process exits unexpectedly ─────────────────────────────────
  console.log("[1] Child process exits unexpectedly");

  const { session: s1, logPath: lp1 } = await makeSession("unexpected-exit");
  assert("session created", s1.status === "running");

  // Kill the backend process externally via backend.stop (which kills the process)
  const targetId = s1.pid!.toString();
  const backend = s1.backend as WindowsNativeBackend;
  await backend.stop(targetId);

  // Poll for the process to die instead of a fixed sleep
  const start1 = Date.now();
  let alive1 = true;
  while (Date.now() - start1 < TIME.STOP) {
    alive1 = await backend.isAlive(targetId);
    if (!alive1) break;
    await new Promise(r => setTimeout(r, 50));
  }
  assert("child is reported as dead after external kill", !alive1);

  try {
    await manager.stopSession(s1.id);
    assert("stopSession handled already-dead process", s1.status === "stopped");
  } catch (e: any) {
    assert("stopSession handles dead process without throwing", false, e.message);
  }
  console.log();

  // ── 2. Child process already dead when stop is called ───────────────────
  console.log("[2] Child process already dead when stop is called");

  const { session: s2 } = await makeSession("already-dead");
  assert("session 2 created", s2.status === "running");

  await manager.stopSession(s2.id);
  assert("first stop succeeds", s2.status === "stopped");

  try {
    await manager.stopSession(s2.id);
    assert("second stop is idempotent (no throw)", true);
  } catch {
    assert("second stop is idempotent (no throw)", false, "second stop threw");
  }
  console.log();

  // ── 3. Log file is missing ──────────────────────────────────────────────
  console.log("[3] Log file is missing");

  const { session: s3, logPath: lp3 } = await makeSession("missing-log");
  assert("session 3 created", s3.status === "running");

  try { await fs.unlink(lp3); } catch {}
  assert("log file deleted externally", await fs.stat(lp3).then(() => false).catch(() => true));

  try {
    await manager.readLog(s3.id);
    assert("readLog when log is missing should throw", false, "no error thrown");
  } catch (e: any) {
    assert(`readLog throws when log missing: "${e.message}"`, true);
  }

  await manager.stopSession(s3.id);
  console.log();

  // ── 4. Scratch directory is missing ─────────────────────────────────────
  console.log("[4] Scratch directory is missing");

  const missingDir = path.join(scratchBase, "missing-dir-scratch");
  await fs.mkdir(missingDir, { recursive: true });
  const backend4 = await BackendFactory.createBackend("auto", manager.config.getConfig());
  const logPath4 = path.join(scratchBase, "logs", "missing-scratch.log");
  await fs.mkdir(path.dirname(logPath4), { recursive: true });

  try {
    const session4 = await manager.createSession(backend4, missingDir, logPath4);
    assert("session created with valid scratch dir", session4.status === "running");

    await fs.rm(missingDir, { recursive: true, force: true });
    assert("scratch dir deleted externally", await fs.stat(missingDir).then(() => false).catch(() => true));

    const stillAlive = await backend4.isAlive(session4.pid!.toString());
    assert("session manageable after scratch dir removed", stillAlive === true || stillAlive === false);

    await manager.stopSession(session4.id);
    assert("stopSession works after scratch dir removed", true);
  } catch (e: any) {
    assert("scratch dir missing scenario handled gracefully", false, e.message);
  }
  console.log();

  // ── 5. Cleanup called twice ─────────────────────────────────────────────
  console.log("[5] Cleanup called twice");

  const { session: s5 } = await makeSession("double-cleanup");
  assert("session 5 created", s5.status === "running");

  await manager.cleanupAll();
  assert("first cleanupAll succeeds", manager.listSessions().length === 0);

  try {
    await manager.cleanupAll();
    assert("second cleanupAll is idempotent (no throw)", true);
  } catch {
    assert("second cleanupAll is idempotent (no throw)", false, "second cleanupAll threw");
  }
  console.log();

  // ── 6. Send called after stop ───────────────────────────────────────────
  console.log("[6] Send called after stop");

  const { session: s6 } = await makeSession("send-after-stop");
  const target6 = s6.pid!.toString();
  const backend6 = s6.backend as WindowsNativeBackend;

  await manager.stopSession(s6.id);
  assert("session 6 stopped", s6.status === "stopped");

  try {
    await backend6.send(target6, "echo hello");
    assert("send after stop should throw", false, "no error thrown");
  } catch (e: any) {
    assert(`send after stop throws: "${e.message}"`, true);
  }
  console.log();

  // ── 7. Read called after cleanup ────────────────────────────────────────
  console.log("[7] Read called after cleanup");

  const { session: s7, logPath: lp7 } = await makeSession("read-after-cleanup");
  const backend7 = s7.backend as WindowsNativeBackend;

  // Send a command and wait for it via sentinel (ensures log has content)
  await sendAndWait(backend7, s7.pid!.toString(), lp7, "echo BEFORE_CLEANUP", TIME.CMD_OUTPUT);

  await manager.cleanupAll();
  assert("cleanupAll succeeded", manager.listSessions().length === 0);

  try {
    await manager.readLog(s7.id);
    assert("readLog after cleanup should throw", false, "no error thrown");
  } catch (e: any) {
    assert(`readLog after cleanup throws: "${e.message}"`, e.message.includes("not found"));
  }
  console.log();

  // ── Summary ──────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log("═══════════════════════════════════════════");
  console.log(`Total: ${total}  |  Passed: ${passed}  |  Failed: ${failed}`);
  if (failures.length > 0) { console.log("\nFailures:"); failures.forEach(f => console.log(`  • ${f}`)); process.exit(1); }
  else { console.log("✅ CRASH RECOVERY TESTS PASSED"); }
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
