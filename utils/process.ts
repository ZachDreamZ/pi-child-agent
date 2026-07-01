import kill from "tree-kill";

export async function killProcessTree(pid: number): Promise<void> {
  return new Promise((resolve, reject) => {
    kill(pid, "SIGKILL", (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
