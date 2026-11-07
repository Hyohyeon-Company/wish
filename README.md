# wish

Secondhand marketplace web platform (dark theme, violet accent).

Stack: Node.js 24 LTS, pnpm small monorepo, TypeScript, NestJS backend, React frontend, MySQL, Docker, GitHub Actions.

## Status

- Design system v1 and static screen drafts exist in the private design workspace; implementation is pending environment binding.
- CI contract lives in `.team/ci.json`; the workflow template is `.github/workflows/ci.yml.example` and must be resolved before the first real implementation PR.

## Engineering

See `docs/engineering.md` and `AGENTS.md`. Work flows through domain Issues, short-lived branches and review-sized PRs; direct pushes to `main` are not allowed.
