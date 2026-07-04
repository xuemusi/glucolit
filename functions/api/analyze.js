import { analysisSamples } from "../_lib/demo-data.js";
import { ensureActions, ensureDailyState, ensureUser, serializeAnalysis } from "../_lib/db.js";
import { badRequest, id, json, readJson, requiredDb } from "../_lib/http.js";
import { analyzeWithModel, analyzeWithModelStream, envFlag } from "../_lib/llm.js";

export async function onRequestPost({ request, env }) {
  const db = requiredDb(env);
  const body = await readJson(request);
  const userId = body.user_id;
  const type = body.type;
  const photoName = typeof body.photo_name === "string" ? body.photo_name.slice(0, 120) : "";
  const imageData = typeof body.image_data === "string" ? body.image_data : "";
  const mimeType = typeof body.mime_type === "string" ? body.mime_type : "";
  const sample = analysisSamples[type];

  if (!userId) return badRequest("缺少 user_id");
  if (!sample) return badRequest("type 必须是 report、meal 或 label");
  if (!(await ensureUser(db, userId))) return badRequest("用户不存在");

  await ensureDailyState(db, userId);
  await ensureActions(db, userId);

  if (envFlag(env.TOKENDANCE_STREAM_ENABLED, false)) {
    return streamAnalysis({ db, env, userId, type, photoName, imageData, mimeType, sample });
  }

  let fallback = false;
  let model = null;
  let modelError = null;
  let analysis;

  try {
    analysis = await analyzeWithModel({ env, type, photoName, imageData, mimeType });
    model = analysis.model;
  } catch (error) {
    fallback = true;
    modelError = error.message;
    analysis = fallbackAnalysis(sample);
  }

  const inserted = await insertAnalysis(db, userId, type, analysis);
  return json({
    analysis: inserted,
    fallback,
    model,
    model_error: modelError,
  });
}

function streamAnalysis({ db, env, userId, type, photoName, imageData, mimeType, sample }) {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const writeEvent = (event, data) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    return writer.write(encoder.encode(payload));
  };

  queueMicrotask(async () => {
    let fallback = false;
    let model = null;
    let modelError = null;
    let analysis;

    try {
      await writeEvent("meta", {
        model: env.TOKENDANCE_MODEL || "kimi-k2.6",
        fallback: false,
        thinking: envFlag(env.TOKENDANCE_THINKING_ENABLED, false) ? "enabled" : "disabled",
      });
      analysis = await analyzeWithModelStream({
        env,
        type,
        photoName,
        imageData,
        mimeType,
        onContent: (content) => writeEvent("token", { content }),
      });
      model = analysis.model;
    } catch (error) {
      fallback = true;
      modelError = error.message;
      analysis = fallbackAnalysis(sample);
      await writeEvent("fallback", {
        message: "模型识别失败，已切换为演示兜底结果。",
        error: modelError,
      });
      await streamFallbackText(analysis, writeEvent);
    }

    const inserted = await insertAnalysis(db, userId, type, analysis);
    await writeEvent("done", {
      analysis: inserted,
      fallback,
      model,
      model_error: modelError,
    });
    await writer.close();
  });

  return new Response(stream.readable, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
}

async function streamFallbackText(analysis, writeEvent) {
  const text = `${analysis.title}\n${analysis.summary}`;
  for (const chunk of text.match(/.{1,8}/gs) || []) {
    await writeEvent("token", { content: chunk });
  }
}

function fallbackAnalysis(sample) {
  return {
    title: sample.title,
    summary: sample.summary,
    risk_level: sample.risk_level,
    result: { ...sample.result, ai_source: "fallback" },
    confidence: sample.confidence,
  };
}

async function insertAnalysis(db, userId, type, analysis) {
  const row = {
    id: id("ana"),
    user_id: userId,
    type,
    title: analysis.title,
    summary: analysis.summary,
    risk_level: analysis.risk_level,
    result_json: JSON.stringify(analysis.result),
    confidence: analysis.confidence,
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
  return serializeAnalysis(inserted);
}
