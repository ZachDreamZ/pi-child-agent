/**
 * Shared timing constants for all test suites.
 *
 * These values are deliberately conservative for CI runners.
 * Locally they usually resolve much faster.
 */

export const TIME = {
  /** Timeout for a simple echo / command output (ms). */
  CMD_OUTPUT: 8_000,

  /** Timeout for shell process startup (ms). */
  SHELL_STARTUP: 8_000,

  /** Timeout for stop / cleanup operations (ms). */
  STOP: 5_000,

  /** Timeout for the manager's runtime-exceeded handler (ms). */
  TIMEOUT: 8_000,

  /** Poll interval while waiting for log output (ms). */
  POLL: 100,
} as const;
