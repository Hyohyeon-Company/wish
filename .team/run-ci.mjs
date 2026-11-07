import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export const CHECKS = ['lint', 'typecheck', 'test:unit', 'test:integration', 'build', 'test:e2e', 'test:security', 'test:operations'];
const CONDITIONAL = new Set(['test:integration', 'test:e2e', 'test:operations']);
const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function validateContract(root, nodeVersion = process.versions.node) {
  if (Number(nodeVersion.split('.')[0]) !== 24) throw new Error('Node.js 24 is required');
  const readJSON = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  const pkg = readJSON('package.json');
  const contract = readJSON('.team/ci.json');
  if (!object(pkg) || !object(pkg.scripts)) throw new Error('Real package.json scripts are required');
  const pin = /^pnpm@(\d+\.\d+\.\d+)(?:\+sha(?:224|256|384|512)\.[a-fA-F0-9]+)?$/.exec(pkg.packageManager ?? '');
  if (!pin) throw new Error('Pin an exact stable pnpm version in packageManager');
  for (const file of ['pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    if (!statSync(resolve(root, file)).isFile()) throw new Error(`${file} must be a file`);
  }
  if (!object(contract) || contract.schema !== 'team-ci/v1' || !object(contract.checks)) {
    throw new Error('Invalid CI contract');
  }
  const names = Object.keys(contract.checks);
  if (names.length !== CHECKS.length || names.some(name => !CHECKS.includes(name))) {
    throw new Error('CI contract must explicitly account for every common check');
  }
  const checks = CHECKS.map(name => {
    const check = contract.checks[name];
    if (!object(check) || Object.keys(check).length !== 1) throw new Error(`Invalid check: ${name}`);
    if (typeof check.not_applicable === 'string' && check.not_applicable.trim()) {
      if (!CONDITIONAL.has(name)) throw new Error(`Mandatory check cannot be waived: ${name}`);
      return { name, reason: check.not_applicable.trim() };
    }
    if (check.script !== name || typeof pkg.scripts[name] !== 'string' || !pkg.scripts[name].trim()) {
      throw new Error(`Missing real root script: ${name}`);
    }
    return { name, script: name };
  });
  return { root: resolve(root), pnpmVersion: pin[1], checks };
}

export function runChecks(plan, execute = spawnSync) {
  const version = execute('pnpm', ['--version'], { cwd: plan.root, encoding: 'utf8' });
  if (version.error || version.status !== 0 || version.stdout?.trim() !== plan.pnpmVersion) {
    throw new Error('Installed pnpm must match packageManager exactly');
  }
  for (const check of plan.checks) {
    if (check.reason) {
      console.log(`${check.name}: NOT APPLICABLE — ${check.reason}`);
      continue;
    }
    console.log(`Running ${check.name}`);
    const result = execute('pnpm', ['run', check.script], { cwd: plan.root, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) return Number.isInteger(result.status) && result.status > 0 ? result.status : 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--validate')) throw new Error('Usage: node .team/run-ci.mjs [--validate]');
    const plan = validateContract(process.cwd());
    if (args[0] === '--validate') console.log('CI contract valid; checks have not been executed');
    else process.exitCode = runChecks(plan);
  } catch (error) {
    console.error(`CI failed: ${error.message}`);
    process.exitCode = 1;
  }
}
