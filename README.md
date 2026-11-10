# wish

Secondhand marketplace web platform (dark theme, violet accent).

Stack: Node.js 24 LTS, pnpm small monorepo, TypeScript, NestJS backend, React frontend, MySQL, Docker, GitHub Actions.

## Status

- Backend: `apps/server` — NestJS API with signup/login/logout/me, listings, search, favorites, status changes and soft delete. Persistence sits behind repository ports with two implementations: in-memory (code default, `WISH_STORAGE` unset) and MySQL (`WISH_STORAGE=mysql`, used by `docker-compose.yml`). The MySQL slice adds `db/migrations`, `db/seed`, `pnpm db:migrate`, `pnpm db:seed` and fails fast when the database is unreachable — there is no silent fallback.
- Frontend: `apps/web` — React, pending implementation (login/signup screens are a separate card).
- Design system v1 and static screen drafts exist in the private design workspace.
- CI contract lives in `.team/ci.json`; `.github/workflows/ci.yml` runs the required checks on GitHub-hosted runners (recorded deviation, 2026-11-07).

## Running locally

The node engine range is `>=24 <25`, so use the container path unless your host Node matches.

```bash
docker compose up -d --build          # api + mysql, api healthy once migrated
node scripts/api-flow-smoke.mjs       # 12-step business flow against :3000
docker compose exec api node dist/db/seed.js   # optional demo listings
```

Data is stored in the `wish-mysql-data` volume, so restarts keep members, listings
and favorites (`docker compose down -v` deletes them). Migrations run automatically
at startup and can be applied by hand with `node dist/db/migrate.js`.

Host-only runs use the in-memory adapters and keep nothing across restarts:

```bash
pnpm install
pnpm --filter @wish/server start      # WISH_STORAGE defaults to memory
```

## Storage configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `WISH_STORAGE` | `memory` | `memory` or `mysql`; any other value refuses to start |
| `WISH_DB_HOST` / `WISH_DB_PORT` | `127.0.0.1` / `3306` | MySQL location |
| `WISH_DB_USER` / `WISH_DB_PASSWORD` / `WISH_DB_NAME` | `wish` / — / `wish` | MySQL credentials |
| `WISH_DB_MIGRATIONS_DIR` / `WISH_DB_SEED_DIR` | `./db/migrations`, `./db/seed` | SQL locations for host runs |

Nickname uniqueness (`uq_members_nickname`) is a MySQL-schema rule, so a duplicate
nickname is rejected with 400 `VALIDATION_FAILED` only when `WISH_STORAGE=mysql`;
the in-memory adapters keep the pre-existing behaviour. Every script or manual
check that creates members (`scripts/api-flow-smoke.mjs`, the runbook retention
check) therefore uses a per-run email **and** nickname so it can be repeated
against a persistent volume.

See `.env.example` and `docs/operations/container-runbook.md` (migrations, seed,
data-retention checks, failure modes).

## Engineering

See `docs/engineering.md` and `AGENTS.md`. Work flows through domain Issues, short-lived branches and review-sized PRs; direct pushes to `main` are not allowed.
