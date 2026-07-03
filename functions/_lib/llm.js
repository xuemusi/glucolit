import { analysisSamples } from "./demo-data.js";

const forbiddenTerms = ["治愈", "逆转", "保证降低血糖", "建议吃药", "停药", "不能吃", "必须吃"];

export async function analyzeWithModel({ env, type, photoName, imageData, mimeType }) {
  const apiKey = env.TOKENDANCE_API_KEY;
  if (!apiKey) {
    throw new Error("TOKENDANCE_API_KEY is not configured");
  }

  const baseUrl = env.TOKENDANCE_BASE_URL || "https://tokendance.space/gateway/v1";
  const model = env.TOKENDANCE_MODEL || "kimi-k2.6";
  const sample = analysisSamples[type];
  const messages = buildMessages(type, sample, photoName, imageData, mimeType);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 1400,
      messages,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `LLM request failed: ${response.status}`);
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty content");
  }

  const parsed = parseJsonObject(content);
  const normalized = normalizeAnalysis(type, parsed, sample);
  assertSafeCopy(normalized);

  return {
    ...normalized,
    model,
  };
}

function buildMessages(type, sample, photoName, imageData, mimeType) {
  const typeName = type === "report" ? "报告解读" : type === "meal" ? "餐盘分析" : "配料表分析";
  const userText = [
    `场景：${typeName}`,
    photoName ? `用户上传文件：${photoName}` : "用户使用演示样例。",
    "请基于输入生成 GLUCOLIT H5 的结构化分析结果。",
    "如果图片不可读取或信息不足，请根据演示样例生成可信兜底结果，并把 confidence 设为 medium 或 low。",
    `目标 JSON schema 示例：${JSON.stringify({
      title: sample.title,
      summary: sample.summary,
      risk_level: sample.risk_level,
      confidence: sample.confidence,
      result: sample.result,
    })}`,
  ].join("\n");

  if (imageData && mimeType) {
    return [
      {
        role: "system",
        content:
          "你是 GLUCOLIT 的糖尿病前期生活方式行动陪跑助手。只提供健康教育、行为支持和复查提醒，不诊断、不治疗、不承诺逆转、不推荐药物。必须只输出 JSON 对象，不要 Markdown。",
      },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${imageData}` },
          },
        ],
      },
    ];
  }

  return [
    {
      role: "system",
      content:
        "你是 GLUCOLIT 的糖尿病前期生活方式行动陪跑助手。只提供健康教育、行为支持和复查提醒，不诊断、不治疗、不承诺逆转、不推荐药物。必须只输出 JSON 对象，不要 Markdown。",
    },
    {
      role: "user",
      content: userText,
    },
  ];
}

function parseJsonObject(content) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1].trim() : trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("LLM content does not contain JSON object");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

function normalizeAnalysis(type, parsed, sample) {
  const title = cleanText(parsed.title) || sample.title;
  const summary = cleanText(parsed.summary) || sample.summary;
  const riskLevel = ["green", "yellow", "orange", "red"].includes(parsed.risk_level) ? parsed.risk_level : sample.risk_level;
  const confidence = ["low", "medium", "high"].includes(parsed.confidence) ? parsed.confidence : "medium";
  const result = parsed.result && typeof parsed.result === "object" ? parsed.result : { ...sample.result };

  if (type === "report" && !Array.isArray(result.fields)) result.fields = sample.result.fields;
  if (type === "meal" && !Array.isArray(result.observations)) result.observations = sample.result.observations;
  if (type === "meal" && !Array.isArray(result.swaps)) result.swaps = sample.result.swaps;
  if (type === "meal" && !["低", "中", "偏高"].includes(result.carbRisk)) result.carbRisk = sample.result.carbRisk;
  if (type === "label" && !Array.isArray(result.reasons)) result.reasons = sample.result.reasons;
  if (type === "label" && !Array.isArray(result.alternatives)) result.alternatives = sample.result.alternatives;
  if (type === "label" && !["更适合", "需控制", "建议替换"].includes(result.purchaseAdvice)) {
    result.purchaseAdvice = sample.result.purchaseAdvice;
  }

  result.medical_boundary =
    cleanText(result.medical_boundary) ||
    sample.result.medical_boundary ||
    "本结果用于健康教育与生活方式行为支持，不替代医生诊断和治疗。";
  result.ai_source = "tokendance";

  return { title, summary, risk_level: riskLevel, confidence, result };
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function assertSafeCopy(value) {
  const text = JSON.stringify(value);
  const hit = forbiddenTerms.find((term) => text.includes(term));
  if (hit) {
    throw new Error(`LLM output contains forbidden term: ${hit}`);
  }
}
