# LUNA Knowledge / D1 rollout

This document describes the deployment boundary for the LUNA Constitution + Second Brain externalization.

## Ownership model

- Cloudflare D1: canonical durable knowledge store after cutover.
- LUNA CORE: authenticated access, validation, conflict detection, migration, and AI orchestration.
- Airtable bridge: ChatGPT-accessible mirror/ingress. It is not the canonical source after cutover.
- Durable Object: current HubState only.
- Airtable domain bases: diary/health/study and other time-series operational history.
- ChatGPT Library: current source of truth until all cutover gates pass; retained as a rollback snapshot after cutover.

No personal Second Brain content is committed to this public repository.

## D1 resource setup

Create one D1 database, for example:

```sh
npx wrangler@4 d1 create luna-knowledge
```

Add the returned database binding to `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "KNOWLEDGE_DB",
    "database_name": "luna-knowledge",
    "database_id": "<cloudflare-d1-database-id>",
    "migrations_dir": "migrations"
  }
]
```

Apply the schema:

```sh
npx wrangler@4 d1 migrations apply luna-knowledge --remote
```

## Worker secrets and vars

Required before migration:

- secret: `LUNA_KNOWLEDGE_TOKEN` — bearer token for every protected /knowledge route.
- secret: `AIRTABLE_PAT` — must have read/write access to the private Airtable knowledge bridge.
- var/secret: `KNOWLEDGE_AIRTABLE_BASE_ID`
- var/secret: `KNOWLEDGE_AIRTABLE_TABLE_ID`

Required for API Luna memory review:

- secret: `OPENAI_API_KEY`
- optional var: `OPENAI_MODEL`

Disabled by default:

- `LUNA_KNOWLEDGE_SYNC_ENABLED=true` enables the 5-minute Airtable↔D1 bridge reconciliation.
- `LUNA_MEMORY_REVIEW_ENABLED=true` enables the daily scheduled memory-candidate review.

Do not enable either flag before migration/readback testing succeeds.

## Initial migration

The private Airtable bridge is populated from the current ChatGPT Library outside this repository.

With D1 bound and secrets configured:

1. GET `/knowledge` and confirm `databaseConfigured=true`.
2. POST `/knowledge/migrate/airtable` with `Authorization: Bearer <LUNA_KNOWLEDGE_TOKEN>`.
3. GET `/knowledge/status`.
4. GET `/knowledge/documents` and verify document count/kinds.
5. GET selected documents and compare hash/body against the Library source.
6. Re-run migration once; unchanged documents must not increment version.

## Bridge behavior

Each Airtable bridge row contains the document plus:

- D1 Version
- D1 Hash
- Sync State
- Synced At
- Last Writer

ChatGPT-side edits must:

1. preserve the current D1 Version value,
2. edit the intended fields,
3. set `Sync State = pending`.

The Worker then checks the Airtable version against D1:

- equal version: Airtable change may update D1;
- mismatched version: mark `conflict`, do not overwrite D1;
- D1 newer and Airtable is not pending: mirror D1 back to Airtable.

This keeps D1 authoritative without silently overwriting concurrent edits.

## Constitution activation

During pre-cutover testing, the Constitution remains `draft`.
Manual AI review may opt into the draft Constitution with the protected review endpoint.

Only after regression tests pass should the Constitution document be updated to `active`.

Background AI never directly promotes inferred user behavior into formal Second Brain memory. AI output may keep a candidate observing, ask the user, or discard it. Formal durable writes require provenance and the normal memory policy.

## Cutover gates

Do not make D1 the sole source of truth until all are true:

- schema migration passed;
- Library→Airtable staging count complete;
- Airtable→D1 initial migration complete;
- readback/hash checks passed;
- version-conflict test passed;
- D1→Airtable mirror test passed;
- ChatGPT runtime can reliably read/write through the bridge;
- API Luna can read the same Constitution and knowledge;
- regression scenarios show no material behavior loss.

After cutover:

- D1 becomes canonical.
- Airtable bridge remains an access mirror/ingress.
- Library becomes rollback snapshot, not an actively edited second canonical copy.
- ChatGPT custom instructions may be reduced to the Bootstrap only.
