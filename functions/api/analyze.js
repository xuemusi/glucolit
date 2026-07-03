import { analysisSamples } from "../_lib/demo-data.js";
import { ensureActions, ensureDailyState, ensureUser, serializeAnalysis } from "../_lib/db.js";
import { badRequest, id, json, readJson, requiredDb } from "../_lib/http.js";

export async function onRequestPost({ request, env }) {
  const db = requiredDb(env);
  const body = await readJson(request);
  const userId = body.user_id;
  const type = body.type;
  const sample = analysisSamples[type];

  if (!userId) return badRequest("缺少 user_id");
  if (!sample) return badRequest("type 必须是 report、meal 或 label");
  if (!(await ensureUser(db, userId))) return badRequest("用户不存在");

  await ensureDailyState(db, userId);
  await ensureActions(db, userId);

  const row = {
    id: id("ana"),
    user_id: userId,
    type,
    title: sample.title,
    summary: sample.summary,
    risk_level: sample.risk_level,
    result_json: JSON.stringify(sample.result),
    confidence: sample.confidence,
  };

  await db
    .prepare(
      `INSERT INTO analysis_results
      (id, user_id, type, title, summary, risk_level, result_json, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(row.id, row.user_id, row.type, row.title, row.summary, row.risk_level, row.result_json, row.confidence)
    .run();

  const inserted = await db.prepare("SELECT * FROM analysis_results WHERE id = ?").bind(row.id).first();
  return json({ analysis: serializeAnalysis(inserted), fallback: true });
}
