# LUNA API Operations Runbook v1

Status: ACTIVE
Created: 2026-10-02
Audience: future ChatGPT Luna / API Luna implementers / LUNA CORE maintainers
Purpose: safely decide when API Luna may run, how every OpenAI call must be guarded, and how to avoid repeating mistakes discovered during the 2026-10-02 rollout.

## 1. Authority and scope

This document is the implementation-side runbook for API Luna in `luna-core`.

It does not replace:
- active LUNA Constitution for behavior and values;
- Cloudflare D1 `luna-knowledge` for canonical knowledge;
- feature-specific deterministic rules owned by LUNA CORE.

When this document conflicts with live code or current official OpenAI documentation:
1. verify live code and official docs;
2. do not guess;
3. update this runbook after the verified change.

Never use memory, an old chat, or an old model name as the sole source for current OpenAI model availability, API pricing, limits, or permissions.

## 2. Current architecture

Provider path:

```text
LUNA HOME / LIFE QUEST / CORE feature
  -> LUNA CORE
  -> feature gate / trigger policy
  -> shared AI budget guard
  -> src/luna-ai.js
  -> OpenAI Responses API
```

Rules:
- clients must not call OpenAI directly;
- `src/luna-ai.js` is the provider boundary;
- deterministic state remains authoritative in CORE;
- API Luna proposes/reasons but must not become the canonical authority for money, XP, inventory, probability, persistence, or anti-cheat decisions;
- failure or exhaustion of API Luna must not stop D1, HubState, knowledge sync, or deterministic gameplay.

## 3. Current production controls

As of 2026-10-02:

- model pinned in CORE: `gpt-6-luna`
- OpenAI endpoint: `POST /v1/responses`
- OpenAI key permission: Restricted; Responses write only
- Cloudflare secret name: `OPENAI_API_KEY`
- OpenAI project monthly hard spend limit: USD 2.00
- CORE internal monthly hard stop: USD 1.80
- internal budget accounting timezone: UTC
- OpenAI automatic recharge: OFF
- prepaid credit was initialized separately; do not treat prepaid balance as the monthly control
- feature requests use `store:false`
- feature requests use `service_tier:'default'`
- current guarded model allowlist: GPT-6 Luna only

External OpenAI account controls can change outside this repo. Before changing model, pricing, or spend behavior, re-check the current account and official OpenAI documentation.

## 4. Current activation matrix

### LUNA MORNING

Scheduled Morning currently calls:

`runMorning(..., useAI:false)`

Therefore the scheduled Cron does not spend API budget.

API Luna is used only when an authorized manual Morning run explicitly supplies:
- `useAI:true`
- valid `facts`

Do not silently change scheduled Morning to `useAI:true`.

### Memory Review

Memory Review code is budget guarded, but scheduled execution is disabled unless:

`LUNA_MEMORY_REVIEW_ENABLED === 'true'`

Even when enabled, provider use requires:
- D1 configured;
- API key configured;
- AI budget binding configured;
- active Constitution available;
- one or more observing memory candidates.

Zero candidates means zero provider calls.

API Luna output must never directly promote inferred data into formal Second Brain memory without the normal provenance/confirmation policy.

### LIFE QUEST World GM

The World GM foundation exists but is deliberately inert.

Current controls:
- `LQ_AI_ENABLED=false`
- trigger policy returns `trigger_policy_unimplemented`
- `providerCallsPossible=false`

Important: even if someone changes `LQ_AI_ENABLED=true`, the current trigger evaluator still rejects every request. A future code change must explicitly implement trigger rules before provider calls can occur.

This double lock is intentional. Do not remove it merely to make the feature "work".

### Diary summaries

Diary summaries are not an API Luna workload.

Current route:

```text
LUNA HOME Diary Entries
  -> Airtable
  -> ChatGPT Scheduled Task
  -> Diary Summaries
```

Do not move diary summarization into the API Luna budget without an explicit architecture decision.

## 5. Shared budget-guard lifecycle

Every new API Luna feature must use the shared guard. Required lifecycle:

1. build a bounded request;
2. estimate worst-case cost;
3. reserve monthly budget atomically;
4. only if reservation succeeds, call OpenAI;
5. if usage is returned, reconcile to actual cost;
6. if a known non-billed provider failure returns without usage, cancel the reservation;
7. if transport outcome is ambiguous, keep the reservation;
8. if a successful response has no usage, keep the reservation;
9. never let an uncertain request free budget that may already have been billed.

Reason: a network timeout can happen after OpenAI accepted the request. Releasing that reservation could allow cumulative overspend.

Current reservations intentionally do not auto-expire. A stuck reservation is safer than silently overspending. Any future recovery mechanism must preserve auditability and must not assume "timeout = not billed".

## 6. Request constraints

The pricing/guard layer is intentionally fail-closed.

Do not bypass its validation to make a request succeed.

Current constraints include:
- approved model only;
- text-only request;
- no unapproved tools;
- no unapproved multimodal inputs;
- no `previous_response_id`;
- `store:false`;
- standard/default service tier;
- explicit bounded `max_output_tokens`;
- request-size cap;
- conservative input overhead;
- conservative cache-write accounting when usage detail is incomplete.

Feature-level requests currently use a 1024 max output token cap.

If a new feature needs a different capability, update pricing logic, tests, budget logic, and this runbook first.

## 7. Adding a new API Luna feature

Future Luna must follow this order:

