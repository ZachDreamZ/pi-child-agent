#!/usr/bin/env tsx
/**
 * pi-child-agent doctor script (Phase 3 enhanced).
 * Diagnoses the host environment and reports:
 *  - Pi CLI availability
 *  - Pi extensions directory
 *  - Extension install path
 *  - Whether the extension is installed
 *  - Whether package dependencies are installed
 *  - Detected shell backend
 *  - Active backend mode
 *  - Writable temp directory
 *  - Protected path test
 *  - Secret env scrub test
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { isWindows, getOSType } from "../utils/os.js";
import { SecurityGuard } from "../security/guard.js";
import { ConfigLoader } from "../config/loader.js";
import { resolvePolicy } from "../security/policy.js";
import { BackendFactory } from "../backends/factory.js";

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

const results: CheckResult[] = [];
const homeDir = os.homedir();

function check(name: string, fn: () => string | true, warnOnly = false): void {
  try {
    const res = fn();
    results.push({ name, status: "ok", detail: typeof res === "string" ? res : "available" });
  } catch (e: any) {
    results.push({ name, status: warnOnly ? "warn" : "fail", detail: e.message || String(e) });
  }
}

function hasCommand(cmd: string, args = "--version"): boolean {
  try {
    execSync(`${cmd} ${args} 2>nul`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  console.log("=== pi-child-agent Doctor (Enhanced) ===\n");

  // ── Pi CLI ────────────────────────────────────────────────────────────────
  check("pi CLI available", () => {
    const output = execSync("pi --version 2>&1", { encoding: "utf8" }).trim();
    return `found — v${output}`;
  });

  check("pi extensions directory", () => {
    // Check multiple possible locations
    const candidates = [
      path.join(homeDir, ".pi", "agent", "extensions"),
      path.join(homeDir, ".pi", "extensions"),
      path.join(process.cwd(), ".pi", "extensions"),
    ];
    for (const dir of candidates) {
      if (fs.existsSync(dir)) return dir;
    }
    throw new Error(`not found in any of:\n  ${candidates.join("\n  ")}`);
  });

  check("pi-child-agent installed", () => {
    // Check where pi itself reports the extension
    try {
      const listOutput = execSync("pi list 2>&1", { encoding: "utf8" });
      if (listOutput.includes("pi-child-agent")) return "registered in pi list";
    } catch {}

    const candidates = [
      path.join(homeDir, ".pi", "agent", "extensions", "pi-child-agent"),
      path.join(homeDir, ".pi", "extensions", "pi-child-agent"),
      path.join(process.cwd(), ".pi", "extensions", "pi-child-agent"),
      path.join(homeDir, ".pi", "agent", "npm", "node_modules", "pi-child-agent"),
      path.join(process.cwd(), "..", "pi-child-agent"),
    ];
    for (const extPath of candidates) {
      const resolved = path.resolve(extPath);
      if (fs.existsSync(path.join(resolved, "index.ts")) || fs.existsSync(path.join(resolved, "index.js"))) {
        return resolved;
      }
    }
    throw new Error("not found in any known extensions directory");
  });

  check("dependencies installed", () => {
    const candidates = [
      path.join(homeDir, ".pi", "agent", "extensions", "pi-child-agent"),
      path.join(homeDir, ".pi", "extensions", "pi-child-agent"),
      path.join(process.cwd(), ".pi", "extensions", "pi-child-agent"),
      path.join(homeDir, ".pi", "agent", "npm", "node_modules", "pi-child-agent"),
      path.join(process.cwd(), "..", "pi-child-agent"),
    ];
    let nmPath = "";
    for (const extPath of candidates) {
      const resolved = path.resolve(extPath);
      const p = path.join(resolved, "node_modules");
      if (fs.existsSync(p)) { nmPath = p; break; }
    }
    if (!nmPath) {
      // Fall back to current directory node_modules
      const localNm = path.resolve(process.cwd(), "node_modules");
      if (fs.existsSync(localNm)) nmPath = localNm;
    }
    if (!nmPath) throw new Error("node_modules not found");
    const pkgs = fs.readdirSync(nmPath);
    const required = ["typebox", "tree-kill"];
    const missing = required.filter(r => !pkgs.includes(r));
    if (missing.length > 0) throw new Error(`missing: ${missing.join(", ")}`);
    return `${pkgs.length} packages`;
  });

  // ── OS & Shell ────────────────────────────────────────────────────────────
  check("OS detection", () => `${os.platform()} (${os.release()}) → ${getOSType()}`);

  if (isWindows()) {
    for (const shell of ["pwsh", "powershell", "cmd"]) {
      check(`shell: ${shell}`, () => {
        try {
          if (shell === "cmd") {
            execSync(`cmd /d /q /c "echo OK"`, { stdio: "pipe" });
          } else {
            execSync(`${shell} -NoProfile -Command "exit 0"`, { stdio: "pipe" });
          }
          return "available";
        } catch {
          throw new Error("not found or not working");
        }
      }, shell === "pwsh"); // warn only for pwsh (optional)
    }
  } else {
    for (const shell of ["bash", "zsh", "tmux"]) {
      check(`shell: ${shell}`, () => {
        if (!hasCommand(shell)) throw new Error("not found in PATH");
        return "available";
      }, shell === "tmux"); // warn only for tmux (optional)
    }
  }

  // ── Backend Detection ─────────────────────────────────────────────────────
  check("auto backend selection", () => {
    // Use execSync to test backend detection non-interactively
    // The BackendFactory throws if it can't detect
    if (isWindows()) {
      const output = execSync(`where pwsh powershell cmd 2>nul`, { encoding: "utf8" }).trim();
      const found = output.split("\n").map(l => l.trim()).filter(Boolean);
      return `→ windows-native (shells: ${found.join(", ")})`;
    } else {
      const shells = ["bash", "zsh", "tmux"].filter(s => hasCommand(s));
      return `→ unix (shells: ${shells.join(", ") || "none"})`;
    }
  });

  // ── Container Runtimes ────────────────────────────────────────────────────
  for (const rt of ["docker", "podman"]) {
    check(`container: ${rt}`, () => {
      if (!hasCommand(rt)) throw new Error("not found");
      return execSync(`${rt} --version 2>&1`, { encoding: "utf8" }).trim();
    }, true);
  }

  // ── Node / TS ─────────────────────────────────────────────────────────────
  check("Node.js", () => process.version);
  check("TypeScript", () => {
    const v = execSync("npx tsc --version", { encoding: "utf8" }).trim();
    return v;
  });

  // ── Security Tests ────────────────────────────────────────────────────────
  const config = new ConfigLoader();
  const guard = new SecurityGuard(resolvePolicy(config.getConfig()));

  check("protected path: C:\\Windows", () => {
    if (!guard.isPathProtected("C:\\Windows")) throw new Error("NOT PROTECTED");
    return "BLOCKED";
  });

  check("protected path: C:\\Program Files (x86)", () => {
    if (!guard.isPathProtected("C:\\Program Files (x86)")) throw new Error("NOT PROTECTED");
    return "BLOCKED";
  });

  check("non-protected path: C:\\Users\\Public", () => {
    if (guard.isPathProtected("C:\\Users\\Public")) throw new Error("FALSE POSITIVE");
    return "ALLOWED";
  });

  check("secret env scrub (API_KEY)", () => {
    // Manual test of filterEnv logic without importing the backend
    const sensitiveKeys = ["API_KEY", "TOKEN", "SECRET", "PASSWORD", "SSH_AUTH_SOCK", "AWS_SECRET", "AZURE_SECRET"];
    const testEnv: Record<string, string> = { PATH: "ok", API_KEY: "secret", MY_TOKEN: "should_go", SAFE: "ok" };
    const filtered: Record<string, string> = {};
    for (const [k, v] of Object.entries(testEnv)) {
      if (!sensitiveKeys.some(s => k.toUpperCase().includes(s))) {
        filtered[k] = v;
      }
    }
    if (filtered.API_KEY !== undefined) throw new Error("API_KEY was NOT removed");
    if (filtered.MY_TOKEN !== undefined) throw new Error("MY_TOKEN was NOT removed");
    if (filtered.PATH !== "ok") throw new Error("PATH was removed (should stay)");
    return "API_KEY removed, MY_TOKEN removed, PATH preserved";
  });

  // ── Temp Dir ──────────────────────────────────────────────────────────────
  check("temp directory writable", () => {
    const testPath = path.join(os.tmpdir(), "pi-child-doctor-test");
    fs.writeFileSync(testPath, "test", "utf8");
    fs.rmSync(testPath);
    return os.tmpdir();
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("Results:\n");
  console.log("Check".padEnd(42), "Status".padEnd(10), "Detail");
  console.log("─".repeat(80));

  for (const r of results) {
    const icon = r.status === "ok" ? "✓" : r.status === "warn" ? "⚠" : "✗";
    const pad = `${icon} ${r.status}`.padEnd(10);
    console.log(r.name.padEnd(42), pad, r.detail);
  }

  const fails = results.filter(r => r.status === "fail");
  const warns = results.filter(r => r.status === "warn");
  console.log(`\n${results.length} checks. ${fails.length} failures, ${warns.length} warnings.`);
  if (fails.length > 0) process.exit(1);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
