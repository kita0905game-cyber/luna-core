# LUNA HubState v2

## Purpose

HubState is LUNA CORE's compact current-state model. It is not a replacement for Airtable, Calendar, Gmail, AppDeploy records, Second Brain, or LIFE QUEST history.

The design separates:

- stored facts: durable current facts received through Luna Events
- derived current view: recalculated by LUNA Rules every time /hub/current is read
- HOME presentation contract: cards, alerts, and actions that LUNA HOME can render without reimplementing domain rules

## Canonical response shape

GET /hub/current returns:

- schemaVersion
- meta
- mode
- domains
- home
- capabilities

### meta

- revision: monotonically increasing event revision
- storedUpdatedAt: last durable HubState change
- generatedAt: time this current view was generated
- localDate: Asia/Tokyo local date used by Rules
- timeZone: Asia/Tokyo

### mode

Structured global life mode:

- current
- since
- source

Initial mode values may include unknown, morning, pre_commute, commute, work, after_work, home, night, holiday, and travel.

### domains

Each domain has a common envelope:

- status
- updatedAt
- source
- lastEventId
- lastEventType
- freshness

Domain-specific facts remain compact. Full history stays in the canonical domain source.

Initial domain list:

system, calendar, commute, weather, health, care, workout, study, diary, couple, lifequest, mail, presence, news.

### derived domain fields

Date- and rule-dependent values are placed under derived and are not written back to durable state.

Examples:

- health.morning.derived.completedToday
- health.morning.derived.showToday
- care.hairRemoval.derived.dueToday
- care.nails.derived.targetDate
- care.derived.pending
- workout.derived.todayPlan
- workout.derived.weekCount

This prevents yesterday's showToday decision from becoming stale durable data.

### home

home is generated on read and is not the canonical record.

- cards: HOME cards with id, domain, priority, visible, state, title, subtitle, actionId, reasonCode
- alerts: higher-importance time-sensitive notices
- actions: known safe action identifiers and whether they are currently enabled

LUNA HOME should eventually render this contract rather than reimplementing domain rules.

### capabilities

Reports whether each domain is supported, configured, and ready/planned/error. This allows HOME to hide or degrade gracefully when a source is not yet connected.

## Freshness

Each domain can expose:

- status: fresh, stale, expired, unavailable, or unknown
- updatedAt
- expiresAt

Facts such as workout or care history may have no expiry. Dynamic sources such as weather, commute, news, and calendar can provide expiresAt.

## Storage migration

The Durable Object instance name remains hub-v1 so existing data is not orphaned.

Durable storage migration is lazy and non-destructive:

1. read hub_current_v2 when present
2. otherwise read legacy hub_current_v1
3. normalize legacy state into v2
4. save the migrated copy to hub_current_v2
5. preserve hub_current_v1 for rollback

New events write only hub_current_v2.

## Event compatibility

Luna Event remains luna-event/v1.

Existing producers may keep sending payload.statePatch. The patch is applied only to the event's own domain.

This allows LUNA HOME producers to migrate independently from HubState consumers.

## Current HOME integration phase

health, care, and workout are the first v2-integrated domains.

LUNA HOME remains on its current display logic until HubState contains enough information to reproduce the existing HOME safely.

Planned cutover behavior:

1. fetch /hub/current on HOME open
2. refresh every 30-60 seconds while HOME remains open
3. refetch immediately after a HOME action changes state
4. keep WebSocket/push optional until a real need for second-level delivery exists
