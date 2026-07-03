import { ensureActions, ensureUser, updateDailyCompletion } from "../../_lib/db.js";
import { badRequest, json, readJson, requiredDb, today } from "../../_lib/http.js";

const statuses = new Set(["todo", "confirmed", "done"]);

export async function onRequestPatch({ request, env, params }) {
  const db = requiredDb(env);
  const body = await readJson(request);
  const userId = body.user_id;
  const status = body.status;
  const actionId = params.id;

  if (!userId) return badRequest("缺少 user_id");
  if (!statuses.has(status)) return badRequest("status 必须是 todo、confirmed 或 done");
  if (!(await ensureUser(db, userId))) return badRequest("用户不存在");

  await ensureActions(db, userId);
  const action = await db.prepare("SELECT * FROM actions WHERE id = ? AND user_id = ?").bind(actionId, userId).first();
  if (!action) return badRequest("行动不存在");

  await db
    .prepare("UPDATE actions SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ?")
    .bind(status, actionId, userId)
    .run();

  if (status === "done") {
    await db
      .prepare("INSERT INTO checkins (id, user_id, action_id, date, note) VALUES (?, ?, ?, ?, ?)")
      .bind(`chk_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`, userId, actionId, today(), "单项打卡")
      .run();
  }

  const dailyStatus = await updateDailyCompletion(db, userId);
  const updated = await db.prepare("SELECT * FROM actions WHERE id = ?").bind(actionId).first();
  return json({ action: updated, dailyStatus });
}
