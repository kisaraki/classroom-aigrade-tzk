import { addCalendarMonths, taipeiBusinessDate } from "../../domain/dates.ts";
import { AuthorizationService } from "../auth/authorization.ts";
import { SESSION_IDLE_TIMEOUT_MS } from "../auth/policy.ts";
import type { AuthSession } from "../auth/types.ts";
import {
  providerConfiguration,
  type ProviderConfiguration,
} from "./provider.ts";

export class AISettingsError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export type AISettings = {
  version: number;
  configuration: ProviderConfiguration | null;
};
type Row = Record<string, string | number | null>;
/** Internal read for authorized jobs; no secrets are stored or returned. */
export async function readAISettings(db: D1Database): Promise<AISettings> {
  const rows = (
    await db
      .prepare(
        "SELECT key,value_json,version FROM system_settings WHERE key IN ('ai_provider','ai_model')",
      )
      .all<Row>()
  ).results;
  if (!rows.length) return { version: 0, configuration: null };
  const provider = rows.find((r) => r.key === "ai_provider"),
    model = rows.find((r) => r.key === "ai_model");
  if (!provider || !model || provider.version !== model.version)
    throw new AISettingsError("AI_SETTINGS_INCONSISTENT");
  try {
    return {
      version: Number(provider.version),
      configuration: providerConfiguration({
        provider: JSON.parse(String(provider.value_json)),
        model: JSON.parse(String(model.value_json)),
      }),
    };
  } catch {
    throw new AISettingsError("AI_SETTINGS_INCONSISTENT");
  }
}
export class AISettingsService {
  private readonly db: D1Database;
  private readonly now: () => number;
  private readonly authz: AuthorizationService;
  constructor(deps: { db: D1Database; now?: () => number }) {
    this.db = deps.db;
    this.now = deps.now ?? Date.now;
    this.authz = new AuthorizationService(deps);
  }
  private async access(session: AuthSession) {
    const date = taipeiBusinessDate(this.now());
    const terms = (
      await this.db
        .prepare(
          "SELECT t.id,s.revision FROM academic_terms t JOIN academic_state s ON s.current_year_id=t.academic_year_id WHERE s.id=1 AND t.starts_on<=? AND t.ends_on>?",
        )
        .bind(date, date)
        .all<Row>()
    ).results;
    if (terms.length !== 1)
      throw new AISettingsError("AI_CURRENT_TERM_REQUIRED");
    await this.authz.assertPermission(session, "ai.manage", {
      academicTermId: String(terms[0].id),
      onDate: date,
    });
    return {
      term: String(terms[0].id),
      revision: Number(terms[0].revision),
      date,
    };
  }
  async read(session: AuthSession) {
    await this.access(session);
    return readAISettings(this.db);
  }
  async update(
    session: AuthSession,
    input: {
      configuration: ProviderConfiguration;
      expectedVersion: number;
      confirmed: boolean;
    },
  ) {
    const scope = await this.access(session);
    if (
      !input ||
      Object.keys(input).some(
        (k) => !["configuration", "expectedVersion", "confirmed"].includes(k),
      ) ||
      input.confirmed !== true ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 0 ||
      input.expectedVersion >= Number.MAX_SAFE_INTEGER
    )
      throw new AISettingsError("AI_SETTINGS_INPUT_INVALID", 400);
    const configuration = providerConfiguration(input.configuration);
    const current = await readAISettings(this.db);
    if (current.version !== input.expectedVersion)
      throw new AISettingsError("AI_SETTINGS_CONFLICT");
    const now = this.now(),
      version = current.version + 1;
    // Scope, account, session, academic revision, and both settings versions are rechecked inside the atomic batch.
    const guard = this.db
      .prepare(
        `INSERT INTO audit_logs (id,actor_id,action,entity_type,entity_id,operation_id,outcome,metadata_json,created_at,retention_until)
      SELECT ?,?,CASE WHEN (SELECT revision FROM academic_state WHERE id=1)=?
      AND NOT EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE')
      AND EXISTS(SELECT 1 FROM admin_users a JOIN admin_sessions s ON s.admin_user_id=a.id
        WHERE a.id=? AND s.id=? AND a.status='active' AND a.google_subject_id IS NOT NULL
        AND a.auth_version=s.auth_version AND s.revoked_at IS NULL AND s.expires_at>? AND s.last_seen_at>? AND s.last_seen_at<=?
        AND (a.role='super_admin' OR (a.role='ai_admin' AND EXISTS(SELECT 1 FROM admin_assignments x WHERE x.admin_user_id=a.id AND x.academic_term_id=? AND x.scope_type='school' AND x.starts_on<=? AND (x.ends_on IS NULL OR x.ends_on>?)))))
      AND ((?=0 AND NOT EXISTS(SELECT 1 FROM system_settings WHERE key IN ('ai_provider','ai_model')))
        OR (? > 0 AND (SELECT COUNT(*) FROM system_settings WHERE key IN ('ai_provider','ai_model') AND version=?)=2))
      THEN 'AI_PROVIDER_UPDATE' ELSE NULL END,'system_settings','ai_provider',?,'success',?, ?, ?`,
      )
      .bind(
        crypto.randomUUID(),
        session.adminId,
        scope.revision,
        session.adminId,
        session.sessionId,
        now,
        now - SESSION_IDLE_TIMEOUT_MS,
        now,
        scope.term,
        scope.date,
        scope.date,
        current.version,
        current.version,
        current.version,
        crypto.randomUUID(),
        JSON.stringify({
          previousVersion: current.version,
          version,
          provider: configuration.provider,
        }),
        now,
        addCalendarMonths(taipeiBusinessDate(now), 2),
      );
    const setting = (key: string, value: string) =>
      this.db
        .prepare(
          `INSERT INTO system_settings (key,value_json,version,updated_by,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,version=excluded.version,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
        )
        .bind(key, JSON.stringify(value), version, session.adminId, now);
    try {
      await this.db.batch([
        guard,
        setting("ai_provider", configuration.provider),
        setting("ai_model", configuration.model),
      ]);
    } catch {
      throw new AISettingsError("AI_SETTINGS_CONFLICT");
    }
    return { version, configuration };
  }
}
