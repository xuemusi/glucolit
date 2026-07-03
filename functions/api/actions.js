import { ensureActions, ensureUser } from "../_lib/db.js";
import { badRequest, json, requiredDb } from "../_lib/http.js";

export async function onRequestGet({ request, env }) {
  const db = requiredDb(env);
  const url = new URL(request.url);
  const userId = url.searchParams.get("user_id");

  if (!userId) return badRequest("缺少 user_id");
  if (!(await ensureUser(db, userId))) return badRequest("用户不存在");

  const actions = await ensureActions(db, userId);
  return json({ actions });
}
