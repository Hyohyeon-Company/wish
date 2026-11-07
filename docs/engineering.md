# Engineering baseline

Use Node.js 24 LTS, an exactly pinned pnpm version, a committed lockfile and a small monorepo (`apps/*`, `packages/*`). MySQL is the database and Docker the runtime packaging. Select framework/ORM/auth/test libraries to fit the actual product; record short decisions here as they are made. Prefer existing role expertise in TypeScript, NestJS and React without forcing unnecessary architecture.

Source editing, execution, builds and tests run on the team's separate server PC. Development/CI have no production data or credentials. Production runs immutable images; each project has separate MySQL and Prometheus/Grafana/Loki instances, credentials, volumes and networks.

Implement real root package scripts matching `.team/ci.json`. The CI contract fails when scripts, tool pins or the lockfile are missing. Integration, E2E and operations exceptions require a concrete inapplicability reason reviewed with the PR. Domain rules, authorization denial and real database behavior need meaningful verification when applicable. Never insert success-only placeholder scripts.

GitHub Actions is the pipeline orchestrator; local CI needs disposable VM isolation and a separately trusted deployment path. Workflow/CODEOWNERS examples remain inactive until real identities, immutable action SHAs and isolation are verified. A runner label is not an isolation boundary. External PRs do not automatically run on local infrastructure.

Protected main merge by the implementer triggers CI then automatic deployment within the approved project/environment. Deploy only the tested main commit's immutable images, with staging smoke, migration compatibility, health checks and serialized promotions. A main CI failure prevents deployment. Monitoring incidents allow diagnosis/reporting first; user instruction is required to begin repairs.
