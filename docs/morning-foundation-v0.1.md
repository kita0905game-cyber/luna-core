# LUNA MORNING foundation v0.1

## Purpose

Move the scheduling and orchestration foundation for LUNA MORNING into LUNA CORE without replacing the current ChatGPT Scheduled Task yet.

## Safety rule

The existing production morning task remains the source of the real morning bulletin.

This foundation does **not** write to Airtable and does **not** replace the production bulletin generator.

## Flow

```text
Cloudflare Cron 05:05 JST
  -> LUNA CORE scheduled()
  -> Morning Runner
  -> run metadata stored in a dedicated Durable Object instance
  -> AI Gateway available for manual test facts
  -> no production publisher yet
```

A separate widget bridge can accept an already generated morning payload and expose the latest stored payload to Scriptable:

```text
current producer (temporary: existing ChatGPT/Airtable flow)
  -> POST /morning/ingest
  -> Durable Object morning_widget_payload_v1
  -> GET /morning/current
  -> Scriptable
  -> iPhone widget
```

`GET /morning/widget` remains available as a backward-compatible alias for `GET /morning/current`.

## Schedule

Cloudflare Cron runs in UTC. 05:05 JST is configured as:

```text
5 20 * * *
```

This is 20:05 UTC on the previous calendar day.

## Environment

- `MORNING_ENABLED=true`: allows the scheduled foundation run. Default is effectively disabled.
- `MORNING_ADMIN_TOKEN`: bearer token required for manual runs and reading the latest generated payload.
- `OPENAI_API_KEY`: secret used by the Responses API gateway.
- `OPENAI_MODEL`: optional model override. Default: `gpt-5.6-luna`.

Secrets must be stored outside the repository and never committed to GitHub.

## Routes

- `GET /morning`: safe public module/config status.
- `GET /morning/status`: safe public execution status.
- `POST /morning/run`: authenticated manual foundation or AI test run.
- `GET /morning/latest`: authenticated latest run details.
- `POST /morning/ingest`: authenticated bridge that stores an externally generated morning payload for the widget path.
- `GET /morning/current`: authenticated current payload endpoint intended for Scriptable.
- `GET /morning/widget`: backward-compatible alias for `GET /morning/current`.

## Not connected yet

- Google Calendar collector
- weather collector
- news collector
- bookkeeping/Airtable collector
- Second Brain context bridge
- Airtable morning publisher

The current ChatGPT Scheduled Task must remain enabled until the LUNA CORE generation path is proven equivalent and stable.
