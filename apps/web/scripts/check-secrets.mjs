// Secret scan for this package's tracked source and config files.
// Same pattern set as @wish/server's check (scope recorded with the PR):
// pattern-based secret detection for this slice; dependency-risk auditing
// lands with the CI/CD hardening slice.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src', 'scripts'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.css', '.html']);
const ROOT_FILES = ['package.json', 'tsconfig.json', 'index.html', 'vite.config.ts', 'eslint.config.mjs'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git']);

const PATTERNS = [
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/ },
  { name: 'GitHub fine-grained PAT', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'OpenAI-style API key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  {
    name: 'hardcoded credential assignment',
    re: /\b(?:SECRET|API_?KEY|PRIVATE_KEY|ACCESS_TOKEN|PASSWD)\s*[:=]\s*['"][^'"\s]{12,}['"]/i,
  },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const candidates = new Set(ROOT_FILES);
for (const root of ROOTS) {
  try {
    for (const file of walk(root)) {
      if (EXTENSIONS.has(file.slice(file.lastIndexOf('.')))) candidates.add(file);
    }
  } catch {
    // missing directory: nothing to scan there
  }
}

const findings = [];
for (const file of candidates) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    for (const { name, re } of PATTERNS) {
      if (re.test(line)) {
        findings.push(`${file}:${index + 1}: ${name}`);
      }
    }
  });
}

if (findings.length > 0) {
  console.error('Secret-scan findings (fix before committing):');
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}
console.log(`Secret scan clean (${candidates.size} files scanned).`);
