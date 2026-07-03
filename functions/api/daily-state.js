import { ensureDailyState, ensureUser } from "../_lib/db.js";
import { badRequest, json, readJson, requiredDb, today } from "../_lib/http.js";

const stressOptions = new Set(["放松", "有点紧", "压力高"]);
const energyOptions = new Set(["有劲", "一般", "疲惫"]);

export async function onRequestPatch({ request, env }) {
  const db = requiredDb(env);
  const body = await readJson(request);
  const userId = body.user_id;

  if (!userId) return badRequest("缺少 user_id");
  if (!(await ensureUser(db, userId))) return badRequest("用户不存在");

  const stress = stressOptions.has(body.stress_state) ? body.stress_state : null;
  const energy = energyOptions.has(body.energy_state) ? body.energy_state : null;

  if (!stress && !energy) return badRequest("缺少可更新的压力或精力状态");

  await ensureDailyState(db, userId);
  const current = await db
    .prepare("SELECT stress_state, energy_state FROM daily_states WHERE user_id = ? AND date = ?")
    .bind(userId, today())
    .first();

  await db
    .prepare(
      `UPDATE daily_states
      SET stress_state = ?, energy_state = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE user_id = ? AND date = ?`,
    )
    .bind(stress || current.stress_state, energy || current.energy_state, userId, today())
    .run();

  const updated = await ensureDailyState(db, userId);
  return json({ dailyState: updated });
}
