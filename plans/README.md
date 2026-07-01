# Phase 7A: Security Policies & Structured Collection

This series of plans implements a configurable security policy system and structured result extraction for the `pi-child-agent` extension.

## Execution Order & Dependencies

| Plan | Slug | Description | Dependency | Status |
| :--- | :--- | :--- | :--- | :--- |
| 001 | `security-policy-infra` | Core policy logic and Guard integration | None | TODO |
| 002 | `approval-workflow` | UI-based approval and `child_agent_send` logic | 001 | TODO |
| 003 | `structured-collect` | Deterministic log extraction for `collect` | None | TODO |
| 004 | `verification-suite` | New security and collection test suites | 001, 002, 003 | TODO |
| 005 | `release-polish` | README, Versioning (v0.1.10), and Final Validation | 004 | TODO |

## General Conventions for Executor
- **No Regressions**: The existing Windows-native workflow must remain untouched.
- **Type Safety**: All new files must be strictly typed.
- **Verification**: Every plan must be verified by running the specified test commands.
- **Clean Exit**: Tests must not leave hanging handles or zombie processes.
