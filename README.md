# wish

Secondhand marketplace web platform (dark theme, violet accent).

Stack: Node.js 24 LTS, pnpm small monorepo, TypeScript, NestJS backend, React frontend, MySQL, Docker, GitHub Actions.

## Status

- Backend: `apps/server` — NestJS API. The auth slice (signup/login/logout/me, bearer session tokens, common guard) is in review; member persistence is an in-memory adapter until the MySQL slice.
- Frontend: `apps/web` — React, pending implementation (login/signup screens are a separate card).
- Design system v1 and static screen drafts exist in the private design workspace.
- CI contract lives in `.team/ci.json`; `.github/workflows/ci.yml` runs the required checks on GitHub-hosted runners (recorded deviation, 2026-11-07).

## Engineering

See `docs/engineering.md` and `AGENTS.md`. Work flows through domain Issues, short-lived branches and review-sized PRs; direct pushes to `main` are not allowed.
