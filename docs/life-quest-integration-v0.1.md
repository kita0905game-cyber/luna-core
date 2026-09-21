# LIFE QUEST integration v1

## Production architecture

LUNA CORE is the LIFE QUEST backend and orchestration layer.
LIFE QUEST remains an independent React / TypeScript / Phaser / PWA client.

Current responsibility split:

- AppDeploy: user study UI
- Airtable: user study-data record area
- GitHub: source of LIFE QUEST / LUNA CORE logic
- Cloudflare Workers: runtime for LUNA CORE
- Durable Object SQLite: canonical LIFE QUEST GameState
- LIFE QUEST PWA: gameplay client

## Deployment

- `kita0905game-cyber/luna-core` main is the production Worker source.
- Updating main automatically deploys the entire Worker to Cloudflare Workers.
- `/health` is liveness only.
- `/quest` reports LIFE QUEST operational state.

## Migration

The AppDeploy LIFE QUEST GameState was migrated on 2026-09-22 through a one-time browser-assisted push.

Migration guarantees:

- scope: game-only
- bookkeeping records were not migrated
- source snapshot is immutable
- active GameState is stored separately
- legacy AppDeploy data was not deleted
- migration endpoint is idempotent after activation

## Gameplay sync

The PWA bootstraps from LUNA CORE and keeps a local copy for responsiveness and offline operation.

Each local gameplay change is sent with a unique mutation ID.

LUNA CORE:

1. rejects unauthenticated client requests,
2. deduplicates previously processed mutation IDs,
3. applies only the delta from the client mutation to the current canonical GameState,
4. preserves canonical fields not represented by the current client,
5. stores the new canonical GameState.

This prevents client writes from erasing fields such as LQ, railway state, warehouses or other migrated systems.

## Study -> LIFE QUEST

The intended production flow is:

```text
AppDeploy study answer
  -> Airtable mirror succeeds
  -> browser queues an idempotent study event
  -> LUNA CORE receives the event with the paired device token
  -> GitHub-defined reward logic calculates LQ / XP / energy / bait / boss progress
  -> canonical GameState is updated
  -> LIFE QUEST PWA receives the updated state
```

AppDeploy no longer calculates or mutates the production LIFE QUEST GameState from study answers.

Study event IDs are deduplicated in the Durable Object.

## Authentication

Gameplay sync and study-event delivery use a per-device pairing token.

Only its SHA-256 verifier is stored in the LUNA CORE source. The raw token is supplied to the user's browser through a one-time pairing link and stored only in that origin's localStorage.

Migration uses a separate one-time migration token verifier.

## Safety invariants

Never erase or devalue:

- existing LIFE QUEST saves
- LQ / G / XP
- materials, fish, achievements, chapters
- railway and warehouse state
- prior study effort
- historical progress

Client fields that do not exist yet must not overwrite or delete canonical fields.

No save reset is permitted for implementation convenience.

## MAGI roadmap

MAGI remains outside the production write path for now.

Future rollout:

1. observation only
2. proposed changes
3. independent three-perspective review
4. tests + deterministic policy gate
5. guarded low-risk autonomous merge/deploy

Save migrations, economy changes, authentication, permissions and authority expansion remain protected.
