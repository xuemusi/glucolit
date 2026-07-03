import { content } from "../_lib/demo-data.js";
import { ensureActions, ensureDailyState, ensureUser, recentAnalysis } from "../_lib/db.js";
import { badRequest, json, requiredDb } from "../_lib/http.js";

export async function onRequestGet({ request, env }) {
  const db = requiredDb(env);
  const url = new URL(request.url);
  const userId = url.searchParams.get("user_id");

  if (!userId) return badRequest("缺少 user_id");

  const user = await ensureUser(db, userId);
  if (!user) return badRequest("用户不存在");

  const dailyState = await ensureDailyState(db, userId);
  const actions = await ensureActions(db, userId);
  const analysis = await recentAnalysis(db, userId);

  return json({
    user: {
      id: user.id,
      phone: user.phone,
      display_name: user.display_name,
      profile: user.profile,
    },
    dailyState,
    actions,
    recentAnalysis: analysis,
    content,
  });
}
