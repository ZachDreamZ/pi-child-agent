# Release Checklist

## Pre-Release

- [ ] Bump version in `package.json` and `VERSION` (both must match)
- [ ] Update `CHANGELOG.md` with new version, date, and changes
- [ ] Verify all tests pass locally:
  ```bash
  npx tsc -p tsconfig.json
  npx tsx scripts/validate-tools.ts
  npx tsx scripts/doctor.ts
  npm test
  ```
- [ ] Run `npm install` to verify dependencies resolve
- [ ] Verify `README.md` tool names match registered tools (no stale dotted names)
- [ ] Verify `README.md` examples use correct command syntax
- [ ] Check that `VERSION` file matches `package.json` version

## Platform Testing

- [ ] **Windows**: Run `npm run test:windows-native` and `npm run test:crash`
- [ ] **Ubuntu**: Run `npm run test:phase2` and `npm run test:container` (if Docker available)
- [ ] **Container**: If Docker/Podman is installed, run `npm run test:container`
- [ ] **Pi integration**: 
  ```bash
  pi install .
  pi list  # verify extension appears
  pi -p --mode json -e ./index.ts "test"  # verify no load errors
  ```

## Installation Verification

- [ ] Run `npm run doctor` — all 18 checks pass (Docker/Podman warnings allowed)
- [ ] Verify extension loads in Pi without errors
- [ ] Verify tools appear in Pi:
  Use `pi -p` or check for absence of "Invalid tool name" errors

## Security Verification

- [ ] `C:\Windows` path protection works (on Windows)
- [ ] `C:\Program Files (x86)` path protection works (on Windows)
- [ ] High-risk command detection works for `rm -rf /`, `format`, etc.
- [ ] Secret env vars (API_KEY, TOKEN, SECRET, PASSWORD) are scrubbed
- [ ] Protected paths are not accessible from container mode

## Release

- [ ] Tag the commit: `git tag v$(cat VERSION)`
- [ ] Push tag: `git push origin v$(cat VERSION)`
- [ ] Create GitHub Release with changelog entry
- [ ] Optionally publish as Pi package:
  ```bash
  pi-publish  # if registered as a Pi package
  ```

## Post-Release

- [ ] Verify CI workflow completed successfully
- [ ] Download and inspect test log artifacts
- [ ] Update `README.md` if needed for new features
