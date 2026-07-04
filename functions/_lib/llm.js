import { analysisSamples } from "./demo-data.js";

const forbiddenTerms = ["治愈", "逆转", "保证降低血糖", "建议吃药", "停药", "不能吃", "必须吃"];

export async function analyzeWithModel({ env, type, photoName, imageData, mimeType }) {
  const apiKey = env.TOKENDANCE_API_KEY;
  if (!apiKey) {
    throw new Error("TOKENDANCE_API_KEY is not configured");
  }

  if (shouldUseStructuredReport(type, imageData, mimeType)) {
    return analyzeReportWithStructuredPipeline({ env, photoName, imageData, mimeType });
  }

  const baseUrl = env.TOKENDANCE_BASE_URL || "https://tokendance.space/gateway/v1";
  const model = env.TOKENDANCE_MODEL || "kimi-k2.6";
  const sample = analysisSamples[type];
  const messages = buildMessages(type, sample, photoName, imageData, mimeType);
  const thinkingEnabled = envFlag(env.TOKENDANCE_THINKING_ENABLED, false);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(buildRequestBody({ model, messages, thinkingEnabled, stream: false })),
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

export async function analyzeWithModelStream({ env, type, photoName, imageData, mimeType, onContent }) {
  const apiKey = env.TOKENDANCE_API_KEY;
  if (!apiKey) {
    throw new Error("TOKENDANCE_API_KEY is not configured");
  }

  if (shouldUseStructuredReport(type, imageData, mimeType)) {
    return analyzeReportWithStructuredPipeline({ env, photoName, imageData, mimeType, onContent });
  }

  const baseUrl = env.TOKENDANCE_BASE_URL || "https://tokendance.space/gateway/v1";
  const model = env.TOKENDANCE_MODEL || "kimi-k2.6";
  const sample = analysisSamples[type];
  const messages = buildMessages(type, sample, photoName, imageData, mimeType);
  const thinkingEnabled = envFlag(env.TOKENDANCE_THINKING_ENABLED, false);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(buildRequestBody({ model, messages, thinkingEnabled, stream: true })),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error?.message || `LLM request failed: ${response.status}`);
  }
  if (!response.body) {
    throw new Error("LLM stream body is empty");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

  async function handleBlock(block) {
    for (const rawLine of block.split("\n")) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;

      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta || {};
      if (typeof delta.content === "string" && delta.content) {
        content += delta.content;
        await onContent?.(delta.content);
      }
    }
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      await handleBlock(block);
    }
  }
  if (buffer.trim()) await handleBlock(buffer);

  if (!content) {
    throw new Error("LLM returned empty stream content");
  }

  const parsed = parseJsonObject(content);
  const normalized = normalizeAnalysis(type, parsed, sample);
  assertSafeCopy(normalized);

  return {
    ...normalized,
    model,
  };
}

function buildRequestBody({ model, messages, thinkingEnabled, stream }) {
  return {
    model,
    temperature: 0.2,
    max_tokens: 1400,
    stream,
    thinking: { type: thinkingEnabled ? "enabled" : "disabled" },
    messages,
  };
}

function shouldUseStructuredReport(type, imageData, mimeType) {
  return type === "report" && Boolean(imageData && mimeType);
}

