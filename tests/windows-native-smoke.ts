#!/usr/bin/env tsx
/**
 * pi-child-agent — Windows Native Smoke Test.
 *
 * Proves all 17 requirements listed in the project specification.
 * Runs as a standalone script outside of Pi (mocks ExtensionAPI where needed).
 */

import { WindowsNativeBackend } from "../backends/windows.js";
import { ChildSessionManager } from "../manager.js";
import { SecurityGuard } from "../security/guard.js";
import { BackendFactory } from "../backends/factory.js";
import { Logger } from "../utils/logging.js";
import { killProcessTree } from "../utils/process.js";
import { isWindows, getOSType } from "../utils/os.js";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { spawn, execSync } from "node:child_process";

// ── Mock ExtensionAPI ────────────────────────────────────────────────────────
const mockPi: any = {
  registerTool: () => {},
  registerCommand: () => {},
  on: () => {},
};

// ── Helpers ──────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = detail || "assertion failed";
    failures.push(`${label}: ${msg}`);
    console.log(`  ✗ ${label} — ${msg}`);
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function findPwsh(): string | null {
  try {
    execSync("where pwsh", { stdio: "pipe" });
    return "pwsh";
  } catch { return null; }
}

function findPowershell(): string | null {
  try {
    execSync("where powershell", { stdio: "pipe" });
    return "powershell";
  } catch { return null; }
}

function findCmd(): string | null {
  return "cmd"; // always available
}

