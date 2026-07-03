import { defaultActions } from "../../_lib/demo-data.js";
import { ensureActions, ensureUser, updateDailyCompletion } from "../../_lib/db.js";
import { badRequest, id, json, readJson, requiredDb, today } from "../../_lib/http.js";

export async function onRequestPost({ request, env }) {
  const db = requiredDb(env);
  const body = await readJson(request);
  const userId = body.user_id;

  if (!userId) return badRequest("缺少 user_id");
  if (!(await ensureUser(db, userId))) return badRequest("用户不存在");

  const actions = await ensureActions(db, userId);
  for (const action of actions) {
    await db
      .prepare("UPDATE actions SET status = 'done', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
      .bind(action.id)
      .run();
    await db
      .prepare("INSERT INTO checkins (id, user_id, action_id, date, note) VALUES (?, ?, ?, ?, ?)")
      .bind(id("chk"), userId, action.id, today(), "一键完成 Demo")
      .run();
  }

  await updateDailyCompletion(db, userId);
  const updated = await db
    .prepare("SELECT * FROM actions WHERE user_id = ? AND date = ? ORDER BY category")
    .bind(userId, today())
    .all();

  return json({
    dailyStatus: "completed",
    completed: defaultActions.length,
    actions: updated.results,
  });
}