async function analyzeReportWithStructuredPipeline({ env, photoName, imageData, mimeType, onContent }) {
  const sample = analysisSamples.report;
  const baseUrl = env.TOKENDANCE_BASE_URL || "https://tokendance.space/gateway/v1";
  const model = env.TOKENDANCE_MODEL || "kimi-k2.6";
  const ocrModel = env.TOKENDANCE_OCR_MODEL || "qwen3-vl-plus";
  const thinkingEnabled = envFlag(env.TOKENDANCE_THINKING_ENABLED, false);

  await onContent?.("正在提取报告中的血糖、胰岛素、C肽和糖化血红蛋白字段...\n");
  const ocrPayload = await requestChatJson({
    env,
    baseUrl,
    model: ocrModel,
    thinkingEnabled,
    temperature: 0,
    maxTokens: 1600,
    messages: buildReportOcrMessages({ photoName, imageData, mimeType }),
  });
  const ocrRows = normalizeOcrRows(ocrPayload.rows);
  if (!ocrRows.length) {
    throw new Error("OCR did not return report rows");
  }

  const rules = buildOgttRules(ocrRows);
  await onContent?.("已完成单位换算和 OGTT 阈值判断，正在生成谨慎解读...\n");

  const narrativePayload = await requestChatJson({
    env,
    baseUrl,
    model,
    thinkingEnabled,
    temperature: 0.1,
    maxTokens: 1800,
    messages: buildReportNarrativeMessages({ ocrRows, rules }),
  });

  const normalized = normalizeStructuredReport(narrativePayload, ocrRows, rules, sample);
  assertSafeCopy(normalized);
  await onContent?.(`${normalized.summary}\n`);

  return {
    ...normalized,
    model: `${ocrModel} OCR + ${model}`,
  };
}

async function requestChatJson({ env, baseUrl, model, thinkingEnabled, temperature, maxTokens, messages }) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.TOKENDANCE_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      stream: false,
      thinking: { type: thinkingEnabled ? "enabled" : "disabled" },
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
  return parseJsonObject(content);
}

