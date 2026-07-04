import { ensureActions, ensureUser } from "../../_lib/db.js";
import { badRequest, json, readJson, requiredDb, today } from "../../_lib/http.js";

const reportExerciseDetail = "饭后约 30 分钟开始散步，体力不足时先走 15-20 分钟。";

export async function onRequestPost({ request, env }) {
  const db = requiredDb(env);
  const body = await readJson(request);
  const userId = body.user_id;
  const analysisId = body.analysis_id;

  if (!userId) return badRequest("缺少 user_id");
  if (!analysisId) return badRequest("缺少 analysis_id");
  if (!(await ensureUser(db, userId))) return badRequest("用户不存在");

  const analysis = await db
    .prepare("SELECT id FROM analysis_results WHERE id = ? AND user_id = ? AND type = 'report'")
    .bind(analysisId, userId)
    .first();
  if (!analysis) return badRequest("报告分析不存在");

  await ensureActions(db, userId);
  await db
    .prepare(
      `UPDATE actions
      SET status = CASE WHEN status = 'done' THEN 'done' ELSE 'confirmed' END,
          source = 'analysis',
          detail = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE user_id = ? AND date = ? AND category = 'exercise'`,
    )
    .bind(reportExerciseDetail, userId, today())
    .run();

  const actions = await db
    .prepare("SELECT * FROM actions WHERE user_id = ? AND date = ? ORDER BY category")
    .bind(userId, today())
    .all();

  return json({ actions: actions.results });
}
