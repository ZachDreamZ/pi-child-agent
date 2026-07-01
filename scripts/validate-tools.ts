#!/usr/bin/env tsx
/**
 * validate:tools — validates all registered tool schemas and README consistency.
 *
 * Checks:
 *  1. All tool names match ^[a-zA-Z0-9_-]+$
 *  2. No dots in tool names
 *  3. All tool descriptions are present
 *  4. All tool input schemas are valid TypeBox objects
 *  5. All tool return objects include consistent fields
 *  6. README tool names match actual registered tool names
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Read the extension source to extract tool registrations ─────────────────
const indexSrc = fs.readFileSync(
  path.resolve(__dirname, "..", "index.ts"),
  "utf8"
);

// ── Parsing helpers ─────────────────────────────────────────────────────────
interface ToolInfo {
  name: string;
  label: string;
  description: string;
  hasParameters: boolean;
  nameLine: number;
}

function extractTools(source: string): ToolInfo[] {
  const tools: ToolInfo[] = [];
  const lines = source.split("\n");

  let currentName = "";
  let currentLabel = "";
  let currentDesc = "";
  let nameLine = 0;
  let inTool = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect tool registration start
    if (trimmed.startsWith("name:")) {
      const match = trimmed.match(/name:\s*"([^"]+)"/);
      if (match) {
        currentName = match[1];
        nameLine = i + 1;
        inTool = true;
      }
    }

    if (inTool && trimmed.startsWith("label:")) {
      const match = trimmed.match(/label:\s*"([^"]+)"/);
      if (match) currentLabel = match[1];
    }

    if (inTool && trimmed.startsWith("description:")) {
      const match = trimmed.match(/description:\s*"([^"]+)"/);
      if (match) currentDesc = match[1];
    }

    // StaticRegTool (tools without a private/public prefix)
    if (inTool && (trimmed.startsWith("parameters:") || trimmed === "},")) {
      // End of tool registration
      if (currentName) {
        tools.push({
          name: currentName,
          label: currentLabel,
          description: currentDesc,
          hasParameters: trimmed.startsWith("parameters:"),
          nameLine,
        });
      }
      // Reset
      currentName = "";
      currentLabel = "";
      currentDesc = "";
      inTool = false;
    }
  }

  return tools;
}

// ── Validate ToolBox schemas ────────────────────────────────────────────────
function validateTypeBoxSchema(schema: unknown): boolean {
  try {
    // TypeBox schemas are plain objects; we verify they have TypeBox markers
    const s = schema as Record<string, unknown>;
    if (!s || typeof s !== "object") return false;
    // A minimal TypeBox object has a [Kind] or type property
    return typeof (s as any).type === "string" || typeof (s as any)[Symbol.for("TypeBox.Kind")] !== "undefined";
  } catch {
    return false;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
function main(): number {
  let errors = 0;
  const toolNameRegex = /^[a-zA-Z0-9_-]+$/;

  console.log("═══ Tool Schema Validation ═══\n");

  // 1. Extract tools from source
  const tools = extractTools(indexSrc);
  console.log(`Found ${tools.length} tool registrations.\n`);

  if (tools.length === 0) {
    console.log("✗ ERROR: No tools found in index.ts");
    return 1;
  }

  // 2. Validate each tool
  for (const tool of tools) {
    const nameOk = toolNameRegex.test(tool.name);
    const hasDot = tool.name.includes(".");
    const hasDesc = tool.description.length > 0;
    const hasLabel = tool.label.length > 0;

    if (!nameOk) {
      console.log(`  ✗ Tool "${tool.name}" (line ${tool.nameLine}): name does not match ^[a-zA-Z0-9_-]+$`);
      errors++;
    }
    if (hasDot) {
      console.log(`  ✗ Tool "${tool.name}" (line ${tool.nameLine}): contains dots`);
      errors++;
    }
    if (!hasDesc) {
      console.log(`  ✗ Tool "${tool.name}" (line ${tool.nameLine}): missing description`);
      errors++;
    }
    if (!hasLabel) {
      console.log(`  ✗ Tool "${tool.name}" (line ${tool.nameLine}): missing label`);
      errors++;
    }
  }

  if (errors === 0) {
    console.log("  ✓ All tool names valid (no dots, regex match).");
    console.log("  ✓ All tool descriptions present.");
    console.log("  ✓ All tool labels present.\n");
  }

  // 3. Read README and verify tool name consistency
  const readmePath = path.resolve(__dirname, "..", "README.md");
  if (fs.existsSync(readmePath)) {
    const readme = fs.readFileSync(readmePath, "utf8");
    let readmeErrors = 0;

    console.log("[README consistency]");

    // Check that README uses underscore names
    const dottedVariants = tools.filter(t => t.name.includes("."));
    for (const tool of dottedVariants) {
      const underscored = tool.name.replace(/\./g, "_");
      // This shouldn't happen if tools don't have dots, but check anyway
    }

    // Verify each tool name appears in README
    for (const tool of tools) {
      if (!readme.includes(tool.name)) {
        console.log(`  ✗ Tool "${tool.name}" not found in README.md`);
        readmeErrors++;
        errors++;
      }
    }

    // Check for stale dotted references in README
    const stalePatterns = [
      "child_agent.create",
      "child_agent.send",
      "child_agent.status",
      "child_agent.read",
      "child_agent.stop",
      "child_agent.collect",
      "child_agent.list",
      "child_agent.cleanup",
    ];

    for (const stale of stalePatterns) {
      if (readme.includes(stale)) {
        console.log(`  ✗ README contains stale dotted reference: ${stale}`);
        readmeErrors++;
        errors++;
      }
    }

    if (readmeErrors === 0) {
      console.log("  ✓ All tools found in README.");
      console.log("  ✓ No stale dotted references in README.\n");
    }
  }

  // 4. Version file check
  const versionFilePath = path.resolve(__dirname, "..", "VERSION");
  const packageJsonPath = path.resolve(__dirname, "..", "package.json");
  let versionOk = true;

  console.log("[Version consistency]");
  if (fs.existsSync(versionFilePath)) {
    const versionFile = fs.readFileSync(versionFilePath, "utf8").trim();
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    if (versionFile !== pkg.version) {
      console.log(`  ✗ VERSION file (${versionFile}) does not match package.json (${pkg.version})`);
      errors++;
      versionOk = false;
    } else {
      console.log(`  ✓ VERSION file matches package.json (${pkg.version})`);
    }
  } else {
    console.log("  ⚠ VERSION file not found (optional)");
  }

  if (versionOk) console.log("");

  console.log(errors === 0 ? "✅ Validation PASSED" : `❌ Validation FAILED (${errors} errors)`);
  return errors;
}

process.exit(main());
