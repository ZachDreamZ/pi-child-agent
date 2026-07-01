/**
 * Sentinel-based log polling utilities for fast, reliable test waits.
 *
 * Replaces fixed `sleep(1500)` calls with efficient polling that resolves
 * the moment a sentinel marker appears in the log file.
 */

import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

/**
 * Generate a globally unique sentinel ID for a single wait cycle.
 */
export function nextId(): string {
  const rand = randomBytes(4).toString("hex");
  return `PICA_DONE_${Date.now()}_${rand}`;
}

/**
 * Poll `logPath` for a matching pattern, checking every `intervalMs`.
 * Resolves as soon as the pattern is found (or throws on timeout).
 *
 * @param logPath  Absolute path to the log file.
 * @param pattern  String or RegExp to search for.
 * @param timeoutMs  Max time to wait (default 8 000 ms for safety).
 * @param intervalMs  Poll interval (default 100 ms).
 * @returns The full log content at the moment the pattern was found.
 */
export async function waitForLog(
  logPath: string,
  pattern: string | RegExp,
  timeoutMs = 8_000,
  intervalMs = 100,
): Promise<string> {
  const start = Date.now();
  let lastError: Error | null = null;

  while (Date.now() - start < timeoutMs) {
    try {
      const content = await readFile(logPath, "utf-8");
      const match: boolean =
        typeof pattern === "string"
          ? content.includes(pattern)
          : pattern.test(content);
      if (match) return content;
    } catch (err: unknown) {
      // File may not exist yet — capture the error but keep polling
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  const fileExistsHint = lastError ? ` (last error: ${lastError.message})` : "";
  throw new Error(
    `[waitForLog] Timeout after ${timeoutMs} ms waiting for pattern "${pattern}" in ${logPath}${fileExistsHint}`,
  );
}

/**
 * Send a command followed by a unique sentinel echo, then wait for the
 * sentinel to appear in the log.  Returns the full log content.
 *
 * @param backend  Object with a `send(id, cmd)` method (any backend).
 * @param targetId  PID or session ID to send to.
 * @param logPath  Absolute path to the log file.
 * @param command  The real command to execute.
 * @param timeoutMs  Max time to wait for output.
 */
export async function sendAndWait(
  backend: { send: (id: string, cmd: string) => Promise<void> },
  targetId: string,
  logPath: string,
  command: string,
  timeoutMs = 8_000,
): Promise<string> {
  const sentinel = nextId();
  await backend.send(targetId, command);
  await backend.send(targetId, `echo ${sentinel}`);
  return await waitForLog(logPath, sentinel, timeoutMs);
}

/**
 * Short CI-safe timeouts used by all test suites.
 * Longer than ideal for developer machines but safe for CI runners.
 */
export const TIMEOUTS = {
  /** A simple echo or single-command output. */
  CMD_OUTPUT: 3_000,
  /** Shell process startup before it's ready to receive commands. */
  SHELL_STARTUP: 5_000,
  /** stop / cleanup operations. */
  STOP_CLEANUP: 3_000,
  /** Timeout test — how long we give for the manager's timeout handler to fire. */
  TIMEOUT_HANDLER: 5_000,
} as const;
