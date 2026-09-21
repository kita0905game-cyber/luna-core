# LIFE QUEST integration v0.1

## Goal
LUNA CORE is the shared backend/orchestration layer.
LIFE QUEST remains an independent React/TypeScript/Phaser/PWA client.

## Current deployment model
- GitHub `main` is the production source of truth.
- Updating `main` automatically deploys the entire Worker to Cloudflare Workers.
- `/health` is only a liveness endpoint, not a health-management feature.
- Any future route added to the Worker (for example `/quest`) will be published by the same deployment pipeline after merge to `main`.

## v0.1 scope
This branch only introduces a non-destructive `GET /quest` scaffold.

Existing behavior preserved:
- `GET /health` -> liveness JSON
- all other unmatched routes -> `LUNA CORE is running`
- scheduled cron logging remains unchanged

## Planned LIFE QUEST API phases

### Phase 1 - Read-only
- `GET /quest`
- `GET /quest/state`
- `GET /quest/events`

No production game state mutation.

### Phase 2 - Versioned state writes
- `PUT /quest/state`
- optimistic version checks
- audit log
- rollback snapshots

### Phase 3 - Real-world event bridge
- bookkeeping/study events
- weather/time context
- future calendar/life events

### Phase 4 - MAGI observation
MAGI may inspect code, logs, tests and game state but cannot merge or deploy.

### Phase 5 - Guarded autonomous changes
Only low-risk changes may be auto-merged after:
- three independent AI approvals
- automated tests
- deterministic policy gate
- rollback point creation

High-risk areas such as save migrations, economy rules, study-to-LQ conversion, authentication and destructive changes remain human-authorized.

## Non-negotiable migration rule
Do not erase or devalue existing LIFE QUEST saves, history, LQ/G/XP, bookkeeping progress, achievements, or prior effort for implementation convenience.
