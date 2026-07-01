#!/usr/bin/env tsx
import { SecurityGuard } from "../security/guard.js";
import { resolvePolicy, PolicyMode } from "../security/policy.js";
import { ConfigLoader } from "../config/loader.js";
import assert from "node:assert";

async function runTests() {
  console.log("═══ Security Policy Tests ═══\n");

  const config = new ConfigLoader();

  // --- STRICT MODE ---
  console.log("[Strict Mode]");
  const strictPolicy = resolvePolicy({ ...config.getConfig(), policyMode: "strict" });
  const strictGuard = new SecurityGuard(strictPolicy);

  assert.strictEqual(strictGuard.checkCommand("rm -rf /").allowed, false, "Strict: rm -rf / should be blocked");
  assert.strictEqual(strictGuard.checkCommand("npm install").requiresApproval, true, "Strict: npm install should require approval");
  assert.strictEqual(strictGuard.isPathProtected("C:\\Windows"), true, "Strict: C:\\Windows should be protected");
  console.log("  ✓ Strict mode tests passed");

  // --- STANDARD MODE ---
  console.log("\n[Standard Mode]");
  const standardPolicy = resolvePolicy({ ...config.getConfig(), policyMode: "standard" });
  const standardGuard = new SecurityGuard(standardPolicy);

  assert.strictEqual(standardGuard.checkCommand("rm -rf /").allowed, false, "Standard: rm -rf / should be blocked");
  assert.strictEqual(standardGuard.checkCommand("npm install").requiresApproval, true, "Standard: npm install should require approval");
  assert.strictEqual(standardGuard.checkCommand("curl google.com").allowed, true, "Standard: curl should be allowed");
  assert.strictEqual(standardGuard.isPathProtected("C:\\Windows"), true, "Standard: C:\\Windows should be protected");
  console.log("  ✓ Standard mode tests passed");

  // --- TRUSTED MODE ---
  console.log("\n[Trusted Mode]");
  const trustedPolicy = resolvePolicy({ ...config.getConfig(), policyMode: "trusted" });
  const trustedGuard = new SecurityGuard(trustedPolicy);

  assert.strictEqual(trustedGuard.checkCommand("npm install").allowed, true, "Trusted: npm install should be allowed");
  assert.strictEqual(trustedGuard.checkCommand("git commit -m 'test'").allowed, true, "Trusted: git commit should be allowed");
  assert.strictEqual(trustedGuard.isPathProtected("C:\\Windows"), true, "Trusted: C:\\Windows should still be protected");
  assert.strictEqual(trustedGuard.checkCommand("format D:").allowed, false, "Trusted: format should still be blocked/require approval");
  console.log("  ✓ Trusted mode tests passed");

  console.log("\n✅ Security Policy tests passed successfully!");
}

runTests().catch(e => {
  console.error("\n❌ Security Policy tests failed:");
  console.error(e);
  process.exit(1);
});