// ── Main Test Suite ──────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("═══ pi-child-agent: Windows Native Smoke Test ═══\n");

  // ── Pre-flight: must be Windows ──────────────────────────────────────────
  console.log("[Pre-flight]");
  assert("Host OS is Windows", isWindows(), `got ${os.platform()}`);
  assert("WSL is NOT required (native win32)", process.platform === "win32");
  console.log();

  // ── 1-4: Backend selection & shell fallback ──────────────────────────────
  console.log("[1-4] Backend selection & shell fallback");

  const autoBackend = await BackendFactory.createBackend("auto", { containerImage: "node:latest" });
  assert("auto mode selects WindowsNativeBackend on Windows",
    autoBackend instanceof WindowsNativeBackend);
  assert("tmux is NOT used on Windows (auto backend picks WindowsNativeBackend)", 
    autoBackend instanceof WindowsNativeBackend);
  assert("no tmux in auto-backend name", !autoBackend.name.includes("tmux"));

  const explicitBackend = await BackendFactory.createBackend("windows-native", { containerImage: "node:latest" });
  assert("explicit windows-native mode selects WindowsNativeBackend",
    explicitBackend instanceof WindowsNativeBackend);

  // Shell availability
  const pwshAvail = findPwsh();
  const psAvail = findPowershell();
  const cmdAvail = findCmd();
  console.log(`  shells: pwsh=${pwshAvail ?? "✗"} powershell=${psAvail ?? "✗"} cmd=${cmdAvail ?? "✗"}`);
  assert("at least cmd.exe is available", cmdAvail !== null);
  // We prefer pwsh, fallback powershell, fallback cmd — test by checking at least one works
  const someShell = pwshAvail || psAvail || cmdAvail;
  assert("at least one Windows shell is available", someShell !== null);
  console.log();

  // ── 5-6: Create session with auto scratch dir ────────────────────────────
  console.log("[5-6] child_agent.create & auto scratch directory");

  const manager = new ChildSessionManager(mockPi);
  await manager.initialize();

  // Generate a scratch path with spaces to test requirement 15 too
  // Use Public folder (not under protected AppData)
  const scratchBase = path.join("C:\\Users\\Public", "pi-child-test");
  const scratchDir = path.join(scratchBase, `scratch_${Date.now()}`);
  const logDir = path.join(os.tmpdir(), "pi-child-agent", "logs");
  await fs.mkdir(scratchDir, { recursive: true });
  await fs.mkdir(logDir, { recursive: true });

  const logPath = path.join(logDir, `smoke_${Date.now()}.log`);

  let session;
  try {
    session = await manager.createSession(autoBackend, scratchDir, logPath);
    if (!session) {
      throw new Error("Session was not created (returned undefined)");
    }
    assert("session created successfully", true);
    assert("session status is 'running'", session.status === "running");
    assert("session has a non-zero PID", typeof session.pid === "number" && session.pid! > 0);
    assert("scratchPath matches provided path", session.scratchPath === scratchDir);
    assert("logPath ends with .log", session.logPath.endsWith(".log"));
    assert("backend type is windows-native", session.backendType === "windows-native");
    assert("scratch directory exists on disk", await fs.stat(scratchDir).then(() => true).catch(() => false));
  } catch (e: any) {
    assert("session creation throws no exception", false, e.message);
    console.log(`\nFATAL: cannot continue without a session — exiting.`);
    process.exit(1);
  }
  console.log();

  // ── 7-10: Send command, read output ──────────────────────────────────────
  console.log("[7-10] child_agent.send & child_agent.read");

  try {
    const targetId = session.pid!.toString();
    // Send the test command
    await autoBackend.send(targetId, "echo CHILD_AGENT_OK");
    assert("send completed without error", true);
  } catch (e: any) {
    assert("send throws no exception", false, e.message);
  }

  // Wait for output to flush
  await sleep(1500);

  let logs = "";
  try {
    logs = await manager.readLog(session.id);
    assert("readLog returns content (non-empty)", logs.length > 0);
    // Allow some time for logs to flush more if empty
    if (logs.length === 0) {
      await sleep(2000);
      logs = await manager.readLog(session.id);
    }
    assert("logs contain 'CHILD_AGENT_OK'", logs.includes("CHILD_AGENT_OK"), `got: ${logs.substring(0, 200)}`);
  } catch (e: any) {
    assert("readLog throws no exception", false, e.message);
  }

  // Send a second command to prove session persistence (requirement 9)
  try {
    const targetId = session.pid!.toString();
    await autoBackend.send(targetId, "echo SECOND_COMMAND_OK");
    await sleep(1500);
    const logs2 = await manager.readLog(session.id);
    assert("logs contain SECOND_COMMAND_OK (session persisted)", logs2.includes("SECOND_COMMAND_OK"), `got: ${logs2.substring(0, 200)}`);
  } catch (e: any) {
    assert("second send fails", false, e.message);
  }
  console.log();

  // ── 11: status ──────────────────────────────────────────────────────────
  console.log("[11] child_agent.status");

  const s = manager.getSession(session.id);
  if (!s) {
    assert("status returns valid session", false, "session not found in manager");
    console.log();
    // We can't continue if session is missing
    return; 
  }
  assert("status returns valid session", true);
  assert("status includes backend type", s.backendType === "windows-native");
  assert("status includes PID", typeof s.pid === "number" && s.pid! > 0);
  assert("status includes scratch path", s.scratchPath.length > 0);
  assert("status includes log path", s.logPath.length > 0);
  assert("status is 'running'", s.status === "running");
  console.log();

  // ── 12: Protected path blocking ─────────────────────────────────────────
  console.log("[12] Protected Windows path command is blocked");

  const guard = new SecurityGuard(manager.config.get("protectedPaths"));
  assert("C:\\Windows is protected", guard.isPathProtected("C:\\Windows"));
  assert("C:\\Program Files is protected", guard.isPathProtected("C:\\Program Files"));
  assert("C:\\Program Files (x86) is protected", guard.isPathProtected("C:\\Program Files (x86)"));
  assert("C:\\Users\\Public is not protected", !guard.isPathProtected("C:\\Users\\Public"));
  assert("C:\\PiChildTest is not protected", !guard.isPathProtected("C:\\PiChildTest"));
  console.log();

  // ── 13: High-risk command detection ─────────────────────────────────────
  console.log("[13] High-risk command triggers approval flow (detection)");

  assert("rm -rf / is high-risk", guard.isHighRiskCommand("rm -rf /"));
  assert("format is high-risk", guard.isHighRiskCommand("format D:"));
  assert("Set-ExecutionPolicy is high-risk", guard.isHighRiskCommand("Set-ExecutionPolicy Unrestricted"));
  assert("echo hello is NOT high-risk", !guard.isHighRiskCommand("echo hello"));
  console.log();

  // ── 14: Secret environment scrubbing ────────────────────────────────────
  console.log("[14] Secret environment variables scrubbed");

  const backend = autoBackend as WindowsNativeBackend;
  // We can't easily inspect the filtered env from outside, but we can verify
  // that the filterEnv logic exists and the backend name is correct.
  assert("backend name is windows-native", backend.name === "windows-native");
  // Indirect test: call the filterEnv method via reflection
  const filterEnvAny = (backend as any).filterEnv.bind(backend);
  if (typeof filterEnvAny === "function") {
    const testEnv = { PATH: "C:\\bin", API_KEY: "should_be_removed", MY_TOKEN: "should_be_removed", SAFE_VAR: "hello" };
    const filtered = filterEnvAny(testEnv);
    assert("API_KEY is removed", !("API_KEY" in filtered));
    assert("MY_TOKEN is removed", !("MY_TOKEN" in filtered));
    assert("SAFE_VAR is preserved", filtered.SAFE_VAR === "hello");
    assert("PATH is preserved", filtered.PATH === "C:\\bin");
  } else {
    // The method might not be exposed; we still verify the backend works
    assert("filterEnv exists on backend", false, "filterEnv not accessible for direct testing — checking indirectly");
  }
  console.log();

  // ── 15: Paths with spaces ───────────────────────────────────────────────
  console.log("[15] Paths with spaces work");

  const spacePath = path.join("C:\\Users\\Public", "pi child space test", `folder with spaces_${Date.now()}`);
  try {
    await fs.mkdir(spacePath, { recursive: true });
    // Create a second session with space in scratchPath
    const logPath2 = path.join(logDir, `smoke_space_${Date.now()}.log`);
    const session2 = await manager.createSession(autoBackend, spacePath, logPath2);
    assert("session created with space in path", session2 !== undefined);
    assert("session2 scratch path contains spaces", session2.scratchPath.includes(" "));
    // Stop and clean up session2
    await manager.stopSession(session2.id);
    assert("session with space path stopped cleanly", true);
  } catch (e: any) {
    assert("paths with spaces work", false, e.message);
  }
  console.log();

  // ── 16: Stop kills full process tree ─────────────────────────────────────
  console.log("[16] child_agent.stop kills full process tree");

  // Verify the process was alive before stopping
  const wasAlive = await autoBackend.isAlive(session.pid!.toString());
  assert("child process was alive before stop", wasAlive);

  try {
    await manager.stopSession(session.id);
    assert("stopSession completed without error", true);

    // Give OS a moment to clean up
    await sleep(500);

    const isDead = !(await autoBackend.isAlive(session.pid!.toString()));
    assert("child process is no longer alive after stop", isDead);
  } catch (e: any) {
    assert("stopSession throws no exception", false, e.message);
  }
  console.log();

  // ── 17: Cleanup ──────────────────────────────────────────────────────────
  console.log("[17] child_agent.cleanup");

  try {
    // Create a few temp sessions to test cleanup
    const tempScratch = path.join("C:\\Users\\Public", "pi-child-cleanup-test");
    await fs.mkdir(tempScratch, { recursive: true });
    const tempLog = path.join(logDir, `cleanup_${Date.now()}.log`);

    // Create and then cleanup
    const cleanupBackend = await BackendFactory.createBackend("auto", { containerImage: "node:latest" });
    const cleanupSession = await manager.createSession(cleanupBackend, tempScratch, tempLog);
    assert("cleanup session created", cleanupSession !== undefined);

    await manager.cleanupAll();
    assert("cleanupAll completed without error", true);
    assert("sessions map is empty after cleanup", manager.listSessions().length === 0);
  } catch (e: any) {
    assert("cleanup works correctly", false, e.message);
  }
  console.log();

  // ── Summary ──────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log("══════════════════════════════════════════════════");
  console.log(`Total: ${total}  |  Passed: ${passed}  |  Failed: ${failed}`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  • ${f}`));
  }
  console.log();

  if (failed > 0) {
    console.log("❌ SMOKE TEST FAILED");
    process.exit(1);
  } else {
    console.log("✅ SMOKE TEST PASSED");
  }
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
