# Plan 001: Security Policy Infrastructure

**Commit Baseline**: `(current HEAD)`
**Goal**: Implement a configurable security policy system to replace the hardcoded security checks in `SecurityGuard`.

## Context
Currently, `SecurityGuard` has a set of hardcoded blocked paths and commands. We need a system where the behavior changes based on a `policyMode` (`strict`, `standard`, `trusted`).

## Implementation Steps

### 1. Create `security/policy.ts`
Create a new file that defines the policy engine.

**Requirements**:
- Define `PolicyMode` enum/type: `'strict' | 'standard' | 'trusted'`.
- Define `SecurityPolicy` interface containing:
    - `allowWorkspaceWrite`: boolean
    - `allowNetworkCommands`: boolean
    - `allowPackageInstall`: boolean
    - `allowGitWrite`: boolean
    - `allowSecretForwarding`: boolean
    - `requireApprovalForHighRisk`: boolean
    - `blockedCommands`: string[]
    - `allowedCommands`: string[]
    - `protectedPaths`: string[]
- Implement `DEFAULT_POLICIES` mapping `PolicyMode` to these settings:
    - **Strict**: `allowWorkspaceWrite: false`, `allowNetworkCommands: false`, `allowPackageInstall: false`, `allowGitWrite: false`, `allowSecretForwarding: false`, `requireApprovalForHighRisk: true`.
    - **Standard (Default)**: `allowWorkspaceWrite: false`, `allowNetworkCommands: true`, `allowPackageInstall: false`, `allowGitWrite: false`, `allowSecretForwarding: false`, `requireApprovalForHighRisk: true`.
    - **Trusted**: `allowWorkspaceWrite: true`, `allowNetworkCommands: true`, `allowPackageInstall: true`, `allowGitWrite: true`, `allowSecretForwarding: false`, `requireApprovalForHighRisk: true`.
- Implement `resolvePolicy(config)`: Merges user config with the `DEFAULT_POLICIES` for the chosen mode.
- Implement `PolicyDecision` class/interface:
    - `allowed: boolean`
    - `requiresApproval: boolean`
    - `reason: string`
    - `category: string`
    - `severity: 'low' | 'medium' | 'high' | 'critical'`

### 2. Update `security/guard.ts`
Integrate the policy system into the `SecurityGuard`.

**Requirements**:
- The `SecurityGuard` should now accept a `SecurityPolicy` object in its constructor or via a `setPolicy` method.
- Update `checkCommand(command)` to:
    1. Identify the **Category** of the command (Destructive, Package-Install, Git-Write, Network, Registry, PowerShell-Policy, System-Path, Secret-Access, Workspace-Write, Unknown).
    2. Use the `SecurityPolicy` to determine if the category is allowed or requires approval.
    3. Return a `PolicyDecision` instead of a simple boolean.
- Ensure the list of "Destructive", "Package install", etc., examples from the Phase 7A spec are implemented as regex or keyword matches.
- Maintain existing path protection logic but feed it through the policy.

## Verification Plan

### 1. Type Check
Run `npx tsc -p tsconfig.json`. Must pass without errors.

### 2. Unit Test (Quick Check)
Create a temporary script `scripts/test-policy.ts` that:
- Instantiates `SecurityGuard` with `strict` policy.
- Checks `npm install` $\rightarrow$ Expect `requiresApproval: true` or `allowed: false`.
- Checks `rm -rf /` $\rightarrow$ Expect `severity: 'critical'`, `allowed: false`.
- Instantiates `SecurityGuard` with `trusted` policy.
- Checks `npm install` $\rightarrow$ Expect `allowed: true`.

## Scope
- **In Scope**: `security/policy.ts`, `security/guard.ts`.
- **Out of Scope**: `child_agent_send` (handled in Plan 002), `child_agent_collect` (handled in Plan 003).
