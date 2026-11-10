#!/usr/bin/env node
/**
 * wish CI container checks — the single source of truth for the two container
 * checks the CI contract declares in `.team/ci.json`:
 *
 *   --check operations   (`pnpm test:operations`)  container gate
 *   --check integration  (`pnpm test:integration`) isolated MySQL/API integration
 *
 * `.github/workflows/ci.yml` deliberately contains no build/compose/health
 * commands anymore: it runs `node .team/run-ci.mjs`, which executes the root
 * package scripts, and those scripts call this file. One implementation, so the
 * gate cannot drift between the workflow and the contract.
 *
 * ## operations — the deployable surface gate
 *
 * It exists because the Dockerfile is part of the deployable surface and its
 * permission defect (a COPY that inherits the checkout's restrictive file modes
 * and leaves the non-root runtime user unable to read package.json) is
 * invisible to the pnpm checks: they run as the checkout user, not as uid 10001.
 *
 * Steps, in this order:
 *   1. emulate a restrictive-umask checkout: every tracked file is chmod 0600
 *      before the build, so a COPY that does not normalize modes fails here
 *      again. The original modes are restored afterwards, whatever happens.
 *   2. build the API image from apps/server/Dockerfile.
 *   3. start the composition (`docker compose up --wait`).
 *   4. require `GET /api/categories` to answer 200.
 *   5. on failure print `compose ps` and the container logs; always tear the
 *      stack down with its volumes.
 *
 * ## integration — isolated MySQL/API proof
 *
 * A fresh compose project with its own volume, so nothing is inherited from a
 * previous run: MySQL 8.4 must accept connections, the API must have applied the
 * migrations at startup (the migration runner is re-run and must report
 * `upToDate: true`), the demo seed must apply, and the 12-step business flow
 * (`scripts/api-flow-smoke.mjs`, which includes the logout → 401 denial steps)
 * must pass against the MySQL-backed API. Teardown removes the volume.
 *
 * ## Environment
 *
 *   WISH_DOCKER              docker CLI to use (default `docker`). Set it to a
 *                            wrapper when the caller has no direct socket access.
 *   WISH_API_PORT            host port the API publishes 3000 on (default 3000)
 *   WISH_BUILDX_CACHE_DIR    when set, build with buildx and a `type=local`
 *                            layer cache in that directory (CI). Unset → plain
 *                            `docker build`.
 *   WISH_CI_PROJECT          compose project name override
 *   WISH_CI_HTTP_TIMEOUT_MS  per-request timeout for the health poll
 *
 * Exit codes: 0 = the check passed, 1 = it failed, 2 = the check could not run
 * (no docker, wrong usage) — a precondition failure is never a green check.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const DOCKER = process.env.WISH_DOCKER ?? 'docker';
const IMAGE = 'wish-api:local';
const API_PORT = (process.env.WISH_API_PORT ?? '3000').trim();
const BASE_URL = `http://127.0.0.1:${API_PORT}`;
const HEALTH_PATH = '/api/categories';
const HTTP_TIMEOUT_MS = Number.parseInt(process.env.WISH_CI_HTTP_TIMEOUT_MS ?? '5000', 10);
const CACHE_DIR = process.env.WISH_BUILDX_CACHE_DIR?.trim();

const repoRoot = process.cwd();

/** Run a command, inheriting stdio; returns the exit status. */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: repoRoot, ...options });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

