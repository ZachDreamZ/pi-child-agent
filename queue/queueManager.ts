import { TaskQueue, QueuedTask, TaskStatus, TaskPriority } from "./taskQueue.js";
import { ChildSessionManager, ChildSession } from "../manager.js";
import { SecurityGuard } from "../security/guard.js";
import { resolvePolicy } from "../security/policy.js";
import { BackendFactory } from "../backends/factory.js";
import { collectStructuredResult } from "../utils/structuredCollect.js";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

export class QueueManager {
  private queue: TaskQueue;
  private runningTasks: Set<string> = new Set();
  private isRunning: boolean = false;

  constructor(
    private manager: ChildSessionManager,
    private guard: SecurityGuard
  ) {
    this.queue = new TaskQueue();
  }

  async enqueue(data: {
    title: string;
    command: string;
    priority?: TaskPriority;
    maxAttempts?: number;
    timeoutMs?: number;
    policyMode?: string;
  }) {
    const options = {
      maxConcurrentTasks: this.manager.config.get("maxConcurrentTasks"),
      defaultTaskMaxAttempts: this.manager.config.get("defaultTaskMaxAttempts"),
    };
    const task = this.queue.enqueue(data, options);
    return task;
  }

  async startQueue(maxConcurrent?: number) {
    if (this.isRunning) return { running: true, queued: this.queue.listTasks({ includeCompleted: false }).length, runningTasks: this.runningTasks.size };
    
    this.isRunning = true;
    this.processQueue(maxConcurrent || this.manager.config.get("maxConcurrentTasks"));
    
    return {
      running: true,
      queued: this.queue.listTasks({ includeCompleted: false }).length,
      runningTasks: this.runningTasks.size,
    };
  }

  async stopQueue() {
    this.isRunning = false;
    // We don't stop running tasks immediately unless requested by task cancellation
  }

  async processQueue(maxConcurrent: number) {
    if (!this.isRunning) return;

    const queuedTasks = this.queue.listTasks({ status: ["queued"] });
    
    for (const task of queuedTasks) {
      if (this.runningTasks.size >= maxConcurrent) break;
      
      this.runTask(task);
    }

    // Poll again after a short delay if we are still running
    setTimeout(() => this.processQueue(maxConcurrent), 500);
  }

  private async runTask(task: QueuedTask) {
    console.log(`Running task ${task.id}:`, task);
    this.runningTasks.add(task.id);
    this.queue.updateTask(task.id, { status: "running", startedAt: Date.now() });

    try {
      // 1. Security Check
      const decision = this.guard.checkCommand(task.command);
      if (!decision.allowed) {
        if (decision.requiresApproval) {
          // In queue mode, we cannot block the loop for UI confirmation
          // We mark as approval_required and stop
          this.queue.updateTask(task.id, { status: "approval_required", error: decision.reason });
          this.runningTasks.delete(task.id);
          return;
        } else {
          this.queue.updateTask(task.id, { status: "blocked", error: decision.reason });
          this.runningTasks.delete(task.id);
          return;
        }
      }

      // 2. Setup Child Session
      const backend = await BackendFactory.createBackend("auto", this.manager.config.getConfig());
      const root = process.platform === 'win32' 
        ? path.join("C:\\Users\\Public", "pi-child-agent", "queue-scratch") 
        : path.join(os.tmpdir(), "pi-child-agent", "queue-scratch");
      const scratchPath = path.join(root, `task_${task.id}`);
      const logPath = path.join(os.tmpdir(), "pi-child-agent", "logs", `task_${task.id}.log`);
      
      await fs.mkdir(scratchPath, { recursive: true });
      const session = (await this.manager.createSession(backend, scratchPath, logPath)) as ChildSession;
      this.queue.updateTask(task.id, { childId: session.id, logPath, scratchPath });

      // 3. Execute with Sentinels
      const wrappedCommand = this.wrapCommand(task.id, task.command);
      const targetId = session.pid ? session.pid.toString() : session.id;
      await session.backend.send(targetId, wrappedCommand);

      // 4. Poll for completion
      const result = await this.pollForCompletion(task, session);
      
      // 5. Handle Result
      if (result.success) {
        const structured = await this.manager.collect(session.id, this.manager.config.get("taskResultStructured"));
        this.queue.updateTask(task.id, { 
          status: "succeeded", 
          finishedAt: Date.now(), 
          result: typeof structured === "string" ? structured : structured 
        });
      } else {
        this.handleFailure(task, result.error || "Unknown error occurred during task execution");
      }

      // 6. Cleanup
      if (this.manager.config.get("cleanupTaskChildren") && session.id) {
        await this.manager.stopSession(session.id!);
      }

    } catch (e: any) {
      this.handleFailure(task, e.message);
    } finally {
      this.runningTasks.delete(task.id);
    }
  }

