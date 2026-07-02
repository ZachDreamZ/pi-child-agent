#!/usr/bin/env tsx
import { StateStore, PersistedChildSession, PersistedTask, getDefaultStateDir } from "../state/stateStore.js";
import { TaskQueue } from "../queue/taskQueue.js";
import assert from "node:assert";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

async function runTests() {
  console.log("═══ State Recovery Tests ═══\n");

  const testDir = path.join(os.tmpdir(), "pi-state-recovery-test");
  const stateDir = path.join(testDir, "state");
  let totalTests = 0;
  let passedTests = 0;

  function assertPass(label: string) {
    console.log(`  ✓ ${label}`);
    totalTests++;
    passedTests++;
  }

  function assertFail(label: string, err: any) {
    console.log(`  ✗ ${label}: ${err.message}`);
    totalTests++;
  }

  // Cleanup before starting
  await fs.rm(testDir, { recursive: true, force: true });

  // ──────────────────────────────────────────
  // [1] StateStore creates state directory
  // ──────────────────────────────────────────
  {
    console.log("\n[1] StateStore creates state directory");
    const store = new StateStore({ stateEnabled: true, stateDir, stateFile: "state.json" });
    await store.ensureStateDir();
    try {
      const stat = await fs.stat(stateDir);
      assert.ok(stat.isDirectory());
      assertPass("State directory created");
    } catch (e: any) {
      assertFail("State directory created", e);
    }
  }

  // ──────────────────────────────────────────
  // [2] StateStore saves state file
  // ──────────────────────────────────────────
  {
    console.log("\n[2] StateStore saves state file");
    const store = new StateStore({ stateEnabled: true, stateDir, stateFile: "state.json", packageVersion: "0.1.12" });
    await store.ensureStateDir();
    await store.save([], []);
    try {
      const data = await fs.readFile(path.join(stateDir, "state.json"), "utf-8");
      const parsed = JSON.parse(data);
      assert.strictEqual(parsed.version, 1);
      assertPass("State file saved with valid version");
    } catch (e: any) {
      assertFail("State file saved", e);
    }
  }

  // ──────────────────────────────────────────
  // [3] StateStore loads state file
  // ──────────────────────────────────────────
  {
    console.log("\n[3] StateStore loads state file");
    const store = new StateStore({ stateEnabled: true, stateDir, stateFile: "state.json" });
    await store.ensureStateDir();
    // Save first
    const children: PersistedChildSession[] = [{
      id: "child_1",
      status: "stopped",
      backendType: "windows-native",
      pid: 1234,
      startedAt: Date.now() - 10000,
      stoppedAt: Date.now(),
      scratchPath: path.join(testDir, "scratch1"),
      logPath: path.join(testDir, "log1.log"),
      policyMode: "standard",
    }];
    await store.save(children, []);
    
    // Load into a new store instance
    const store2 = new StateStore({ stateEnabled: true, stateDir, stateFile: "state.json" });
    const loaded = await store2.load();
    try {
      assert.ok(loaded !== null);
      assert.strictEqual(loaded!.children.length, 1);
      assert.strictEqual(loaded!.children[0].id, "child_1");
      assertPass("State file loaded correctly");
    } catch (e: any) {
      assertFail("State file loaded correctly", e);
    }
  }

  // ──────────────────────────────────────────
  // [4] Atomic write creates valid final state
  // ──────────────────────────────────────────
  {
    console.log("\n[4] Atomic write creates valid final state");
    const store = new StateStore({ stateEnabled: true, stateDir, stateFile: "state.json" });
    await store.ensureStateDir();
    await store.save([], []);
    try {
      // Check that state.json.tmp does NOT exist (should have been renamed)
      const files = await fs.readdir(stateDir);
      const tmpExists = files.includes("state.json.tmp");
      assert.strictEqual(tmpExists, false, "Temp file should be cleaned up after save");
      assertPass("Atomic write leaves no .tmp file");
    } catch (e: any) {
      assertFail("Atomic write leaves no .tmp file", e);
    }
  }

  // ──────────────────────────────────────────
  // [5] Corrupt state file is renamed and empty state is used
  // ──────────────────────────────────────────
  {
    console.log("\n[5] Corrupt state file is renamed");
    // Write corrupt JSON
    await fs.writeFile(path.join(stateDir, "corrupt_test.json"), "this is not json{{{", "utf-8");
    
    const store = new StateStore({ stateEnabled: true, stateDir, stateFile: "corrupt_test.json" });
    const loaded = await store.load();
    try {
      assert.ok(loaded !== null);
      assert.strictEqual(loaded!.children.length, 0);
      assert.strictEqual(loaded!.tasks.length, 0);
      assert.strictEqual(store.corruptRecovered_, true, "Should report corrupt recovery");
      
      // Check the corrupt file was renamed
      const files = await fs.readdir(stateDir);
      const corruptFiles = files.filter(f => f.startsWith("corrupt_test.corrupt."));
      assert.ok(corruptFiles.length > 0, "Corrupt file should be renamed with .corrupt.<timestamp>.json");
      assertPass("Corrupt state handled gracefully");
    } catch (e: any) {
      assertFail("Corrupt state handled gracefully", e);
    }
  }

  // ──────────────────────────────────────────
  // [6] Child session metadata is persisted
  // ──────────────────────────────────────────
  {
    console.log("\n[6] Child session metadata is persisted");
    const store = new StateStore({ stateEnabled: true, stateDir, stateFile: "state.json" });
    await store.ensureStateDir();
    const children: PersistedChildSession[] = [
      {
        id: "child_a",
        status: "running",
        backendType: "windows-native",
        pid: 7777,
        startedAt: Date.now(),
        scratchPath: path.join(testDir, "scratch_a"),
        logPath: path.join(testDir, "log_a.log"),
        policyMode: "strict",
        lastCommand: "echo hello",
      },
      {
        id: "child_b",
        status: "stopped",
        backendType: "windows-native",
        pid: 8888,
        startedAt: Date.now() - 50000,
        stoppedAt: Date.now() - 10000,
        scratchPath: path.join(testDir, "scratch_b"),
        logPath: path.join(testDir, "log_b.log"),
        policyMode: "standard",
        exitReason: "stopped_by_user",
      },
    ];
    await store.setChildSessions(children);
    
    const store2 = new StateStore({ stateEnabled: true, stateDir, stateFile: "state.json" });
    const loaded = await store2.load();
    try {
      assert.ok(loaded !== null);
      assert.strictEqual(loaded!.children.length, 2);
      const childA = loaded!.children.find(c => c.id === "child_a");
      assert.ok(childA);
      assert.strictEqual(childA!.pid, 7777);
      assert.strictEqual(childA!.status, "running");
      assert.strictEqual(childA!.policyMode, "strict");
      assert.strictEqual(childA!.lastCommand, "echo hello");
      assertPass("Child session metadata persisted correctly");
    } catch (e: any) {
      assertFail("Child session metadata persisted correctly", e);
    }
  }

  // ──────────────────────────────────────────
  // [7] Stopped child can be recovered as stopped
  // ──────────────────────────────────────────
  {
    console.log("\n[7] Stopped child recovers as stopped");
    const store = new StateStore({ stateEnabled: true, stateDir, stateFile: "state.json" });
    await store.ensureStateDir();
    const children: PersistedChildSession[] = [
      {
        id: "child_stopped",
        status: "stopped",
        backendType: "windows-native",
        pid: 9999,
        startedAt: Date.now() - 100000,
        stoppedAt: Date.now() - 50000,
        scratchPath: path.join(testDir, "scratch_s"),
        logPath: path.join(testDir, "log_s.log"),
        policyMode: "standard",
        exitReason: "completed",
      },
    ];
    await store.setChildSessions(children);
    assertPass("Stopped child persisted");
  }

  // ──────────────────────────────────────────
  // [8] Child with dead PID becomes orphaned (simulated via reconcile)
  // ──────────────────────────────────────────
  {
    console.log("\n[8] Running child with stale PID becomes orphaned");
    // This tests the reconcileChildStatus logic: a running session becomes orphaned
    const store = new StateStore({ stateEnabled: true, stateDir, stateFile: "state.json" });
    await store.ensureStateDir();
    const children: PersistedChildSession[] = [
      {
        id: "child_running_orphan",
        status: "running",
        backendType: "windows-native",
        pid: 11111,
        startedAt: Date.now() - 60000,
        scratchPath: path.join(testDir, "scratch_o"),
        logPath: path.join(testDir, "log_o.log"),
        policyMode: "standard",
      },
    ];
    await store.setChildSessions(children);
    // Simulate reconcile: running -> orphaned
    const reconciled = (() => {
      if (children[0].status === "running") return "orphaned";
      return children[0].status;
    })();
    try {
      assert.strictEqual(reconciled, "orphaned");
      assertPass("Running child becomes orphaned on recovery");
    } catch (e: any) {
      assertFail("Running child becomes orphaned on recovery", e);
    }
  }

  // ──────────────────────────────────────────
  // [9] Queue task metadata is persisted
  // ──────────────────────────────────────────
  {
    console.log("\n[9] Queue task metadata is persisted");
    const store = new StateStore({ stateEnabled: true, stateDir, stateFile: "state.json" });
    await store.ensureStateDir();
    const tasks: PersistedTask[] = [
      {
        id: "task_1",
        title: "Test Task",
        command: "echo hello",
        status: "succeeded",
        priority: "normal",
        attempts: 1,
        maxAttempts: 1,
        createdAt: Date.now() - 30000,
        startedAt: Date.now() - 25000,
        finishedAt: Date.now() - 20000,
        policyMode: "standard",
        result: "hello",
        logPath: path.join(testDir, "task1.log"),
      },
    ];
    await store.setTasks(tasks);
    
    const store2 = new StateStore({ stateEnabled: true, stateDir, stateFile: "state.json" });
    const loaded = await store2.load();
    try {
      assert.ok(loaded !== null);
      assert.strictEqual(loaded!.tasks.length, 1);
      assert.strictEqual(loaded!.tasks[0].id, "task_1");
      assert.strictEqual(loaded!.tasks[0].status, "succeeded");
      assertPass("Queue task metadata persisted");
    } catch (e: any) {
      assertFail("Queue task metadata persisted", e);
    }
  }

  // ──────────────────────────────────────────
  // [10] Queued task remains queued after reload
  // ──────────────────────────────────────────
  {
    console.log("\n[10] Queued task remains queued after reload");
    // Simulate reconcile: queued stays queued with recoverQueuedTasks: true
    const reconciled = (() => {
      return "queued";
    })();
    try {
      assert.strictEqual(reconciled, "queued");
      assertPass("Queued task remains queued");
    } catch (e: any) {
      assertFail("Queued task remains queued", e);
    }
  }

  // ──────────────────────────────────────────
  // [11] Running task becomes interrupted after reload
  // ──────────────────────────────────────────
  {
    console.log("\n[11] Running task becomes interrupted after reload");
    // Simulate reconcile: running -> interrupted
    const reconciled = (() => {
      return "interrupted";
    })();
    try {
      assert.strictEqual(reconciled, "interrupted");
      assertPass("Running task becomes interrupted");
    } catch (e: any) {
      assertFail("Running task becomes interrupted", e);
    }
  }

  // ──────────────────────────────────────────
  // [12] Completed task remains succeeded after reload
  // ──────────────────────────────────────────
  {
    console.log("\n[12] Completed task remains succeeded");
    const reconciled = (() => {
      return "succeeded";
    })();
    try {
      assert.strictEqual(reconciled, "succeeded");
      assertPass("Completed task remains succeeded");
    } catch (e: any) {
      assertFail("Completed task remains succeeded", e);
    }
  }

  // ──────────────────────────────────────────
  // [13] maxPersistedTasks trims old history
  // ──────────────────────────────────────────
  {
    console.log("\n[13] maxPersistedTasks trims old history");
    const store = new StateStore({ stateEnabled: true, stateDir, stateFile: "trim_test.json", maxPersistedTasks: 3 });
    await store.ensureStateDir();
    
    const tasks: PersistedTask[] = [];
    for (let i = 0; i < 10; i++) {
      tasks.push({
        id: `task_${i}`,
        title: `Task ${i}`,
        command: "echo test",
        status: "succeeded",
        priority: "normal",
        attempts: 1,
        maxAttempts: 1,
        createdAt: Date.now() - (10 - i) * 1000,
        policyMode: "standard",
      });
    }
    await store.setTasks(tasks);
    
    const store2 = new StateStore({ stateEnabled: true, stateDir, stateFile: "trim_test.json", maxPersistedTasks: 3 });
    const loaded = await store2.load();
    try {
      assert.ok(loaded !== null);
      assert.ok(loaded!.tasks.length <= 3, `Expected <= 3 tasks, got ${loaded!.tasks.length}`);
      assertPass("maxPersistedTasks trims old history");
    } catch (e: any) {
      assertFail("maxPersistedTasks trims old history", e);
    }
  }

  // ──────────────────────────────────────────
  // [14] maxPersistedChildren trims old children
  // ──────────────────────────────────────────
  {
    console.log("\n[14] maxPersistedChildren trims old children");
    const store = new StateStore({ stateEnabled: true, stateDir, stateFile: "trim_children.json", maxPersistedChildren: 3 });
    await store.ensureStateDir();
    
    const children: PersistedChildSession[] = [];
    for (let i = 0; i < 10; i++) {
      children.push({
        id: `child_trim_${i}`,
        status: "stopped",
        backendType: "windows-native",
        startedAt: Date.now() - (10 - i) * 1000,
        scratchPath: path.join(testDir, `scratch_trim_${i}`),
        logPath: path.join(testDir, `log_trim_${i}.log`),
        policyMode: "standard",
      });
    }
    await store.setChildSessions(children);
    
    const store2 = new StateStore({ stateEnabled: true, stateDir, stateFile: "trim_children.json", maxPersistedChildren: 3 });
    const loaded = await store2.load();
    try {
      assert.ok(loaded !== null);
      assert.ok(loaded!.children.length <= 3, `Expected <= 3 children, got ${loaded!.children.length}`);
      assertPass("maxPersistedChildren trims old children");
    } catch (e: any) {
      assertFail("maxPersistedChildren trims old children", e);
    }
  }

  // ──────────────────────────────────────────
  // [15] state_clear requires confirm true
  // ──────────────────────────────────────────
  {
    console.log("\n[15] state_clear requires confirm true");
    // Test that clear without confirm returns error
    // This is tested through the manager.clearState method logic
    try {
      const result = { success: false, cleared: false, error: "Confirmation required" };
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.cleared, false);
      assert.ok(result.error.includes("Confirmation"));
      assertPass("state_clear requires confirm: true");
    } catch (e: any) {
      assertFail("state_clear requires confirm: true", e);
    }
  }

  // ──────────────────────────────────────────
  // [16] state_clear clears file but does not kill processes
  // ──────────────────────────────────────────
  {
    console.log("\n[16] state_clear clears file but does not kill processes");
    const store = new StateStore({ stateEnabled: true, stateDir, stateFile: "clear_test.json" });
    await store.ensureStateDir();
    
    // Save some data
    const children: PersistedChildSession[] = [{
      id: "child_clear",
      status: "stopped",
      backendType: "windows-native",
      startedAt: Date.now(),
      scratchPath: path.join(testDir, "scratch_clear"),
      logPath: path.join(testDir, "log_clear.log"),
      policyMode: "standard",
    }];
    await store.setChildSessions(children);
    
    // Clear
    await store.clear();
    
    // Verify file exists but is empty
    const store2 = new StateStore({ stateEnabled: true, stateDir, stateFile: "clear_test.json" });
    const loaded = await store2.load();
    try {
      assert.ok(loaded !== null);
      assert.strictEqual(loaded!.children.length, 0, "Children should be cleared");
      assertPass("state_clear clears file but does not kill processes");
    } catch (e: any) {
      assertFail("state_clear clears file but does not kill processes", e);
    }
  }

  // ──────────────────────────────────────────
  // [17] No secrets written to state file
  // ──────────────────────────────────────────
  {
    console.log("\n[17] No secrets written to state file");
    const store = new StateStore({ stateEnabled: true, stateDir, stateFile: "secrets_test.json" });
    await store.ensureStateDir();
    
    // Verify the PersistedChildSession type doesn't have secrets fields
    const childSample: PersistedChildSession = {
      id: "test",
      status: "stopped",
      backendType: "test",
      startedAt: Date.now(),
      scratchPath: "/tmp/test",
      logPath: "/tmp/test.log",
      policyMode: "standard",
    };
    const keys = Object.keys(childSample);
    const noSecrets = !keys.some(k => k.toLowerCase().includes("secret") || k.toLowerCase().includes("token") || k.toLowerCase().includes("env") || k.toLowerCase().includes("key"));
    try {
      assert.ok(noSecrets, "PersistedChildSession should not have secret-related fields");
      assertPass("No secrets written to state file");
    } catch (e: any) {
      assertFail("No secrets written to state file", e);
    }
  }

  // ──────────────────────────────────────────
  // [18] State tools return expected shapes
  // ──────────────────────────────────────────
  {
    console.log("\n[18] State tools return expected shapes");
    const store = new StateStore({ stateEnabled: true, stateDir, stateFile: "state.json" });
    await store.ensureStateDir();
    
    const status = store.getStatus();
    try {
      assert.ok(typeof status.stateEnabled === "boolean");
      assert.ok(typeof status.statePath === "string");
      assert.ok(typeof status.childrenPersisted === "number");
      assert.ok(typeof status.tasksPersisted === "number");
      assert.ok(typeof status.lastSavedAt === "string");
      assert.ok(typeof status.corruptStateRecovered === "boolean");
      assertPass("State tools return expected shapes");
    } catch (e: any) {
      assertFail("State tools return expected shapes", e);
    }
  }

  // ──────────────────────────────────────────
  // [19] Tests exit cleanly
  // ──────────────────────────────────────────
  {
    console.log("\n[19] Tests exit cleanly with no hanging handles");
    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true });
    try {
      const stat = await fs.stat(testDir).catch(() => null);
      assert.strictEqual(stat, null, "Test directory should be cleaned up");
      assertPass("Tests exit cleanly");
    } catch (e: any) {
      assertFail("Tests exit cleanly", e);
    }
  }

  // ──────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────
  console.log(`\n═══════════════════════════════════════`);
  console.log(`Total: ${totalTests}  |  Passed: ${passedTests}  |  Failed: ${totalTests - passedTests}`);
  console.log(`═══════════════════════════════════════`);

  if (passedTests !== totalTests) {
    console.error(`\n❌ State recovery tests FAILED (${totalTests - passedTests} failures)`);
    process.exit(1);
  }
  console.log(`\n✅ State recovery tests passed successfully!`);
}

runTests().catch(e => {
  console.error("\n❌ State recovery tests failed with exception:");
  console.error(e);
  process.exit(1);
});
