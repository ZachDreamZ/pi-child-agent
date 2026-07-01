import { ChildSessionManager } from './manager.js';
import { BackendFactory } from './backends/factory.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

async function run() {
  const mockPi = {
    registerTool: () => {},
    registerCommand: () => {},
    on: () => {},
  };

  const manager = new ChildSessionManager(mockPi);
  await manager.initialize();

  console.log('--- Creating Child Agent ---');
  const scratchPath = 'C:\Users\Public\pi-fable-news';
  const logPath = path.join(os.tmpdir(), 'pi-child-agent', 'logs', `fable_${Date.now()}.log`);
  
  await fs.mkdir(scratchPath, { recursive: true });
  await fs.mkdir(path.dirname(logPath), { recursive: true });

  const backend = await BackendFactory.createBackend('auto', manager.config.getConfig());
  const session = await manager.createSession(backend, scratchPath, logPath);
  console.log(`Created session: ${session.id} using backend ${session.backendType}`);

  const news = "Fable News Summary: Playground Games is developing the new Fable RPG for Xbox and PS5. Also, Anthropic's Fable 5 AI model is reportedly returning.";

  console.log('\n--- Sending News to Child Agent ---');
  const targetId = session.pid ? session.pid.toString() : session.id;
  
  // Use a single line to avoid Windows cmd newline issues
  await session.backend.send(targetId, `echo ${news} > news.txt`);
  console.log('Command sent to save news.txt');

  await new Promise(r => setTimeout(r, 1000));

  console.log('\n--- Verifying File in Child Scratch Space ---');
  await session.backend.send(targetId, 'type news.txt');
  
  await new Promise(r => setTimeout(r, 1000));

  console.log('\n--- Collecting Results ---');
  const logs = await manager.readLog(session.id);
  console.log('Final Logs:\n' + logs);

  await manager.stopSession(session.id);
  console.log('\nSession stopped.');
}

run().catch(console.error);