  private wrapCommand(taskId: string, command: string): string {
    const startMarker = `echo PICA_TASK_START_${taskId}`;
    const endMarker = `echo PICA_TASK_DONE_${taskId}`;
    const failMarker = `echo PICA_TASK_FAIL_${taskId}`;
    
    if (process.platform === 'win32') {
      // Use $LASTEXITCODE to detect failures for both native commands and scripts
      return `${startMarker}; ${command}; if ($LASTEXITCODE -eq 0 -or $?) { ${endMarker} } else { ${failMarker} }`;
    } else {
      // Use bash && for success, and a fallback for failure
      return `${startMarker} && ( ${command} && ${endMarker} || ${failMarker} )`;
    }
  }

  private async pollForCompletion(task: QueuedTask, session: ChildSession): Promise<{ success: boolean; error?: string }> {
    const timeout = task.timeoutMs || this.manager.config.get("maxRuntime");
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const logs = await this.manager.readLog(session.id);
      // console.log(`Polling ${task.id}: ${logs.slice(-100)}`);
      if (logs.includes(`PICA_TASK_DONE_${task.id}`)) {
        return { success: true };
      }
      if (logs.includes(`PICA_TASK_FAIL_${task.id}`)) {
        return { success: false, error: "Command failed" };
      }
      if (logs.includes(`[PICA_TIMEOUT]`)) {
        return { success: false, error: "Task timed out" };
      }
      if (session.status === "stopped" || session.status === "failed") {
        return { success: false, error: "Child session stopped unexpectedly" };
      }
      await new Promise(r => setTimeout(r, 200));
    }

    return { success: false, error: "Task execution timed out" };
  }

  private handleFailure(task: QueuedTask, error: string) {
    const currentAttempts = task.attempts + 1;
    console.log(`Task ${task.id} failed (Attempt ${currentAttempts}/${task.maxAttempts}): ${error}`);
    if (currentAttempts < task.maxAttempts) {
      this.queue.updateTask(task.id, { 
        status: "queued", 
        attempts: currentAttempts, 
        error: `Attempt ${currentAttempts} failed: ${error}` 
      });
    } else {
      this.queue.updateTask(task.id, { 
        status: "failed", 
        attempts: currentAttempts, 
        finishedAt: Date.now(), 
        error 
      });
    }
  }

  getQueueStatus() {
    const status = this.queue.getQueueStatus();
    return {
      ...status,
      running: this.isRunning,
      runningTasks: this.runningTasks.size,
    };
  }

  listTasks(filter?: { status?: TaskStatus[]; includeCompleted?: boolean }) {
    return this.queue.listTasks(filter);
  }

  async cancelTask(id: string) {
    const task = this.queue.getTask(id);
    if (!task) throw new Error("Task not found");

    if (task.childId) {
      await this.manager.stopSession(task.childId);
    }
    this.queue.cancelTask(id);
    this.runningTasks.delete(id);
  }

  async collectTaskResult(id: string) {
    const task = this.queue.getTask(id);
    if (!task) throw new Error("Task not found");
    return {
      taskId: task.id,
      status: task.status,
      result: task.result,
    };
  }

  getTask(id: string) {
    return this.queue.getTask(id);
  }

  getAllTasks() {
    return this.queue.getAllTasks();
  }

  recoverTask(task: QueuedTask) {
    this.queue.recoverTask(task);
  }

  clearAllTasks() {
    this.runningTasks.clear();
    this.queue.clearTasks({ includeSucceeded: true, includeFailed: true, includeCanceled: true });
  }

  clearAllHistory() {
    this.queue.clearAllHistory();
  }

  updateTask(id: string, updates: any) {
    return this.queue.updateTask(id, updates);
  }

  clearTasks(options: { includeSucceeded: boolean; includeFailed: boolean; includeCanceled: boolean }) {
    return this.queue.clearTasks(options);
  }

  clearCompleted(options: { includeSucceeded: boolean; includeFailed: boolean; includeCanceled: boolean }) {
    return this.queue.clearTasks(options);
  }
}
