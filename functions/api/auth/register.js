import { ensureActions, ensureDailyState } from "../../_lib/db.js";
import { badRequest, id, json, readJson, requiredDb } from "../../_lib/http.js";

export async function onRequestPost({ request, env }) {
  const db = requiredDb(env);
  const body = await readJson(request);
  const phone = String(body.phone || "").replace(/[^\d+]/g, "");

  if (!/^\+?\d{6,20}$/.test(phone)) {
    return badRequest("请输入有效手机号");
  }

  let user = await db.prepare("SELECT * FROM users WHERE phone = ?").bind(phone).first();
  if (!user) {
    user = {
      id: id("usr"),
      phone,
      display_name: "GLUCOLIT 用户",
      profile: "糖前期风险关注用户",
    };
    await db
      .prepare("INSERT INTO users (id, phone, display_name, profile) VALUES (?, ?, ?, ?)")
      .bind(user.id, user.phone, user.display_name, user.profile)
      .run();
  }

  const token = id("sess");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  await db
    .prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(token, user.id, expiresAt)
    .run();

  await ensureDailyState(db, user.id);
  await ensureActions(db, user.id);

  return json({
    user: {
      id: user.id,
      phone: user.phone,
      display_name: user.display_name,
      profile: user.profile,
    },
    session_token: token,
  });
}
