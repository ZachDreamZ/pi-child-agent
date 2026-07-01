# Phase 7: Security & Workflow Evolution

This series of plans implements a configurable security policy system, structured result extraction, and a delegated task queue.

## Execution Order & Dependencies

| Plan | Slug | Description | Dependency | Status |
| :--- | :--- | :--- | :--- | :--- |
| 001 | `security-policy-infra` | Core policy logic and Guard integration | None | DONE |
| 002 | `approval-workflow` | UI-based approval and `child_agent_send` logic | 001 | DONE |
| 003 | `structured-collect` | Deterministic log extraction for `collect` | None | DONE |
| 004 | `verification-suite` | New security and collection test suites | 001, 002, 003 | DONE |
| 005 | `release-polish` | README, Versioning (v0.1.10), and Final Validation | 004 | DONE |
| 006 | `queue-core-config` | TaskQueue logic and config updates | None | TODO |
| 007 | `queue-engine` | Task execution loop and sentinel integration | 006 | TODO |
| 008 | `queue-tooling` | Registration of 6 new queue tools | 007 | TODO |
| 009 | `queue-verification` | New task queue test suite | 006, 007, 008 | TODO |
| 010 | `release-v0.1.11` | README, Versioning (v0.1.11), and Final Validation | 009 | TODO |

## General Conventions for Executor
- **No Regressions**: The existing Windows-native workflow must remain untouched.
- **Type Safety**: All new files must be strictly typed.
- **Verification**: Every plan must be verified by running the specified test commands.
- **Clean Exit**: Tests must not leave hanging handles or zombie processes.