1. Define why AI is needed. Prefer deterministic Rules, normal code, or ChatGPT Scheduled Tasks when sufficient.
2. Define an explicit feature gate.
3. Define an explicit trigger policy. "Feature enabled" is not itself a trigger.
4. Define bounded structured input and structured output.
5. Keep authoritative state mutation outside the model.
6. Route provider access through `src/luna-ai.js`.
7. Route cost through `createAiCostGuard`.
8. Add tests proving:
   - disabled gate => zero provider calls;
   - unmet trigger => zero provider calls;
   - budget rejection => zero provider calls;
   - success => usage reconciliation;
   - HTTP error without usage => reservation cancel;
   - ambiguous transport => reservation held;
   - success without usage => reservation held.
9. Run CI.
10. Merge to main.
11. Verify production deployment separately.
12. Perform a tiny live smoke only after model/pricing/permissions are freshly verified.
13. Remove temporary smoke machinery after success.

Do not perform the live smoke before the budget guard is active.

## 8. Verification before any paid live call

Before any paid live test, verify all of the following:

- current official OpenAI model name;
- current official pricing for that model and tier;
- project access to the model;
- key permissions needed by the endpoint;
- OpenAI project hard limit still configured;
- auto recharge remains in the intended state;
- CORE internal limit and timezone;
- request body satisfies the pricing estimator;
- provider call is guarded;
- test input contains no unnecessary sensitive data.

Then make the smallest useful test.

## 9. Mistakes and false assumptions discovered during rollout

These are operational lessons, not historical trivia. Future Luna must actively avoid repeating them.

### 9.1 Do not infer why a UI control is disabled

During key creation, an early guess blamed the key name/spacing for a disabled control. That was not verified.

Rule:
- inspect the actual screen and current official instructions;
- do not invent a cause for a disabled button.

### 9.2 Do not assume a Cloudflare secret is a specific OpenAI key by name

Seeing a Cloudflare binding named `OPENAI_API_KEY` proves a secret exists, not which exact OpenAI key value is stored.

Similarly, seeing an OpenAI key named "LUNA CORE Production" does not prove it is the secret currently in Cloudflare.

Rule:
- state only what is verified;
- never ask the user to paste or screenshot a secret value;
- rotate directly into Cloudflare if a credential must be replaced.

### 9.3 Do not use remembered model/pricing data

The implementation initially still referenced an older GPT-5.6 Luna assumption. A fresh official check before the first paid request found the current GPT-6 Luna model and pricing.

Rule:
- before paid tests, model migrations, or pricing-table edits, use current official OpenAI sources;
- treat repo price constants as reviewed snapshots, not eternal facts.

### 9.4 Do not cancel budget on ambiguous network failure

A transport error does not prove OpenAI did not process and bill the request.

Rule:
- ambiguous transport => hold reservation;
- cancel only when zero billing is reasonably established.

### 9.5 Do not mix Diary Scheduled Tasks with API Luna

Diary summarization was momentarily discussed as though it might consume API Luna budget. Inspection showed it belongs to the ChatGPT Scheduled Task path.

Rule:
- inspect the actual owning subsystem before classifying a workload as API Luna.

### 9.6 Do not equate GitHub main with production deployment

A commit merged to main confirms repository state only. Cloudflare production deployment is a separate fact.

Rule:
- say "main updated" when that is all that is verified;
- say "production verified" only after checking the deployed Worker or deployment status.

### 9.7 Do not make LQ AI active merely because the foundation exists

LIFE QUEST now has an adapter and endpoints, but trigger policy is intentionally unimplemented.

Rule:
- foundation != activation;
- trigger rules must be a deliberate later design decision.

## 10. Source locations

Core provider and budget:
- `src/luna-ai.js`
- `src/ai-pricing.js`
- `src/ai-budget-model.js`
- `src/ai-budget-store.js`
- `src/ai-budget-guard.js`

Feature integration:
- `src/morning-runner.js`
- `src/memory-review.js`
- `src/quest-ai.js`
- `src/quest-routes.js`

Configuration:
- `wrangler.jsonc`

Important tests:
- `test/ai-budget.test.mjs`
- `test/ai-pricing.test.mjs`
- `test/ai-budget-guard.test.mjs`
- `test/luna-ai-budget.test.mjs`
- `test/memory-review-budget.test.mjs`
- `test/quest-ai.test.mjs`

## 11. Self-judgment checklist for future Luna

When asked "should API Luna run here?", answer internally in this order:

1. Is this feature currently assigned to API Luna?
2. Is a deterministic/non-API path already the owner?
3. Is the feature explicitly enabled?
4. Is a concrete trigger rule implemented and satisfied?
5. Is provider use necessary for this specific event?
6. Is the request bounded and supported by the current pricing guard?
7. Is budget available?
8. Will non-AI behavior remain valid if the call fails?

If any required answer is no or unknown, fail closed and do not call the provider.

When uncertain, inspect live implementation and current Knowledge before changing behavior.

## 12. Change discipline

Any future change to:
- model;
- pricing;
- API endpoint;
- key permission;
- spend limit;
- budget timezone;
- activation condition;
- trigger policy;
- output token cap;
- provider error handling;

must update:
1. code;
2. tests;
3. this runbook;
4. the canonical Knowledge-side API Luna runbook if the operational decision changed.

This is required so later Luna instances do not reconstruct policy from scattered chats.
