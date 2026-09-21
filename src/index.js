import { DurableObject } from "cloudflare:workers";

const LEGACY_RESULTS_URL = "https://3-qiawue.v2.appdeploy.ai/api/results";
const QUEST_OBJECT_NAME = "primary";

function json(data, init = {}) {
  return Response.json(data, init);
}

function questJson(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cache-Control", "no-store");
  return Response.json(data, { ...init, headers });
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateLegacyGame(game) {
  if (!isRecord(game)) throw new Error("Legacy payload has no game object");

  const numericKeys = [
    "totalXp",
    "lq",
    "gold",
    "bossHp",
    "bossMax",
    "totalVerified",
    "miningEnergy",
    "mineLevel",
    "workshopLevel",
  ];

  for (const key of numericKeys) {
    if (typeof game[key] !== "number" || !Number.isFinite(game[key])) {
      throw new Error(`Legacy game field ${key} is invalid`);
    }
  }

  if (!isRecord(game.materials)) throw new Error("Legacy game materials are invalid");
  if (!Array.isArray(game.discoveredItems)) throw new Error("Legacy discoveredItems are invalid");
  if (!Array.isArray(game.eventCards)) throw new Error("Legacy eventCards are invalid");
  if (typeof game.updatedAt !== "string") throw new Error("Legacy updatedAt is invalid");
}

async function sha256Json(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class QuestStateStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  async migrationStatus() {
    return (await this.ctx.storage.get("migration_meta")) ?? { status: "empty" };
  }

  async stageLegacy(snapshot, meta) {
    const existing = await this.ctx.storage.get("migration_snapshot");
    if (existing) {
      return (await this.ctx.storage.get("migration_meta")) ?? { status: "staged" };
    }

    const stagedMeta = {
      ...meta,
      status: "staged",
      immutable: true,
      active: false,
      stagedAt: new Date().toISOString(),
    };

    await this.ctx.storage.put("migration_snapshot", snapshot);
    await this.ctx.storage.put("migration_meta", stagedMeta);
    return stagedMeta;
  }

  async recordMigrationError(message) {
    const meta = {
      status: "error",
      active: false,
      attemptAt: new Date().toISOString(),
      lastError: String(message).slice(0, 500),
    };
    await this.ctx.storage.put("migration_meta", meta);
    return meta;
  }
}

function questStore(env) {
  return env.QUEST_STATE.getByName(QUEST_OBJECT_NAME);
}

async function pullLegacyIntoStage(env) {
  const store = questStore(env);
  const existing = await store.migrationStatus();
  if (existing?.status === "staged") return existing;

  try {
    const response = await fetch(LEGACY_RESULTS_URL, {
      headers: { Accept: "application/json" },
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`AppDeploy export returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    validateLegacyGame(payload?.game);

    const checksum = await sha256Json(payload);
    const game = payload.game;
    const meta = {
      source: LEGACY_RESULTS_URL,
      sourceAppId: "3-qiawue",
      fetchedAt: new Date().toISOString(),
      snapshotSha256: checksum,
      gameUpdatedAt: game.updatedAt,
      gameFieldCount: Object.keys(game).length,
      learningAttempted: Number(payload?.summary?.attempted ?? 0),
      learningResultsIncluded: Array.isArray(payload?.results) ? payload.results.length : 0,
      schema: "appdeploy-life-quest-v31",
    };

    return await store.stageLegacy(payload, meta);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown migration error";
    await store.recordMigrationError(message);
    throw error;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "LUNA CORE",
        time: new Date().toISOString(),
      });
    }

    if (url.pathname === "/quest") {
      return questJson({
        ok: true,
        service: "LUNA CORE",
        module: "LIFE QUEST",
        status: "migration-staging",
        message: "LIFE QUEST migration storage is online.",
        time: new Date().toISOString(),
      });
    }

    if (url.pathname === "/quest/migration/status") {
      const status = await questStore(env).migrationStatus();
      return questJson({
        ok: true,
        service: "LUNA CORE",
        module: "LIFE QUEST",
        migration: status,
        time: new Date().toISOString(),
      });
    }

    if (url.pathname === "/quest/state") {
      const status = await questStore(env).migrationStatus();
      return questJson({
        ok: true,
        service: "LUNA CORE",
        module: "LIFE QUEST",
        state: {
          active: false,
          status: status?.status === "staged" ? "staged" : "not-ready",
          source: status?.sourceAppId ?? null,
          snapshotSha256: status?.snapshotSha256 ?? null,
          gameUpdatedAt: status?.gameUpdatedAt ?? null,
        },
        time: new Date().toISOString(),
      });
    }

    if (request.method === "OPTIONS" && url.pathname.startsWith("/quest")) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    return new Response("LUNA CORE is running");
  },

  async scheduled(controller, env) {
    console.log(JSON.stringify({
      event: "LUNA_CORE_SCHEDULED",
      cron: controller.cron,
      scheduledTime: controller.scheduledTime,
    }));

    try {
      const migration = await pullLegacyIntoStage(env);
      console.log(JSON.stringify({
        event: "LQ_MIGRATION_STAGE",
        status: migration?.status ?? "unknown",
        snapshotSha256: migration?.snapshotSha256 ?? null,
      }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "LQ_MIGRATION_STAGE_ERROR",
        message: error instanceof Error ? error.message : "unknown",
      }));
    }
  },
};
