import fs from "node:fs/promises";
import path from "node:path";

export class Logger {
  constructor(private logDir: string) {}

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.logDir, { recursive: true });
  }

  async write(logPath: string, content: string): Promise<void> {
    await fs.appendFile(logPath, content + "\n", "utf8");
  }

  async read(logPath: string, limit: number): Promise<string> {
    const stats = await fs.stat(logPath);
    const size = stats.size;
    
    if (size <= limit) {
      return await fs.readFile(logPath, "utf8");
    }

    // Read last 'limit' bytes
    const fd = await fs.open(logPath, "r");
    const buffer = Buffer.alloc(limit);
    await fd.read(buffer, 0, limit, size - limit);
    await fd.close();
    
    return buffer.toString("utf8");
  }

  async clear(logPath: string): Promise<void> {
    await fs.writeFile(logPath, "", "utf8");
  }
}