function buildReportOcrMessages({ photoName, imageData, mimeType }) {
  const prompt = [
    "你只做医学报告 OCR，不做解释。",
    photoName ? `文件名：${photoName}` : "",
    "请识别血糖、胰岛素、C肽、糖化血红蛋白等字段。",
    "只输出严格 JSON：",
    `{"rows":[{"analyte":"glucose|insulin|c_peptide|hba1c|other","time":"fasting|1h|2h|3h|unknown","value":number,"unit":"原图单位或合理推断单位","reference":"原图参考值，没有则空字符串","raw_label":"原文字"}],"notes":[]}`,
    "不要补不存在的数据。不要 Markdown。不要解释。",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    {
      role: "system",
      content: "你是严谨的医学报告 OCR 引擎。只输出 JSON 对象。",
    },
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageData}` } },
      ],
    },
  ];
}

function buildReportNarrativeMessages({ ocrRows, rules }) {
  const prompt = [
    "下面是视觉模型 OCR 后的检验数据，以及后端规则计算结果。",
    "请生成面向用户的专业但谨慎的健康教育解读。",
    "要求：",
    "1. 不诊断、不治疗、不推荐药物，不说治愈、逆转、保证。",
    "2. 必须区分标准诊断点和风险信号：OGTT 2 小时血糖用于常用糖耐量判断；1 小时血糖偏高只能作为餐后早期波动信号，不能判成糖前期。",
    "3. 必须说明 HOMA-IR 来自胰岛素单位近似换算，切点因人群和检测方法不同。",
    "4. 只输出 JSON：",
    `{"title":"","summary":"","key_findings":[""],"interpretation":"","action_suggestions":[""],"doctor_questions":[""],"boundary":""}`,
    `OCR_ROWS=${JSON.stringify(ocrRows)}`,
    `RULES=${JSON.stringify(rules)}`,
  ].join("\n");

  return [
    {
      role: "system",
      content: "你是 GLUCOLIT 的糖尿病前期健康教育助手，擅长 OGTT、胰岛素和 C肽曲线解释。只输出 JSON 对象。",
    },
    { role: "user", content: prompt },
  ];
}

function normalizeOcrRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      analyte: normalizeAnalyte(row.analyte, row.raw_label),
      time: normalizeTime(row.time, row.raw_label),
      value: Number(row.value),
      unit: cleanText(row.unit),
      reference: cleanText(row.reference),
      raw_label: cleanText(row.raw_label),
    }))
    .filter((row) => row.analyte !== "other" && row.time && Number.isFinite(row.value));
}

function normalizeAnalyte(analyte, rawLabel) {
  const value = cleanText(analyte).toLowerCase();
  const label = cleanText(rawLabel);
  if (value === "glucose" || /葡萄糖|血糖/i.test(label)) return "glucose";
  if (value === "insulin" || /胰岛素/i.test(label)) return "insulin";
  if (value === "c_peptide" || /c肽|c 肽|c-peptide/i.test(label)) return "c_peptide";
  if (value === "hba1c" || /糖化血红蛋白|hba1c/i.test(label)) return "hba1c";
  return "other";
}

function normalizeTime(time, rawLabel) {
  const value = cleanText(time).toLowerCase();
  const label = cleanText(rawLabel);
  if (value === "fasting" || /空腹/i.test(label)) return "fasting";
  if (value === "1h" || /一小?时|1h|1 h/i.test(label)) return "1h";
  if (value === "2h" || /二小?时|两小?时|2h|2 h/i.test(label)) return "2h";
  if (value === "3h" || /三小?时|3h|3 h/i.test(label)) return "3h";
  if (value === "unknown") return "unknown";
  return "";
}

function buildOgttRules(rows) {
  const value = (analyte, time) => rows.find((row) => row.analyte === analyte && row.time === time)?.value;
  const unit = (analyte, time) => rows.find((row) => row.analyte === analyte && row.time === time)?.unit || "";
  const glucose = {
    fasting: value("glucose", "fasting"),
    h1: value("glucose", "1h"),
    h2: value("glucose", "2h"),
    h3: value("glucose", "3h"),
  };
  const insulinRaw = {
    fasting: value("insulin", "fasting"),
    h1: value("insulin", "1h"),
    h2: value("insulin", "2h"),
    h3: value("insulin", "3h"),
  };
  const cPeptideRaw = {
    fasting: value("c_peptide", "fasting"),
    h1: value("c_peptide", "1h"),
    h2: value("c_peptide", "2h"),
    h3: value("c_peptide", "3h"),
  };
  const hba1c = value("hba1c", "unknown");
  const insulinUnit = unit("insulin", "fasting");
  const cPeptideUnit = unit("c_peptide", "fasting");
  const insulinUiu = mapValues(insulinRaw, (item) => convertInsulinToUiu(item, insulinUnit));
  const cPeptideNg = mapValues(cPeptideRaw, (item) => convertCPeptideToNg(item, cPeptideUnit));
  const homaRange = buildHomaRange(glucose.fasting, insulinRaw.fasting, insulinUnit);

  const flags = {
    fasting_glucose: classifyFastingGlucose(glucose.fasting),
    two_hour_ogtt: classifyTwoHourGlucose(glucose.h2),
    hba1c: classifyHba1c(hba1c),
    one_hour_glucose: Number.isFinite(glucose.h1) && glucose.h1 >= 10 ? "high_post_load_signal_not_diagnostic" : "not_high_or_missing",
    homa_ir: homaRange?.high >= 2.5 ? "elevated_by_common_cutoffs" : "not_high_or_missing",
  };

  return {
    thresholds: {
      source: "ADA/CDC common screening thresholds",
      fasting_glucose_mmol_l: { normal: "<5.6", prediabetes: "5.6-6.9", diabetes: ">=7.0" },
      two_hour_ogtt_mmol_l: { normal: "<7.8", prediabetes: "7.8-11.0", diabetes: ">=11.1" },
      hba1c_percent: { normal: "<5.7", prediabetes: "5.7-6.4", diabetes: ">=6.5" },
      one_hour_note: "1 小时血糖不是 ADA/CDC 糖前期诊断点；本产品仅作为餐后早期波动信号。",
    },
    glucose,
    insulin_raw: { values: insulinRaw, unit: insulinUnit },
    insulin_uIU_mL: insulinUiu,
    c_peptide_raw: { values: cPeptideRaw, unit: cPeptideUnit },
    c_peptide_ng_mL: cPeptideNg,
    hba1c,
    derived: {
      homa_ir: homaRange,
      insulin_ratio: ratioSet(insulinRaw),
      c_peptide_ratio: ratioSet(cPeptideRaw),
    },
    flags,
  };
}

function mapValues(source, mapper) {
  return Object.fromEntries(
    Object.entries(source)
      .filter(([, value]) => Number.isFinite(value))
      .map(([key, value]) => [key, round(mapper(value), 2)]),
  );
}

function convertInsulinToUiu(value, unit) {
  if (!Number.isFinite(value)) return undefined;
  if (/pmol/i.test(unit)) return value / 6;
  return value;
}

function convertCPeptideToNg(value, unit) {
  if (!Number.isFinite(value)) return undefined;
  if (/pmol/i.test(unit)) return value / 331;
  return value;
}

function buildHomaRange(glucoseFasting, insulinFasting, insulinUnit) {
  if (!Number.isFinite(glucoseFasting) || !Number.isFinite(insulinFasting)) return null;
  if (/pmol/i.test(insulinUnit)) {
    const low = (glucoseFasting * (insulinFasting / 6.945)) / 22.5;
    const high = (glucoseFasting * (insulinFasting / 6)) / 22.5;
    return {
      value: round((low + high) / 2, 2),
      low: round(low, 2),
      high: round(high, 2),
      note: "胰岛素 pmol/L 按常见换算系数折算为 uIU/mL，检测方法不同会导致 HOMA-IR 有区间差异。",
    };
  }
  const value = (glucoseFasting * insulinFasting) / 22.5;
  return { value: round(value, 2), low: round(value, 2), high: round(value, 2), note: "基于空腹血糖和空腹胰岛素计算。" };
}

function ratioSet(values) {
  const fasting = values.fasting;
  if (!Number.isFinite(fasting) || fasting === 0) return {};
  return Object.fromEntries(
    Object.entries(values)
      .filter(([key, value]) => key !== "fasting" && Number.isFinite(value))
      .map(([key, value]) => [key, round(value / fasting, 1)]),
  );
}

function classifyFastingGlucose(value) {
  if (!Number.isFinite(value)) return "missing";
  if (value >= 7) return "diabetes_threshold";
  if (value >= 5.6) return "prediabetes_threshold";
  return "normal";
}

function classifyTwoHourGlucose(value) {
  if (!Number.isFinite(value)) return "missing";
  if (value >= 11.1) return "diabetes_threshold";
  if (value >= 7.8) return "prediabetes_threshold";
  return "normal";
}

function classifyHba1c(value) {
  if (!Number.isFinite(value)) return "missing";
  if (value >= 6.5) return "diabetes_threshold";
  if (value >= 5.7) return "prediabetes_threshold";
  return "normal";
}

function normalizeStructuredReport(parsed, ocrRows, rules, sample) {
  const findings = toTextArray(parsed.key_findings);
  const suggestions = toTextArray(parsed.action_suggestions);
  const doctorQuestions = toTextArray(parsed.doctor_questions);
  const title = cleanText(parsed.title) || "OGTT / 胰岛素 / C肽报告解读";
  const summary = cleanText(parsed.summary) || buildRuleSummary(rules) || sample.summary;
  const boundary =
    cleanText(parsed.boundary) ||
    "本结果用于健康教育与生活方式行为支持，不替代医生诊断和治疗。OGTT、胰岛素和 C肽结果需由医生结合病史、用药、体重、腰围、血脂和检测方法综合判断。";
  const riskLevel = rules.flags.two_hour_ogtt === "diabetes_threshold" || rules.flags.hba1c === "diabetes_threshold" ? "orange" : rules.flags.homa_ir === "elevated_by_common_cutoffs" || rules.flags.one_hour_glucose === "high_post_load_signal_not_diagnostic" ? "yellow" : "green";

  return {
    title,
    summary,
    risk_level: riskLevel,
    confidence: "high",
    result: {
      fields: buildReportFields(ocrRows, rules),
      key_findings: findings.length ? findings : fallbackFindings(rules),
      interpretation: cleanText(parsed.interpretation) || summary,
      action_suggestions: suggestions,
      doctor_questions: doctorQuestions,
      ogtt: rules,
      ocr_rows: ocrRows,
      medical_boundary: boundary,
      ai_source: "structured_ogtt_pipeline",
    },
  };
}

function buildReportFields(rows, rules) {
  const fields = rows.map((row) => ({
    label: row.raw_label || labelForRow(row),
    value: `${row.value}${row.unit ? ` ${row.unit}` : ""}`,
    note: row.reference ? `参考：${row.reference}` : noteForRow(row, rules),
  }));
  if (rules.derived.homa_ir) {
    fields.push({
      label: "HOMA-IR",
      value:
        rules.derived.homa_ir.low === rules.derived.homa_ir.high
          ? String(rules.derived.homa_ir.value)
          : `${rules.derived.homa_ir.low}-${rules.derived.homa_ir.high}`,
      note: rules.derived.homa_ir.note,
    });
  }
  return fields;
}

function labelForRow(row) {
  const analyteLabels = { glucose: "血糖", insulin: "胰岛素", c_peptide: "C肽", hba1c: "糖化血红蛋白" };
  const timeLabels = { fasting: "空腹", "1h": "1小时", "2h": "2小时", "3h": "3小时", unknown: "" };
  return `${timeLabels[row.time] || ""}${analyteLabels[row.analyte] || row.analyte}`;
}

function noteForRow(row, rules) {
  if (row.analyte === "glucose" && row.time === "2h") {
    return rules.flags.two_hour_ogtt === "normal" ? "2小时血糖低于 7.8 mmol/L，未达到糖耐量受损常用阈值。" : "2小时血糖达到需要医生确认的阈值。";
  }
  if (row.analyte === "glucose" && row.time === "1h" && rules.flags.one_hour_glucose === "high_post_load_signal_not_diagnostic") {
    return "1小时血糖偏高可作为餐后早期波动信号，但不是糖前期诊断点。";
  }
  if (row.analyte === "hba1c") {
    return rules.flags.hba1c === "normal" ? "低于 5.7%，处于常用正常范围。" : "达到需要医生结合病史确认的阈值。";
  }
  return "";
}

function fallbackFindings(rules) {
  const findings = [];
  if (Number.isFinite(rules.glucose.h2)) {
    findings.push(`2小时血糖 ${rules.glucose.h2} mmol/L，${rules.flags.two_hour_ogtt === "normal" ? "未达到糖耐量受损常用阈值。" : "达到需要医生确认的阈值。"}`);
  }
  if (Number.isFinite(rules.glucose.h1) && rules.flags.one_hour_glucose === "high_post_load_signal_not_diagnostic") {
    findings.push(`1小时血糖 ${rules.glucose.h1} mmol/L，提示餐后早期波动偏高，但不能单独作为糖前期诊断。`);
  }
  if (rules.derived.homa_ir) {
    findings.push(`HOMA-IR 约 ${rules.derived.homa_ir.low}-${rules.derived.homa_ir.high}，提示需关注胰岛素抵抗倾向。`);
  }
  return findings;
}

function buildRuleSummary(rules) {
  if (rules.flags.two_hour_ogtt === "normal" && rules.flags.hba1c === "normal") {
    return "2小时血糖和糖化血红蛋白未达到糖前期常用阈值，但胰岛素代偿和餐后早期波动值得继续观察。";
  }
  return "";
}

function toTextArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).map(cleanText).filter(Boolean);
}

function round(value, digits) {
  if (!Number.isFinite(value)) return undefined;
  return Number(value.toFixed(digits));
}

export function envFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
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
