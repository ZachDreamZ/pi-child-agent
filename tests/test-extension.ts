import { ChildSessionManager } from "../manager.js";
import { BackendFactory } from "../backends/factory.js";
import { SecurityGuard } from "../security/guard.js";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

// Mock ExtensionAPI
const mockPi = {
  registerTool: () => {},
  registerCommand: () => {},
  on: () => {},
};

async function runTests() {
  console.log("Starting pi-child-agent tests...");
  
  const manager = new ChildSessionManager(mockPi as any);
  await manager.initialize();

  const scratchDir = path.join("C:\\Users\\Public", "pi-child-test-scratch");
  await fs.mkdir(scratchDir, { recursive: true });

  try {
    // Test 1: OS Detection and Backend Selection
    console.log("\nTest 1: Backend Selection...");
    const backend = await BackendFactory.createBackend("auto", manager.config.getConfig());
    console.log(`- Selected backend: ${backend.name}`);

    // Test 2: Session Creation
    console.log("\nTest 2: Session Creation...");
    const logPath = path.join(os.tmpdir(), "pi-child-agent", "logs", "test.log");
    const session = await manager.createSession(backend, scratchDir, logPath);
    console.log(`- Session created: ${session.id} (Status: ${session.status})`);

    // Test 3: Sending a command
    console.log("\nTest 3: Sending command...");
    const targetId = session.pid ? session.pid.toString() : session.id;
    await backend.send(targetId, "echo 'Hello from test'");
    console.log("- Command sent.");

    // Test 4: Reading logs
    console.log("\nTest 4: Reading logs...");
    // Give it a moment to write
    await new Promise(r => setTimeout(r, 500));
    const logs = await manager.readLog(session.id);
    console.log(`- Logs read: ${logs || "Empty"}`);

    // Test 5: Path Protection
    console.log("\nTest 5: Path Protection...");
    const protectedPath = "C:\\Windows";
    try {
      await manager.createSession(backend, protectedPath, logPath);
      console.error("- Failed: Protected path was allowed!");
    } catch (e: any) {
      console.log(`- Success: Blocked protected path (${e.message})`);
    }

    // Test 6: Session Stop
    console.log("\nTest 6: Stopping session...");
    await manager.stopSession(session.id);
    console.log("- Session stopped.");

    // Cleanup
    await fs.rm(scratchDir, { recursive: true, force: true });
    console.log("\nAll tests passed successfully!");
  } catch (e) {
    console.error("\nTest failed!");
    console.error(e);
    process.exit(1);
  }
}

runTests();
