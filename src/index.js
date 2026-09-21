import { DurableObject } from "cloudflare:workers";

const QUEST_OBJECT_NAME = "primary";
const MIGRATION_VERSION = 3;
const MIGRATION_TOKEN_SHA256 = "f68b243c55704de21b3187a174d9c657fb50b80143f37963a1a15cd282d0e5d3";
const STATE_READ_TOKEN_SHA256 = "6d2f1d6cccbf0fd45d3f48c57b2e1b540287245340ff7fdc9dece08851da07c7";

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
    "totalXp", "lq", "gold", "chests", "knowledge", "bossHp", "bossMax",
    "totalVerified", "dailyVerified", "miningEnergy", "mineLevel", "workshopLevel",
    "minedTotal", "craftedTotal", "chestsOpened", "bait", "explorationTickets",
    "fishingTotal", "explorationTotal", "studyStreakDays", "bestStudyStreakDays",
    "bossLevel", "bossRewards", "railwayTrainCount", "historicalLqAwarded"
  ];

  for (const key of numericKeys) {
    if (typeof game[key] !== "number" || !Number.isFinite(game[key])) {
      throw new Error(`Legacy game field ${key} is invalid`);
    }
  }

  const recordKeys = ["materials", "fish", "weaknessBonusDays", "regionalWarehouses"];
  for (const key of recordKeys) {
    if (!isRecord(game[key])) throw new Error(`Legacy game field ${key} is invalid`);
  }

  const arrayKeys = ["discoveredItems", "discoveredFish", "eventCards", "hallOfFame", "automations", "wagonTransfers"];
  for (const key of arrayKeys) {
    if (!Array.isArray(game[key])) throw new Error(`Legacy game field ${key} is invalid`);
  }

  if (typeof game.updatedAt !== "string") throw new Error("Legacy updatedAt is invalid");
}

async function sha256Text(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Json(value) {
  return sha256Text(JSON.stringify(value));
}

export class QuestStateStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  async migrationStatus() {
    return (await this.ctx.storage.get("migration_game_meta_v3")) ?? { status: "empty", version: MIGRATION_VERSION };
  }

  async activateMigratedGame(game, meta) {
    const existing = await this.ctx.storage.get("migration_game_meta_v3");
    if (existing?.status === "active") return existing;

    const activeMeta = {
      ...meta,
      version: MIGRATION_VERSION,
      scope: "game-only",
      status: "active",
      immutableSourceSnapshot: true,
      activatedAt: new Date().toISOString(),
    };

    await this.ctx.storage.put("migration_game_snapshot_v3", game);
    await this.ctx.storage.put("active_game_v1", game);
    await this.ctx.storage.put("migration_game_meta_v3", activeMeta);
    return activeMeta;
  }

  async recordMigrationError(message) {
    const meta = {
      status: "error",
      version: MIGRATION_VERSION,
      scope: "game-only",
      attemptAt: new Date().toISOString(),
      lastError: String(message).slice(0, 500),
    };
    await this.ctx.storage.put("migration_game_meta_v3", meta);
    return meta;
  }

  async activeStateMeta() {
    const game = await this.ctx.storage.get("active_game_v1");
    const migration = await this.migrationStatus();
    return {
      active: Boolean(game),
      status: game ? "active" : "not-ready",
      source: migration?.sourceAppId ?? null,
      snapshotSha256: migration?.snapshotSha256 ?? null,
      gameUpdatedAt: migration?.gameUpdatedAt ?? null,
      migratedFieldCount: migration?.gameFieldCount ?? null,
      migrationVersion: migration?.version ?? MIGRATION_VERSION,
    };
  }

  async activeGame() {
    return (await this.ctx.storage.get("active_game_v1")) ?? null;
  }
}

function questStore(env) {
  return env.QUEST_STATE.getByName(QUEST_OBJECT_NAME);
}

