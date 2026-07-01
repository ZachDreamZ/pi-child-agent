import { ChildSession } from "../manager.js";

export interface StructuredResult {
  success: boolean;
  childId: string;
  status: string;
  summary: string;
  findings: string[];
  errors: string[];
  warnings: string[];
  filesMentioned: string[];
  commandsRun: string[];
  timedOut: boolean;
  exitReason: string;
  rawLogTail: string;
  logPath: string;
  scratchPath: string;
}

export function extractErrors(rawLog: string): string[] {
  const errorPatterns = [/error:?.*$/i, /failed:?.*$/i, /exception:?.*$/i, /traceback.*$/i, /ERR!.*$/i];
  const lines = rawLog.split("\n");
  const errors: string[] = [];
  for (const line of lines) {
    if (errorPatterns.some(p => p.test(line))) {
      errors.push(line.trim());
    }
  }
  return [...new Set(errors)];
}

export function extractWarnings(rawLog: string): string[] {
  const warnPatterns = [/warning:?.*$/i, /warn:?.*$/i, /deprecated.*$/i];
  const lines = rawLog.split("\n");
  const warnings: string[] = [];
  for (const line of lines) {
    if (warnPatterns.some(p => p.test(line))) {
      warnings.push(line.trim());
    }
  }
  return [...new Set(warnings)];
}

export function extractFilesMentioned(rawLog: string): string[] {
  // Simple regex for common path patterns
  const pathPattern = /([a-zA-Z]:\\[^ \n\r\t\r]*|(\/[a-zA-Z0-9._\-/]+))/g;
  const matches = rawLog.match(pathPattern) || [];
  return [...new Set(matches)].filter(p => p.length > 3);
}

export function extractCommandsRun(rawLog: string): string[] {
  const lines = rawLog.split("\n");
  const commands: string[] = [];
  for (const line of lines) {
    if (line.includes("[PICA_CMD]")) {
      commands.push(line.replace("[PICA_CMD]", "").trim());
    } else if (line.startsWith("👉 **Command**: ")) {
      commands.push(line.replace("👉 **Command**: ", "").trim());
    }
  }
  return commands;
}

export function extractFindings(rawLog: string): string[] {
  // Look for lines that seem like results or summaries
  const lines = rawLog.split("\n");
  const findings: string[] = [];
  for (const line of lines) {
    if (line.toLowerCase().includes("finding:") || line.toLowerCase().includes("result:")) {
      findings.push(line.trim());
    }
  }
  return findings;
}

export function collectStructuredResult(session: ChildSession, rawLog: string): StructuredResult {
  const lines = rawLog.split("\n");
  const lastLines = lines.slice(-20).join("\n").trim();

  return {
    success: (session.status === "done" || session.status === "stopped") && extractErrors(rawLog).length === 0,
    childId: session.id,
    status: session.status,
    summary: lastLines || "No meaningful output captured.",
    findings: extractFindings(rawLog),
    errors: extractErrors(rawLog),
    warnings: extractWarnings(rawLog),
    filesMentioned: extractFilesMentioned(rawLog),
    commandsRun: extractCommandsRun(rawLog),
    timedOut: !!session.timedOut,
    exitReason: session.timedOut ? "timed_out" : "collected",
    rawLogTail: lastLines,
    logPath: session.logPath,
    scratchPath: session.scratchPath,
  };
}
