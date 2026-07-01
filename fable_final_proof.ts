import { ChildSessionManager } from './manager.js';
import { BackendFactory } from './backends/factory.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

async function run() {
  const mockPi = { registerTool: () => {}, registerCommand: () => {}, on: () => {} };
  const manager = new ChildSessionManager(mockPi);
  await manager.initialize();

  const scratchPath = 'C:\Users\Public\pi-fable-final';
  const logPath = path.join(os.tmpdir(), 'pi-child-agent', 'logs', `fable_final_${Date.now()}.log`);
  await fs.mkdir(scratchPath, { recursive: true });

  console.log('🚀 Creating Child Agent for Fable 5 News Processing...');
  const backend = await BackendFactory.createBackend('auto', manager.config.getConfig());
  const session = await manager.createSession(backend, scratchPath, logPath);
  console.log(`✅ Session created: ${session.id} (${session.backendType})`);

  const news = `LATEST NEWS: Anthropic has redeployed Fable 5 and Mythos 5 models. 
Export controls from the US government were lifted, and the models are now back worldwide 
after a two-week ban. Fable 5 is the consumer-facing Mythos-class model.`;

  console.log('\n📤 Sending News to Child Agent...');
  const targetId = session.pid ? session.pid.toString() : session.id;
  await session.backend.send(targetId, `echo "${news.replace(/"/g, '\\"')}" > news_report.txt`);
  await session.backend.send(targetId, `echo "SUMMARY: Fable 5 is back worldwide after US government lifted export controls." > summary.txt`);
  
  await new Promise(r => setTimeout(r, 1000));

  console.log('\n🔍 Verifying and Collecting Results...');
  await session.backend.send(targetId, 'type summary.txt');
  await new Promise(r => setTimeout(r, 1000));

  const logs = await manager.collect(session.id);
  console.log('\n--- FINAL AGENT OUTPUT ---');
  console.log(logs);
  console.log('--------------------------');
}

run().catch(console.error);
