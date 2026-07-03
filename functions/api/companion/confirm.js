import { ensureActions, ensureUser, updateDailyCompletion } from "../../_lib/db.js";
import { badRequest, json, readJson, requiredDb, today } from "../../_lib/http.js";

export async function onRequestPost({ request, env }) {
  const db = requiredDb(env);
  const body = await readJson(request);
  const userId = body.user_id;

  if (!userId) return badRequest("缺少 user_id");
  if (!(await ensureUser(db, userId))) return badRequest("用户不存在");

  await ensureActions(db, userId);
  await db
    .prepare(
      `UPDATE actions
      SET status = CASE WHEN status = 'done' THEN 'done' ELSE 'confirmed' END,
          source = 'companion',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE user_id = ? AND date = ? AND category = 'exercise'`,
    )
    .bind(userId, today())
    .run();

  const status = await updateDailyCompletion(db, userId);
  const actions = await ensureActions(db, userId);
  return json({ dailyStatus: status, actions });
}