/** Run a command capturing stdout; returns { status, stdout, stderr }. */
function capture(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function log(message) {
  console.log(`[ci-container] ${message}`);
}

function fail(message) {
  console.error(`[ci-container] FAIL: ${message}`);
}

function docker(args) {
  return run(DOCKER, args);
}

/** Preconditions: without a usable docker CLI the check must not pass. */
function requireDocker() {
  if (capture(DOCKER, ['version', '--format', '{{.Server.Version}}']).status !== 0) {
    fail(`${DOCKER} cannot reach a docker daemon`);
    process.exit(2);
  }
  if (capture(DOCKER, ['compose', 'version']).status !== 0) {
    fail(`${DOCKER} compose is not available`);
    process.exit(2);
  }
}

/**
 * Emulate a restrictive-umask checkout for the build context.
 *
 * Git only tracks the executable bit, so a 0077 checkout (or the local host's
 * umask) can leave every tracked file 0600. A COPY without `--chmod` carries
 * those modes into the image and breaks the non-root runtime user — the exact
 * defect this gate caught before. Rewriting the modes here reproduces that
 * checkout on any machine, and the originals are restored in `restore()`.
 */
function restrictCheckoutModes() {
  const listed = capture('git', ['ls-files', '-z']);
  if (listed.status !== 0) throw new Error('git ls-files failed: run this check inside the repository checkout');
  const files = listed.stdout.split('\0').filter(Boolean);
  if (files.length === 0) throw new Error('no tracked files found; refusing to run the gate on an empty checkout');

  const saved = [];
  let changed = 0;
  for (const file of files) {
    if (!existsSync(file)) continue; // deleted-but-tracked files are not built
    const absolute = resolve(repoRoot, file);
    const mode = statSync(absolute).mode & 0o777;
    saved.push([absolute, mode]);
    if (mode !== 0o600) {
      chmodSync(absolute, 0o600);
      changed += 1;
    }
  }
  log(`emulated a 0600 checkout for the build context (${changed}/${saved.length} tracked files rewritten)`);

  return () => {
    for (const [absolute, mode] of saved) {
      try {
        chmodSync(absolute, mode);
      } catch {
        // The checkout is disposable; a file that vanished cannot be restored
        // and must not turn a passing gate into a failure.
      }
    }
    log('restored the checkout file modes');
  };
}

/** Build the API image; uses the buildx local layer cache when CI provides one. */
function buildImage() {
  const args = ['--file', 'apps/server/Dockerfile', '--tag', IMAGE];
  if (CACHE_DIR) {
    mkdirSync(CACHE_DIR, { recursive: true });
    log(`building ${IMAGE} with buildx, layer cache ${CACHE_DIR}`);
    const status = docker([
      'buildx',
      'build',
      ...args,
      '--load',
      '--cache-from',
      `type=local,src=${CACHE_DIR}`,
      '--cache-to',
      `type=local,dest=${CACHE_DIR},mode=max`,
      '.',
    ]);
    if (status !== 0) throw new Error('image build failed');
    return;
  }
  log(`building ${IMAGE} with docker build`);
  if (docker(['build', ...args, '.']) !== 0) throw new Error('image build failed');
}

function compose(project, args) {
  return docker(['compose', '-p', project, ...args]);
}

function startStack(project) {
  log(`starting compose project ${project} (api on host port ${API_PORT})`);
  const status = compose(project, [
    'up',
    '-d',
    '--no-build',
    '--wait',
    '--wait-timeout',
    '180',
  ]);
  if (status !== 0) throw new Error('docker compose up --wait failed');
}

/** Poll the public endpoint; returns the observed status codes for the report. */
async function waitForHealthy(deadlineAttempts = 30, delayMs = 2000) {
  const attempts = [];
  for (let attempt = 1; attempt <= deadlineAttempts; attempt += 1) {
    let status = 'unreachable';
    try {
      const response = await fetch(`${BASE_URL}${HEALTH_PATH}`, {
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      status = String(response.status);
    } catch (error) {
      status = `unreachable: ${error.name}`;
    }
    attempts.push(status);
    if (status === '200') {
      log(`GET ${HEALTH_PATH} -> 200 on attempt ${attempt}`);
      return { ok: true, attempts };
    }
    if (attempt < deadlineAttempts) await new Promise((done) => setTimeout(done, delayMs));
  }
  log(`GET ${HEALTH_PATH} did not answer 200 within ${deadlineAttempts} attempts`);
  return { ok: false, attempts };
}

function dumpDiagnostics(project) {
  compose(project, ['ps']);
  compose(project, ['logs', '--no-color']);
}

function teardown(project) {
  // `--volumes` keeps the check isolated: the next run starts from an empty
  // database, which is what makes the migration/seed assertions meaningful.
  compose(project, ['down', '--volumes', '--remove-orphans']);
}

/** Read one JSON document printed by an in-container command. */
function parseJsonOutput(stdout) {
  const start = stdout.indexOf('{');
  if (start < 0) return null;
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    return null;
  }
}

async function checkOperations(project) {
  const steps = [];
  const restoreModes = restrictCheckoutModes();
  try {
    buildImage();
    steps.push({ step: 'image-build', ok: true });
  } finally {
    restoreModes();
  }

  let healthy = { ok: false, attempts: [] };
  try {
    startStack(project);
    steps.push({ step: 'compose-up', ok: true });
    healthy = await waitForHealthy();
    steps.push({ step: 'health', ok: healthy.ok, path: HEALTH_PATH });
    if (!healthy.ok) throw new Error(`${HEALTH_PATH} did not answer 200`);
  } finally {
    if (!healthy.ok) dumpDiagnostics(project);
    teardown(project);
  }
  return { steps, healthy };
}

async function checkIntegration(project) {
  const steps = [];
  let failure = null;
  try {
    buildImage();
    steps.push({ step: 'image-build', ok: true });

    startStack(project);
    steps.push({ step: 'compose-up', ok: true });

    const healthy = await waitForHealthy();
    steps.push({ step: 'health', ok: healthy.ok, path: HEALTH_PATH });
    if (!healthy.ok) throw new Error(`${HEALTH_PATH} did not answer 200`);

    // The API migrates at startup; re-running the runner must find nothing
    // pending. A `false` here means the startup migration did not happen.
    const migrated = capture(DOCKER, [
      'compose',
      '-p',
      project,
      'exec',
      '-T',
      'api',
      'node',
      'dist/db/migrate.js',
    ]);
    const migration = parseJsonOutput(migrated.stdout);
    const migrationOk = migrated.status === 0 && migration?.upToDate === true;
    steps.push({
      step: 'migrate',
      ok: migrationOk,
      target: migration?.target ?? null,
      up_to_date: migration?.upToDate ?? null,
    });
    if (!migrationOk) throw new Error('the migration runner did not report an up-to-date schema');

    const seeded = capture(DOCKER, [
      'compose',
      '-p',
      project,
      'exec',
      '-T',
      'api',
      'node',
      'dist/db/seed.js',
    ]);
    const seed = parseJsonOutput(seeded.stdout);
    const seedOk = seeded.status === 0 && seed !== null;
    steps.push({ step: 'seed', ok: seedOk, statements: seed?.statements ?? null });
    if (!seedOk) throw new Error('the demo seed did not apply');

    // The 12-step business flow, including the logout → 401 denial steps. It is
    // the same script the runbook and the local verification use.
    const smoke = run(process.execPath, ['scripts/api-flow-smoke.mjs'], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, WISH_BASE_URL: BASE_URL, WISH_API_PORT: API_PORT },
    });
    steps.push({ step: 'api-flow-smoke', ok: smoke === 0 });
    if (smoke !== 0) throw new Error('the 12-step API flow smoke failed against the MySQL composition');
  } catch (error) {
    failure = error;
    dumpDiagnostics(project);
  } finally {
    teardown(project);
  }
  return { steps, failure };
}

async function main() {
  const args = process.argv.slice(2);
  const index = args.indexOf('--check');
  const check = index >= 0 ? args[index + 1] : undefined;
  if (!check || !['operations', 'integration'].includes(check) || args.length > 2) {
    console.error('Usage: node scripts/ci-container-gate.mjs --check operations|integration');
    process.exit(2);
  }

  requireDocker();

  const startedAt = Date.now();
  const project = process.env.WISH_CI_PROJECT ?? `wish-ci-${check}`;
  const summary = { schema: 'wish-ci-container-check/v1', check, project, image: IMAGE, api_port: API_PORT };

  try {
    if (check === 'operations') {
      const { steps, healthy } = await checkOperations(project);
      Object.assign(summary, { steps, ok: healthy.ok });
    } else {
      const { steps, failure } = await checkIntegration(project);
      Object.assign(summary, { steps, ok: failure === null });
      if (failure) summary.error = failure.message;
    }
  } catch (error) {
    Object.assign(summary, { ok: false, error: error.message });
  }

  summary.duration_ms = Date.now() - startedAt;
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.ok ? 0 : 1;
}

await main();
