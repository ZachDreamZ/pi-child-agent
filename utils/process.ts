import kill from "tree-kill";

/**
 * Kill a process and its full tree.
 * Gracefully handles the case where the process is already dead (ESRCH/EPERM
 * on Unix, "process not found" on Windows) so callers don't need try/catch.
 */
export async function killProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    kill(pid, "SIGKILL", (_err) => {
      // All errors are non-fatal: the process may already be dead.
      // On Windows, tree-kill uses taskkill which can fail with "not found".
      // On Unix, we can get ESRCH (no such process) or EPERM.
      // In all cases, our job is best-effort — resolve without throwing.
      resolve();
    });
  });
}
