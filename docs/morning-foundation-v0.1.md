# LUNA MORNING foundation v0.1

## Purpose

Move the scheduling and orchestration foundation for LUNA MORNING into LUNA CORE without replacing the current ChatGPT Scheduled Task yet.

## Safety rule

The existing production morning task remains the source of the real morning bulletin.

This foundation does **not** write to Airtable and does **not** publish a bulletin.

## Flow

```
Cloudflare Cron 05:05 JST
  -> LUNA CORE scheduled()
  -> Morning Runner
  -> run metadata stored in a dedicated Durable Object instance
  -> AI Gateway available for manual test facts
  -> no publisher yet
```

## Schedule

Cloudflare Cron runs in UTC. 05:05 JST is configured as:

```
5 20 * * *
```

This is 20:05 UTC on the previous calendar day.

## Environment

- `MORNING_ENABLED=true`: allows the scheduled foundation run. Default is effectively disabled.
- `MORNING_ADMIN_TOKEN`: bearer token required for manual runs and reading the latest generated payload.
- `OPENAI_API_KEY`: secret used by the Responses API gateway.
- `OPENAI_MODEL`: optional model override. Default: `gpt-5.6-luna`.

Secrets must be stored in Cloudflare, never committed to GitHub.

## Routes

- `GET /morning`: safe public module/config status.
- `GET /morning/status`: safe public execution status.
- `POST /morning/run`: authenticated manual foundation or AI test run.
- `GET /morning/latest`: authenticated latest run details.

## Not connected yet

- Google Calendar collector
- weather collector
- news collector
- bookkeeping/Airtable collector
- Second Brain context bridge
- Airtable morning publisher

These will be added and compared against the current Scheduled Task before cutover.
