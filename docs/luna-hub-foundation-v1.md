# LUNA HUB Foundation v1

## Purpose

LUNA CORE is the coordinator for current life state, events, rules, AI decisions, and downstream actions.
It is not the canonical database for every domain.

Canonical source examples remain external:
- Airtable: study / diary / health / care records
- Google Calendar: calendar events
- LIFE QUEST Durable Object state: game state
- Second Brain: long-term knowledge and operating rules

LUNA HUB keeps the current projected state needed by clients such as LUNA HOME.

## Storage isolation

The existing Cloudflare Durable Object binding `QUEST_STATE` is reused to avoid a new binding migration.
The Hub uses a dedicated Durable Object name:

`hub-v1`

This is isolated from:
- LIFE QUEST: `primary`
- LUNA MORNING: `morning-v1`

## Event envelope

Schema: `luna-event/v1`

Required:
- `eventId`: stable idempotency key
- `type`: dotted event name, e.g. `care.nail.completed`
- `source`: producer, e.g. `luna-home`, `airtable`, `calendar`
- `occurredAt`: ISO timestamp
- `payload`: object

Optional:
- `domain`: inferred from the first segment of `type`
- `metadata`: object
- `payload.statePatch`: partial HubState domain patch

Initial domains:
`system`, `calendar`, `commute`, `weather`, `health`, `care`, `workout`, `study`, `diary`, `couple`, `lifequest`, `mail`, `presence`, `news`.

## HubState

Schema: `luna-hub-state/v1`

The HubState contains:
- monotonic `revision`
- global `mode`
- last processed event metadata
- one projected state object per domain

An event only updates its own domain. The optional `payload.statePatch` is deep-merged into that domain.
A `system.*` event may update the global mode by including `statePatch.mode`.

## API

Public:
- `GET /hub`: foundation status only

Protected by `Authorization: Bearer <LUNA_HUB_TOKEN>`:
- `GET /hub/current`
- `GET /hub/status`
- `GET /hub/events?limit=20`
- `POST /hub/event`

Protected endpoints return `503 luna_hub_token_not_configured` until the Cloudflare secret `LUNA_HUB_TOKEN` exists.

## Example event

```json
{
  "eventId": "care-nail-2026-10-01",
  "type": "care.nail.completed",
  "source": "luna-home",
  "occurredAt": "2026-10-01T11:00:00+09:00",
  "payload": {
    "statePatch": {
      "nail": {
        "lastDone": "2026-10-01",
        "showToday": false,
        "nextCheck": "2026-10-08"
      }
    }
  }
}
```

## Next integration order

1. Configure `LUNA_HUB_TOKEN` in Cloudflare.
2. Smoke-test event ingestion and idempotency.
3. Connect LUNA HOME to `GET /hub/current`.
4. Emit care / workout / morning health events from existing flows.
5. Add Calendar projection.
6. Add study events without changing existing LIFE QUEST reward processing.
7. Add rules that derive display state from raw domain state.
8. Add AI only for decisions that cannot be expressed as deterministic rules.

## Safety / migration rule

Do not remove or rewrite existing Morning, weather, or LIFE QUEST routes/cron while introducing Hub.
Migrate one producer/consumer at a time and keep the current production path operational until each replacement is verified.
