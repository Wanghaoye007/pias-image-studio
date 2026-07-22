# Content Studio LAN Deployment Implementation Plan

> **For agentic workers:** Execute tasks in order with tests before implementation changes.

**Goal:** Provide a secure, self-contained HTTPS LAN deployment path for the complete Content Studio production service.

**Architecture:** Keep the existing production server on loopback and place a fixed-upstream Node HTTPS gateway in front of it. Generate authentication, certificate and LaunchAgent artifacts outside the repository with strict file permissions.

**Tech Stack:** Node.js 24, node:http, node:https, node:crypto, OpenSSL, launchd, Vitest.

## Global Constraints

- Do not expose the Vite development server as the operational service.
- Do not transmit or persist plaintext Fal credentials in repository files.
- LAN gateway hosts must be concrete RFC 1918 IPv4 addresses.
- Existing production-server behavior and loopback restriction remain unchanged.
- Generated secrets must use mode `0600`; generated directories must use mode `0700`.

### Task 1: LAN configuration and proxy boundary

**Files:**
- Create: `scripts/lan-gateway-core.mjs`
- Create: `scripts/lan-gateway-core.d.mts`
- Create: `scripts/start-lan.mjs`
- Test: `tests/lanGateway.test.ts`

- [ ] Add failing tests for accepted private hosts, rejected wildcard/public hosts, HTTPS Origin equality, secret-file permissions and hop-by-hop header removal.
- [ ] Implement `loadLanGatewayConfig(env)`, `createLanGateway(options)` and `filterProxyHeaders(headers)`.
- [ ] Implement the production-server and gateway lifecycle entrypoint.
- [ ] Run `npx vitest run tests/lanGateway.test.ts --config vitest.config.ts` and require all tests to pass.

### Task 2: Authentication bootstrap

**Files:**
- Create: `scripts/bootstrap-lan-auth-core.mjs`
- Create: `scripts/bootstrap-lan-auth-core.d.mts`
- Create: `scripts/bootstrap-lan-auth.mjs`
- Test: `tests/bootstrapLanAuth.test.ts`

- [ ] Add failing tests that verify no plaintext password enters `auth.json`, both users satisfy the schema, privileged MFA is enabled, and all generated secret files use mode `0600`.
- [ ] Implement random password, Base32 TOTP Secret, scrypt hash, atomic file writes and overwrite refusal.
- [ ] Run the focused bootstrap tests and require all tests to pass.

### Task 3: Certificate and service installation

**Files:**
- Create: `scripts/generate-lan-certificate.mjs`
- Create: `scripts/install-lan-launch-agent.mjs`
- Create: `deploy/content-studio.lan.env.example`
- Create: `deploy/com.content-studio.lan.plist.example`
- Test: `tests/lanDeploymentArtifacts.test.ts`

- [ ] Add failing artifact-contract tests for private IP SAN, TLS file variables, Node `--env-file`, `RunAtLoad`, `KeepAlive`, private logs and absence of embedded secrets.
- [ ] Implement certificate generation with explicit `--apply` and overwrite refusal.
- [ ] Implement LaunchAgent rendering/install with explicit `--apply` and no secret values in the plist.
- [ ] Run focused artifact tests and require all tests to pass.

### Task 4: Documentation and package entrypoints

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/ENVIRONMENT.md`
- Create: `docs/operations/lan-deployment.md`

- [ ] Add `lan:auth`, `lan:cert`, `lan:start` and `lan:install` package scripts.
- [ ] Document preparation, CA distribution, startup, firewall boundary, backup, credential rotation and acceptance commands.
- [ ] Run repository hygiene and documentation contract tests.

### Task 5: Local deployment and end-to-end acceptance

- [ ] Generate local credentials, certificate and environment under `~/.content-studio` without printing secrets.
- [ ] Restrict the Fal Key file to `0600`.
- [ ] Build the current commit and initialize the SQLite/asset directories.
- [ ] Install/start the LaunchAgent and verify both loopback and LAN listeners.
- [ ] Verify live/ready endpoints over HTTPS, unauthenticated API rejection, owner password challenge and browser rendering.
- [ ] Run `repo:check`, `typecheck`, `lint`, `test` and `build`.
