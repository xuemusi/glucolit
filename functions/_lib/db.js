import { defaultActions, metrics, reasons } from "./demo-data.js";
import { id, parseJsonField, today } from "./http.js";

export async function ensureUser(db, userId) {
  const user = await db.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first();
  return user || null;
}

export async function ensureDailyState(db, userId) {
  const date = today();
  let state = await db.prepare("SELECT * FROM daily_states WHERE user_id = ? AND date = ?").bind(userId, date).first();
  if (!state) {
    state = {
      id: id("day"),
      user_id: userId,
      date,
      status: "attention",
      stress_state: "压力高",
      energy_state: "疲惫",
      metrics_json: JSON.stringify(metrics),
      reasons_json: JSON.stringify(reasons),
    };
    await db
      .prepare(
        `INSERT INTO daily_states
        (id, user_id, date, status, stress_state, energy_state, metrics_json, reasons_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        state.id,
        state.user_id,
        state.date,
        state.status,
        state.stress_state,
        state.energy_state,
        state.metrics_json,
        state.reasons_json,
      )
      .run();
  }
  return serializeDailyState(state);
}

export async function ensureActions(db, userId) {
  const date = today();
  const existing = await db
    .prepare("SELECT * FROM actions WHERE user_id = ? AND date = ? ORDER BY category")
    .bind(userId, date)
    .all();
  if (existing.results.length >= defaultActions.length) {
    return existing.results;
  }

  for (const action of defaultActions) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO actions
        (id, user_id, date, category, title, detail, status, source)
        VALUES (?, ?, ?, ?, ?, ?, 'todo', 'default')`,
      )
      .bind(id("act"), userId, date, action.category, action.title, action.detail)
      .run();
  }

  const seeded = await db
    .prepare("SELECT * FROM actions WHERE user_id = ? AND date = ? ORDER BY category")
    .bind(userId, date)
    .all();
  return seeded.results;
}

export async function recentAnalysis(db, userId) {
  const rows = await db
    .prepare("SELECT * FROM analysis_results WHERE user_id = ? ORDER BY created_at DESC LIMIT 5")
    .bind(userId)
    .all();
  return rows.results.map(serializeAnalysis);
}

export async function updateDailyCompletion(db, userId) {
  const actions = await ensureActions(db, userId);
  const doneCount = actions.filter((action) => action.status === "done").length;
  const status = doneCount >= defaultActions.length ? "completed" : doneCount > 0 ? "responded" : "attention";
  await db
    .prepare("UPDATE daily_states SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE user_id = ? AND date = ?")
    .bind(status, userId, today())
    .run();
  return status;
}

export function serializeDailyState(state) {
  return {
    id: state.id,
    user_id: state.user_id,
    date: state.date,
    status: state.status,
    stress_state: state.stress_state,
    energy_state: state.energy_state,
    metrics: parseJsonField(state.metrics_json, metrics),
    reasons: parseJsonField(state.reasons_json, reasons),
  };
}

export function serializeAnalysis(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    summary: row.summary,
    risk_level: row.risk_level,
    confidence: row.confidence,
    result: parseJsonField(row.result_json, {}),
    created_at: row.created_at,
  };
}
