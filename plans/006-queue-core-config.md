# Plan 006: Queue Core & Config

**Commit Baseline**: `0fb0e90`
**Goal**: Implement the data structures for the task queue and update the configuration loader to support queue settings.

## Context
We are evolving the extension from managing raw sessions to managing delegated tasks. This requires a way to track tasks independently of the sessions that execute them.

## Implementation Steps

### 1. Create `queue/taskQueue.ts`
Create a new directory `queue/` and a file `taskQueue.ts`.

**Requirements**:
- Define `TaskStatus`: `'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'timed_out' | 'blocked' | 'approval_required'`.
- Define `TaskPriority`: `'low' | 'normal' | 'high'`.
- Define `QueuedTask` interface:
    - `id`: string (e.g., `task_timestamp_random`)
    - `title`: string
    - `command`: string
    - `childId?`: string
    - `status`: TaskStatus
    - `priority`: TaskPriority
    - `attempts`: number
    - `maxAttempts`: number
    - `createdAt`: number
    - `startedAt?`: number
    - `finishedAt?`: number
    - `timeoutMs?`: number
    - `policyMode`: string
    - `result?`: any
    - `error?`: string
    - `logPath?`: string
    - `scratchPath?`: string
- Implement `TaskQueue` class:
    - `tasks: Map<string, QueuedTask>`
    - `enqueue(taskData)`: creates a task, assigns ID, sets default priority/attempts, and adds to map.
    - `getTask(id)`: retrieves a task.
    - `updateTask(id, updates)`: updates task properties.
    - `listTasks(filter)`: returns tasks based on status or completion.
    - `cancelTask(id)`: sets status to `canceled`.
    - `clearTasks(options)`: removes tasks based on `includeSucceeded`, `includeFailed`, etc.

### 2. Update `config/loader.ts`
Add queue-related settings to `ChildAgentConfig`.

**New Options**:
- `queueEnabled`: boolean (Default: `true`)
- `maxConcurrentTasks`: number (Default: `2`)
- `defaultTaskMaxAttempts`: number (Default: `1`)
- `cleanupTaskChildren`: boolean (Default: `true`)
- `taskResultStructured`: boolean (Default: `true`)

Update `DEFAULT_CONFIG` to include these values.

## Verification Plan

### 1. Type Check
Run `npx tsc -p tsconfig.json`. Must pass without errors.

### 2. Unit Test (Quick Check)
Create a temporary script `scripts/test-queue-core.ts` that:
- Enqueues 3 tasks with different priorities.
- Verifies that `listTasks` returns all 3.
- Cancels one task and verifies its status is `canceled`.
- Updates a task's status to `running` and verifies the change.
- Clears succeeded tasks and verifies the map size.

## Scope
- **In Scope**: `queue/taskQueue.ts`, `config/loader.ts`.
- **Out of Scope**: The actual execution loop (handled in Plan 007), the tools (handled in Plan 008).
