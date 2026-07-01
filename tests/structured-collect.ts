#!/usr/bin/env tsx
import { collectStructuredResult } from "../utils/structuredCollect.js";
import assert from "node:assert";

// Mock session
const mockSession: any = {
  id: "child_test_123",
  status: "done",
  timedOut: false,
  logPath: "/tmp/test.log",
  scratchPath: "/tmp/scratch",
};

async function runTests() {
  console.log("═══ Structured Collect Tests ═══\n");

  const sampleLog = `
[PICA_CMD] echo "Hello World"
Hello World
[PICA_CMD] npm install lodash
npm install lodash
WARN: lodash is deprecated
ERROR: failed to fetch package
[PICA_CMD] cat /etc/passwd
Permission denied
Finding: The system is using kernel 5.15.
Result: The audit is complete.
  `;

  const result = collectStructuredResult(mockSession, sampleLog);

  console.log("[Basic Extraction]");
  assert.strictEqual(result.childId, "child_test_123");
  assert.strictEqual(result.success, false, "Should be false due to errors in log");
  assert.ok(result.errors.length > 0, "Should extract errors");
  assert.ok(result.warnings.length > 0, "Should extract warnings");
  assert.ok(result.commandsRun.length === 3, `Expected 3 commands, got ${result.commandsRun.length}`);
  assert.ok(result.findings.length >= 2, "Should extract findings");
  console.log("  ✓ Basic extraction passed");

  console.log("\n[Timeout Detection]");
  const timeoutSession: any = { ...mockSession, status: "timed_out", timedOut: true };
  const timeoutLog = `Running... [PICA_TIMEOUT] Child agent exceeded max runtime.`;
  const timeoutResult = collectStructuredResult(timeoutSession, timeoutLog);
  assert.strictEqual(timeoutResult.timedOut, true);
  assert.strictEqual(timeoutResult.exitReason, "timed_out");
  console.log("  ✓ Timeout detection passed");

  console.log("\n[Empty Log]");
  const emptyResult = collectStructuredResult(mockSession, "");
  assert.strictEqual(emptyResult.summary, "No meaningful output captured.");
  assert.strictEqual(emptyResult.errors.length, 0);
  console.log("  ✓ Empty log handled");

  console.log("\n✅ Structured Collect tests passed successfully!");
}

runTests().catch(e => {
  console.error("\n❌ Structured Collect tests failed:");
  console.error(e);
  process.exit(1);
});
