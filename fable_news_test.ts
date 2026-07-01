import { ChildSessionManager } from './manager.js';
import { BackendFactory } from './backends/factory.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

async function run() {
  const mockPi = { registerTool: () => {}, registerCommand: () => {}, on: () => {} };
  const manager = new ChildSessionManager(mockPi);
  await manager.initialize();

  const scratchPath = 'C:\Users\Public\pi-fable-news-final';
  const logPath = path.join(os.tmpdir(), 'pi-child-agent', 'logs', `fable_final_${Date.now()}.log`);
  await fs.mkdir(scratchPath, { recursive: true });

  const backend = await BackendFactory.createBackend('auto', manager.config.getConfig());
  const session = await manager.createSession(backend, scratchPath, logPath);
  console.log(`Session created: ${session.id}`);

  const newsContent = `Fable 5 (Mythos-class) News: Anthropic's Fable 5 has been greenlit to return after a temporary government ban. It's designed for advanced world-building and creative storytelling.`;

  console.log('\n--- Sending News for Processing ---');
  const targetId = session.pid ? session.pid.toString() : session.id;
  
  // Task: Save news and create a summary file
  await session.backend.send(targetId, `echo "${newsContent}" > news.txt`);
  await session.backend.send(targetId, `echo "Summary: Fable 5 is back after a ban." > summary.txt`);
  
  await new Promise(r => setTimeout(r, 1000));

  console.log('\n--- Verifying Output ---');
  await session.backend.send(targetId, 'type summary.txt');
  await new Promise(r => setTimeout(r, 1000));

  const logs = await manager.readLog(session.id);
  console.log('Final Logs:\n' + logs);

  await manager.stopSession(session.id);
}

run().catch(console.error);
