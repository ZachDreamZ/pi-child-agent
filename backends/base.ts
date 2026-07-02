export abstract class SessionBackend {
  abstract name: string;
  /** Shell dialect used by this backend: "cmd" | "pwsh" | "powershell" | "bash" | "sh" */
  abstract shellType: string;
  abstract start(cwd: string, scratchPath: string, logPath: string): Promise<{ pid: number }>;
  abstract send(id: string, command: string): Promise<void>;
  abstract read(id: string): Promise<string>;
  abstract stop(id: string): Promise<void>;
  abstract isAlive(id: string): Promise<boolean>;
}