async function verifyMigrationToken(request) {
  const token = request.headers.get("X-Luna-Migration-Token") ?? "";
  if (!token) return false;
  return (await sha256Text(token)) === MIGRATION_TOKEN_SHA256;
}

async function verifyStateReadToken(request) {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return false;
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) return false;
  return (await sha256Text(token)) === STATE_READ_TOKEN_SHA256;
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

    if (request.method === "OPTIONS" && url.pathname.startsWith("/quest")) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Luna-Migration-Token",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (url.pathname === "/quest") {
      const state = await questStore(env).activeStateMeta();
      return questJson({
        ok: true,
        service: "LUNA CORE",
        module: "LIFE QUEST",
        status: state.active ? "state-migrated" : "migration-pending",
        message: state.active
          ? "LIFE QUEST game state has been migrated to LUNA CORE."
          : "LIFE QUEST game-state migration is pending.",
        time: new Date().toISOString(),
      });
    }

    if (url.pathname === "/quest/migration/status") {
      const status = await questStore(env).migrationStatus();
      return questJson({
        ok: status?.status === "active",
        service: "LUNA CORE",
        module: "LIFE QUEST",
        migration: status,
        time: new Date().toISOString(),
      });
    }

    if (url.pathname === "/quest/migration/import" && request.method === "POST") {
      const store = questStore(env);
      const current = await store.migrationStatus();
      if (current?.status === "active") {
        return questJson({
          ok: true,
          service: "LUNA CORE",
          module: "LIFE QUEST",
          migration: current,
          message: "Migration already completed.",
          time: new Date().toISOString(),
        });
      }

      if (!(await verifyMigrationToken(request))) {
        return questJson({ ok: false, error: "invalid_migration_token" }, { status: 403 });
      }

      try {
        const payload = await request.json();
        if (payload?.sourceAppId !== "3-qiawue") {
          throw new Error("Unexpected migration source");
        }

        const game = payload?.game;
        validateLegacyGame(game);
        const checksum = await sha256Json(game);

        const meta = {
          source: "appdeploy-client-push",
          sourceAppId: "3-qiawue",
          fetchedAt: new Date().toISOString(),
          snapshotSha256: checksum,
          gameUpdatedAt: game.updatedAt,
          gameFieldCount: Object.keys(game).length,
          schema: "appdeploy-life-quest-v31",
          bookkeepingMigrated: false,
        };

        const migration = await store.activateMigratedGame(game, meta);
        return questJson({
          ok: true,
          service: "LUNA CORE",
          module: "LIFE QUEST",
          migration,
          time: new Date().toISOString(),
        }, { status: 201 });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown migration error";
        const migration = await store.recordMigrationError(message);
        return questJson({
          ok: false,
          service: "LUNA CORE",
          module: "LIFE QUEST",
          migration,
          time: new Date().toISOString(),
        }, { status: 400 });
      }
    }

    if (url.pathname === "/quest/state") {
      const state = await questStore(env).activeStateMeta();
      return questJson({
        ok: state.active,
        service: "LUNA CORE",
        module: "LIFE QUEST",
        state,
        time: new Date().toISOString(),
      }, { status: state.active ? 200 : 503 });
    }

    if (url.pathname === "/quest/state/full" && request.method === "GET") {
      if (!(await verifyStateReadToken(request))) {
        return questJson({ ok: false, error: "unauthorized" }, { status: 401 });
      }

      const game = await questStore(env).activeGame();
      if (!game) {
        return questJson({ ok: false, error: "state_not_ready" }, { status: 503 });
      }

      return questJson({
        ok: true,
        service: "LUNA CORE",
        module: "LIFE QUEST",
        game,
        readOnly: true,
        time: new Date().toISOString(),
      });
    }

    return new Response("LUNA CORE is running");
  },

  scheduled(controller) {
    console.log(JSON.stringify({
      event: "LUNA_CORE_SCHEDULED",
      cron: controller.cron,
      scheduledTime: controller.scheduledTime,
    }));
  },
};
