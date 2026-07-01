export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "canceled" | "timed_out" | "blocked" | "approval_required";
export type TaskPriority = "low" | "normal" | "high";

export interface QueuedTask {
  id: string;
  title: string;
  command: string;
  childId?: string;
  status: TaskStatus;
  priority: TaskPriority;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  timeoutMs?: number;
  policyMode: string;
  result?: any;
  error?: string;
  logPath?: string;
  scratchPath?: string;
}

export interface TaskQueueOptions {
  maxConcurrentTasks: number;
  defaultTaskMaxAttempts: number;
}

export class TaskQueue {
  private tasks: Map<string, QueuedTask> = new Map();

  enqueue(data: {
    title: string;
    command: string;
    priority?: TaskPriority;
    maxAttempts?: number;
    timeoutMs?: number;
    policyMode?: string;
  }, options: TaskQueueOptions): QueuedTask {
    const id = `task_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const task: QueuedTask = {
      id,
      title: data.title,
      command: data.command,
      status: "queued",
      priority: data.priority || "normal",
      attempts: 0,
      maxAttempts: data.maxAttempts ?? options.defaultTaskMaxAttempts,
      createdAt: Date.now(),
      timeoutMs: data.timeoutMs,
      policyMode: data.policyMode || "standard",
    };
    this.tasks.set(id, task);
    return task;
  }

  getTask(id: string): QueuedTask | undefined {
    return this.tasks.get(id);
  }

  updateTask(id: string, updates: Partial<QueuedTask>): QueuedTask | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    const updated = { ...task, ...updates };
    this.tasks.set(id, updated);
    return updated;
  }

  listTasks(filter?: { status?: TaskStatus[]; includeCompleted?: boolean }): QueuedTask[] {
    const all = Array.from(this.tasks.values());
    if (!filter) return all.sort((a, b) => this.priorityValue(b.priority) - this.priorityValue(a.priority));

    return all.filter(t => {
      if (filter.status && !filter.status!.includes(t.status)) return false;
      if (filter.includeCompleted === false) {
        const completed: TaskStatus[] = ["succeeded", "failed", "canceled", "timed_out"];
        if (completed.includes(t.status)) return false;
      }
      return true;
    }).sort((a, b) => this.priorityValue(b.priority) - this.priorityValue(a.priority));
  }

  cancelTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    this.updateTask(id, { status: "canceled" });
    return true;
  }

  clearTasks(options: { includeSucceeded: boolean; includeFailed: boolean; includeCanceled: boolean }): number {
    const initialSize = this.tasks.size;
    for (const [id, task] of this.tasks.entries()) {
      if (
        (options.includeSucceeded && task.status === "succeeded") ||
        (options.includeFailed && (task.status === "failed" || task.status === "timed_out")) ||
        (options.includeCanceled && task.status === "canceled")
      ) {
        this.tasks.delete(id);
      }
    }
    return initialSize - this.tasks.size;
  }

  getQueueStatus() {
    const all = Array.from(this.tasks.values());
    return {
      queued: all.filter(t => t.status === "queued").length,
      succeeded: all.filter(t => t.status === "succeeded").length,
      failed: all.filter(t => t.status === "failed" || t.status === "timed_out").length,
      tasks: all,
    };
  }

  private priorityValue(p: TaskPriority): number {
    return { high: 3, normal: 2, low: 1 }[p];
  }
}
