import { analysisSamples } from "./demo-data.js";
import { findNutritionMatches, nutritionKnowledgeVersion } from "./nutrition-knowledge.js";

const forbiddenTerms = ["治愈", "逆转", "保证降低血糖", "建议吃药", "停药", "不能吃", "必须吃", "治疗作用", "辅助降糖", "降糖效果", "降糖作用"];
const labelKnowledgeVersion = "label-rules-20260704";

const labelIngredientKnowledge = {
  addedSugar: ["白砂糖", "蔗糖", "果葡糖浆", "果糖", "葡萄糖浆", "麦芽糖浆", "蜂蜜", "浓缩果汁", "红糖", "冰糖", "糖浆"],
  refinedCarb: ["小麦粉", "精制小麦粉", "糯米粉", "淀粉", "麦芽糊精", "植脂末", "饼干粉"],
  sweetener: ["赤藓糖醇", "三氯蔗糖", "安赛蜜", "阿斯巴甜", "甜菊糖苷", "木糖醇", "山梨糖醇"],
  saturatedFat: ["起酥油", "氢化植物油", "代可可脂", "植脂末", "奶油", "黄油", "棕榈油", "椰子油"],
  protein: ["乳清蛋白", "牛奶", "酸奶", "鸡蛋", "大豆蛋白", "豆粉", "鱼肉", "鸡胸肉"],
  fiber: ["膳食纤维", "菊粉", "抗性糊精", "燕麦", "全麦", "藜麦", "魔芋粉"],
};

export async function analyzeWithModel({ env, type, photoName, imageData, mimeType }) {
  const apiKey = env.TOKENDANCE_API_KEY;
  if (!apiKey) {
    throw new Error("TOKENDANCE_API_KEY is not configured");
  }

  if (shouldUseStructuredReport(type, imageData, mimeType)) {
    return analyzeReportWithStructuredPipeline({ env, photoName, imageData, mimeType });
  }
  if (shouldUseStructuredMeal(type, imageData, mimeType)) {
    return analyzeMealWithStructuredPipeline({ env, photoName, imageData, mimeType });
  }
  if (shouldUseStructuredLabel(type, imageData, mimeType)) {
    return analyzeLabelWithStructuredPipeline({ env, photoName, imageData, mimeType });
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
  if (shouldUseStructuredMeal(type, imageData, mimeType)) {
    return analyzeMealWithStructuredPipeline({ env, photoName, imageData, mimeType, onContent });
  }
  if (shouldUseStructuredLabel(type, imageData, mimeType)) {
    return analyzeLabelWithStructuredPipeline({ env, photoName, imageData, mimeType, onContent });
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

function shouldUseStructuredMeal(type, imageData, mimeType) {
  return type === "meal" && Boolean(imageData && mimeType);
}

function shouldUseStructuredLabel(type, imageData, mimeType) {
  return type === "label" && Boolean(imageData && mimeType);
}

async function analyzeReportWithStructuredPipeline({ env, photoName, imageData, mimeType, onContent }) {
  const sample = analysisSamples.report;
  const baseUrl = env.TOKENDANCE_BASE_URL || "https://tokendance.space/gateway/v1";
  const model = env.TOKENDANCE_MODEL || "kimi-k2.6";
  const ocrModel = env.TOKENDANCE_OCR_MODEL || "qwen3-vl-plus";
  const useExternalNarrative = Boolean(env.REPORT_NARRATIVE_BASE_URL && env.REPORT_NARRATIVE_API_KEY);
  const narrativeBaseUrl = useExternalNarrative ? env.REPORT_NARRATIVE_BASE_URL : baseUrl;
  const narrativeModel = useExternalNarrative ? env.REPORT_NARRATIVE_MODEL || model : model;
  const narrativeApiKey = useExternalNarrative ? env.REPORT_NARRATIVE_API_KEY : env.TOKENDANCE_API_KEY;
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
    baseUrl: narrativeBaseUrl,
    apiKey: narrativeApiKey,
    model: narrativeModel,
    thinkingEnabled: useExternalNarrative ? false : thinkingEnabled,
    includeThinking: !useExternalNarrative,
    temperature: 0.1,
    maxTokens: 1800,
    messages: buildReportNarrativeMessages({ ocrRows, rules }),
  });

  const normalized = normalizeStructuredReport(narrativePayload, ocrRows, rules, sample);
  assertSafeCopy(normalized);
  await onContent?.(`${normalized.summary}\n`);

  return {
    ...normalized,
    model: `${ocrModel} OCR + ${narrativeModel}`,
  };
}

async function analyzeMealWithStructuredPipeline({ env, photoName, imageData, mimeType, onContent }) {
  const sample = analysisSamples.meal;
  const baseUrl = env.TOKENDANCE_BASE_URL || "https://tokendance.space/gateway/v1";
  const model = env.TOKENDANCE_MODEL || "kimi-k2.6";
  const visionModel = env.TOKENDANCE_OCR_MODEL || "qwen3-vl-plus";
  const thinkingEnabled = envFlag(env.TOKENDANCE_THINKING_ENABLED, false);

  await onContent?.("正在识别餐盘中的主食、蛋白质、蔬菜和烹饪方式...\n");
  const visionPayload = await requestChatJson({
    env,
    baseUrl,
    model: visionModel,
    thinkingEnabled,
    temperature: 0,
    maxTokens: 1600,
    messages: buildMealVisionMessages({ photoName, imageData, mimeType }),
  });
  const mealItems = normalizeMealItems(visionPayload.items);
  if (!mealItems.length) {
    throw new Error("Meal vision did not return food items");
  }

  const rules = buildMealRules(mealItems, visionPayload.overall);
  await onContent?.("已完成餐盘结构判断，正在生成糖前友好的替换建议...\n");

  const narrativePayload = await requestChatJson({
    env,
    baseUrl,
    model,
    thinkingEnabled,
    temperature: 0.1,
    maxTokens: 1600,
    messages: buildMealNarrativeMessages({ mealItems, rules }),
  });

  const normalized = normalizeStructuredMeal(narrativePayload, mealItems, rules, sample);
  assertSafeCopy(normalized);
  await onContent?.(`${normalized.summary}\n`);

  return {
    ...normalized,
    model: `${visionModel} vision + ${model}`,
  };
}

async function analyzeLabelWithStructuredPipeline({ env, photoName, imageData, mimeType, onContent }) {
  const sample = analysisSamples.label;
  const baseUrl = env.TOKENDANCE_BASE_URL || "https://tokendance.space/gateway/v1";
  const model = env.TOKENDANCE_MODEL || "kimi-k2.6";
  const ocrModel = env.TOKENDANCE_OCR_MODEL || "qwen3-vl-plus";
  const thinkingEnabled = envFlag(env.TOKENDANCE_THINKING_ENABLED, false);

  await onContent?.("正在识别配料顺序、添加糖和营养成分表...\n");
  const ocrPayload = await requestChatJson({
    env,
    baseUrl,
    model: ocrModel,
    thinkingEnabled,
    temperature: 0,
    maxTokens: 1600,
    messages: buildLabelOcrMessages({ photoName, imageData, mimeType }),
  });
  const labelOcr = normalizeLabelOcr(ocrPayload);
  if (!labelOcr.ingredients.length && !Object.keys(labelOcr.nutrition_per_100).length) {
    throw new Error("Label OCR did not return ingredients or nutrition facts");
  }

  const rules = buildLabelRules(labelOcr);
  await onContent?.("已完成添加糖、碳水、钠和配料复杂度判断，正在整理购买建议...\n");

  const useExternalNarrative = Boolean(
    (env.LABEL_NARRATIVE_BASE_URL || env.REPORT_NARRATIVE_BASE_URL) &&
      (env.LABEL_NARRATIVE_API_KEY || env.REPORT_NARRATIVE_API_KEY),
  );
  const narrativeBaseUrl = useExternalNarrative ? env.LABEL_NARRATIVE_BASE_URL || env.REPORT_NARRATIVE_BASE_URL : baseUrl;
  const narrativeModel = useExternalNarrative ? env.LABEL_NARRATIVE_MODEL || "gemini-3.1-flash-lite-preview" : model;
  const narrativeApiKey = useExternalNarrative ? env.LABEL_NARRATIVE_API_KEY || env.REPORT_NARRATIVE_API_KEY : env.TOKENDANCE_API_KEY;
  let narrativePayload;
  let narrativeModelLabel = narrativeModel;

  try {
    narrativePayload = await requestChatJson({
      env,
      baseUrl: narrativeBaseUrl,
      apiKey: narrativeApiKey,
      model: narrativeModel,
      thinkingEnabled: useExternalNarrative ? false : thinkingEnabled,
      includeThinking: !useExternalNarrative,
      temperature: 0.1,
      maxTokens: 1600,
      messages: buildLabelNarrativeMessages({ labelOcr, rules }),
    });
  } catch (error) {
    narrativePayload = buildLabelRuleNarrative(rules);
    narrativeModelLabel = `${narrativeModel} failed, rules fallback`;
  }

  const normalized = normalizeStructuredLabel(narrativePayload, labelOcr, rules, sample);
  assertSafeCopy(normalized);
  await onContent?.(`${normalized.summary}\n`);

  return {
    ...normalized,
    model: `${ocrModel} label OCR + ${narrativeModelLabel}`,
  };
}

async function requestChatJson({ env, baseUrl, apiKey = env.TOKENDANCE_API_KEY, model, thinkingEnabled, includeThinking = true, temperature, maxTokens, messages }) {
  const requestBody = {
    model,
    temperature,
    max_tokens: maxTokens,
    stream: false,
    messages,
  };
  if (includeThinking) {
    requestBody.thinking = { type: thinkingEnabled ? "enabled" : "disabled" };
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
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

function buildMealVisionMessages({ photoName, imageData, mimeType }) {
  const prompt = [
    "你只做餐盘视觉识别，不做诊断，不估算精确热量。",
    photoName ? `文件名：${photoName}` : "",
    "请识别图片中可见食物，按糖前生活方式支持所需维度分类。",
    "只输出严格 JSON：",
    `{"items":[{"name":"","category":"staple|protein|vegetable|fat_sauce|drink|fruit|unknown","portion":"small|medium|large|unknown","cooking":"steamed|boiled|stir_fried|fried|soup|raw|unknown","visible_clues":[""],"confidence":"low|medium|high"}],"overall":{"shared_table":true,"drink_visible":false,"sauce_oil_level":"low|medium|high|unknown","notes":[]}}`,
    "不要补不存在的数据。不要 Markdown。不要解释。",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    {
      role: "system",
      content: "你是严谨的餐盘视觉识别引擎。只输出 JSON 对象。",
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

function buildLabelOcrMessages({ photoName, imageData, mimeType }) {
  const prompt = [
    "你只做食品包装配料表 OCR 和营养成分表抽取，不做购买建议。",
    photoName ? `文件名：${photoName}` : "",
    "请按图片原文识别产品名、产品分类、配料顺序、营养成分表和显著声称。",
    "只输出严格 JSON：",
    `{"product_name":"","category":"","ingredients":[{"rank":1,"name":"","raw":"","role":"base|plant|added_sugar|sweetener|refined_carb|fat|protein|fiber|vitamin_mineral|additive|unknown"}],"nutrition_per_100":{"basis":"100ml|100g|serving|unknown","energy_kj":number|null,"protein_g":number|null,"fat_g":number|null,"carbohydrate_g":number|null,"sugar_g":number|null,"fiber_g":number|null,"sodium_mg":number|null},"claims":[],"notes":[]}`,
    "不要补不存在的数据；营养表没看到的字段填 null。不要 Markdown。不要解释。",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    {
      role: "system",
      content: "你是严谨的食品标签 OCR 引擎。只输出 JSON 对象。",
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
    "请生成面向用户的专业但谨慎的健康教育解读。内容要具体，不要只复述正常/异常；要解释曲线形态、标准诊断点、观察信号和下一步记录重点。",
    "要求：",
    "1. 不诊断、不治疗、不推荐药物，不说治愈、逆转、保证。",
    "2. 必须区分标准诊断点和风险信号：OGTT 2 小时血糖用于常用糖耐量判断；1 小时血糖偏高只能作为餐后早期波动信号，不能判成糖前期。",
    "3. 必须说明 HOMA-IR 来自胰岛素单位近似换算，切点因人群和检测方法不同。",
    "4. 行动建议必须围绕：复查/补充检测、餐后曲线记录、进餐结构、餐后活动、下次检测条件一致性。",
    "5. 只输出 JSON：",
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

function buildMealNarrativeMessages({ mealItems, rules }) {
  const prompt = [
    "下面是视觉模型识别的餐盘结构，以及后端规则判断结果。",
    "请生成面向糖尿病前期/控糖用户的专业但温和的餐盘分析。",
    "要求：",
    "1. 不诊断、不治疗、不推荐药物，不说治愈、逆转、保证。",
    "2. 不使用绝对化禁令；用“优先、可以、建议、减少、替换、控制份量”表达。",
    "3. 不估算精确热量，只做结构、份量和餐后波动风险判断。",
    "4. 如果是多人共享餐桌，要提醒结果是按图片估计，实际摄入量需用户确认。",
    "5. 必须优先使用 RULES.nutrition_knowledge.refs 里的 GI/GL 知识库，不要自己编造 GI/GL 数值；不要在用户文案里展示 II/胰岛素指数。",
    "6. 拍照分析结论区必须包含这句结构建议：这餐蛋白质偏少、主食偏精细时，提示“两个小调整：① 先吃菜和蛋白、最后吃主食；② 把 1/3 白米饭换成杂粮/杂豆。有助于平稳这餐的餐后血糖。”如当前餐盘不符合，也要保留“先吃菜和蛋白、最后吃主食”和“把 1/3 白米饭换成杂粮/杂豆”作为可选替换建议。",
    "7. 只输出 JSON：",
    `{"title":"","summary":"","observations":[""],"swaps":[""],"meal_order":[""],"boundary":""}`,
    `ITEMS=${JSON.stringify(mealItems)}`,
    `RULES=${JSON.stringify(rules)}`,
  ].join("\n");

  return [
    {
      role: "system",
      content: "你是 GLUCOLIT 的糖尿病前期餐盘分析助手，擅长把食物结构转成低门槛行动建议。只输出 JSON 对象。",
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
    one_hour_glucose: Number.isFinite(glucose.h1) && glucose.h1 >= 8.6 ? "high_post_load_signal_not_diagnostic" : "not_high_or_missing",
    homa_ir: homaRange?.high >= 2.5 ? "elevated_by_common_cutoffs" : "not_high_or_missing",
  };
  const curve = buildCurveAnalysis({ glucose, insulinRaw, cPeptideRaw });

  return {
    thresholds: {
      source: "ADA/CDC common screening thresholds",
      fasting_glucose_mmol_l: { normal: "<5.6", prediabetes: "5.6-6.9", diabetes: ">=7.0" },
      two_hour_ogtt_mmol_l: { normal: "<7.8", prediabetes: "7.8-11.0", diabetes: ">=11.1" },
      hba1c_percent: { normal: "<5.7", prediabetes: "5.7-6.4", diabetes: ">=6.5" },
      one_hour_note: "1 小时血糖不是 ADA/CDC 糖前期诊断点；本产品仅作为餐后早期波动信号。部分 1h OGTT 共识会用 8.6 mmol/L 作为高风险观察切点。",
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
      curve,
    },
    flags,
  };
}

function buildCurveAnalysis({ glucose, insulinRaw, cPeptideRaw }) {
  const glucosePeak = peakPoint(glucose);
  const insulinPeak = peakPoint(insulinRaw);
  const cPeptidePeak = peakPoint(cPeptideRaw);
  const glucoseRecoveryDelta = Number.isFinite(glucose.h3) && Number.isFinite(glucose.fasting) ? round(glucose.h3 - glucose.fasting, 2) : undefined;
  const insulinRecoveryRatio = Number.isFinite(insulinRaw.h3) && Number.isFinite(insulinRaw.fasting) && insulinRaw.fasting > 0 ? round(insulinRaw.h3 / insulinRaw.fasting, 1) : undefined;
  const cPeptideRecoveryRatio = Number.isFinite(cPeptideRaw.h3) && Number.isFinite(cPeptideRaw.fasting) && cPeptideRaw.fasting > 0 ? round(cPeptideRaw.h3 / cPeptideRaw.fasting, 1) : undefined;

  return {
    glucose_peak: glucosePeak,
    insulin_peak: insulinPeak,
    c_peptide_peak: cPeptidePeak,
    glucose_3h_minus_fasting: glucoseRecoveryDelta,
    insulin_3h_to_fasting_ratio: insulinRecoveryRatio,
    c_peptide_3h_to_fasting_ratio: cPeptideRecoveryRatio,
    recovery_note: buildRecoveryNote({ glucoseRecoveryDelta, insulinRecoveryRatio, cPeptideRecoveryRatio }),
  };
}

function peakPoint(values) {
  const labels = { fasting: "空腹", h1: "1h", h2: "2h", h3: "3h" };
  const entries = Object.entries(values).filter(([, value]) => Number.isFinite(value));
  if (!entries.length) return null;
  const [time, value] = entries.reduce((best, item) => (item[1] > best[1] ? item : best), entries[0]);
  return { time, label: labels[time] || time, value };
}

function buildRecoveryNote({ glucoseRecoveryDelta, insulinRecoveryRatio, cPeptideRecoveryRatio }) {
  const notes = [];
  if (Number.isFinite(glucoseRecoveryDelta)) {
    notes.push(glucoseRecoveryDelta <= 0.5 ? "3h 血糖已接近空腹水平" : `3h 血糖仍比空腹高 ${glucoseRecoveryDelta} mmol/L`);
  }
  if (Number.isFinite(insulinRecoveryRatio)) {
    notes.push(insulinRecoveryRatio <= 1.5 ? "3h 胰岛素接近空腹倍数" : `3h 胰岛素约为空腹 ${insulinRecoveryRatio} 倍`);
  }
  if (Number.isFinite(cPeptideRecoveryRatio)) {
    notes.push(cPeptideRecoveryRatio <= 1.8 ? "3h C肽接近空腹倍数" : `3h C肽约为空腹 ${cPeptideRecoveryRatio} 倍`);
  }
  return notes.join("；");
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
      standard_comparison: buildStandardComparison(ocrRows, rules),
      curve_rows: buildCurveRows(rules),
      derived_indicators: buildDerivedIndicators(rules),
      professional_advice: buildProfessionalAdvice(rules),
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

function normalizeMealItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      name: cleanText(item.name),
      category: normalizeMealCategory(item.category, item.name),
      portion: ["small", "medium", "large", "unknown"].includes(item.portion) ? item.portion : "unknown",
      cooking: ["steamed", "boiled", "stir_fried", "fried", "soup", "raw", "unknown"].includes(item.cooking) ? item.cooking : "unknown",
      visible_clues: toTextArray(item.visible_clues),
      confidence: ["low", "medium", "high"].includes(item.confidence) ? item.confidence : "medium",
    }))
    .map((item) => ({ ...item, nutrition_refs: findNutritionMatches(item.name) }))
    .filter((item) => item.name && item.category !== "unknown");
}

function normalizeMealCategory(category, name) {
  const value = cleanText(category);
  const label = cleanText(name);
  if (["staple", "protein", "vegetable", "fat_sauce", "drink", "fruit"].includes(value)) return value;
  if (/米饭|饭|面|馒头|饼|粥|粉|土豆|红薯|玉米/i.test(label)) return "staple";
  if (/蛋|鸡|鱼|肉|虾|牛|猪|豆腐|豆|奶/i.test(label)) return "protein";
  if (/菜|青菜|菠菜|番茄|西红柿|丝瓜|黄瓜|生菜|花菜/i.test(label)) return "vegetable";
  if (/汤汁|酱|油|沙拉酱/i.test(label)) return "fat_sauce";
  if (/饮料|奶茶|果汁|酒/i.test(label)) return "drink";
  if (/水果|苹果|香蕉|橙|葡萄/i.test(label)) return "fruit";
  return "unknown";
}

function buildMealRules(items, overall = {}) {
  const byCategory = (category) => items.filter((item) => item.category === category);
  const staples = byCategory("staple");
  const proteins = byCategory("protein");
  const vegetables = byCategory("vegetable");
  const fatSauces = byCategory("fat_sauce");
  const drinks = byCategory("drink");
  const stapleScore = portionScore(staples);
  const proteinScore = portionScore(proteins);
  const vegetableScore = portionScore(vegetables);
  const oilLevel = normalizeOilLevel(overall.sauce_oil_level, items);
  const sharedTable = Boolean(overall.shared_table) || items.length >= 4;
  const nutritionRefs = buildMealNutritionRefs(items);

  let carbRisk = "中";
  if (!staples.length || (stapleScore <= 1 && vegetableScore >= 2 && proteinScore >= 1)) {
    carbRisk = "低";
  }
  if (stapleScore >= 3 && vegetableScore < 2) {
    carbRisk = "偏高";
  }
  if (stapleScore >= 2 && proteinScore === 0) {
    carbRisk = "偏高";
  }
  if (staples.some((item) => hasKnowledgeLevel(item, "glLevel", "high") && item.portion !== "small")) {
    carbRisk = "偏高";
  }
  if (staples.some((item) => hasKnowledgeLevel(item, "glLevel", "medium") && item.portion === "large")) {
    carbRisk = "偏高";
  }

  const strengths = [];
  const watch = [];
  if (vegetableScore >= 2) strengths.push("蔬菜量充足，有助于增加饱腹感并平缓餐后波动。");
  if (proteinScore >= 2) strengths.push("蛋白质来源较丰富，适合搭配主食一起吃。");
  if (staples.some((item) => /杂粮|糙米|黑米|紫米|燕麦/i.test(item.name))) strengths.push("主食看起来含有粗杂粮，比精白主食更适合控制餐后波动。");
  if (nutritionRefs.some((ref) => ref.glLevel === "low" && ref.iiLevel !== "high")) {
    strengths.push("知识库匹配到部分低 GL/低或中等 II 食物，整体餐盘更适合稳住餐后波动。");
  }
  if (stapleScore >= 2) watch.push("主食份量需要按个人目标确认，建议先以小半碗到一拳为起点。");
  if (oilLevel === "medium" || oilLevel === "high") watch.push("番茄蛋和炒菜有汤汁/油脂，建议少拌饭，优先吃固体食物。");
  if (drinks.length) watch.push("图片中有饮品时，需要确认是否含糖。");
  if (nutritionRefs.some((ref) => ref.glLevel === "high")) watch.push("知识库匹配到高 GL 食物时，应优先把份量降下来，并搭配蔬菜和蛋白质。");
  if (nutritionRefs.some((ref) => ref.glLevel === "low" && ref.iiLevel === "high")) watch.push("知识库提示部分食物 GL 低但胰岛素指数高，胰岛素抵抗人群需要结合个人反应观察。");
  if (sharedTable) watch.push("图片像多人共享餐桌，实际摄入量需要用户确认。");

  return {
    plate: {
      staple: summarizeItems(staples) || "未明显看到主食",
      protein: summarizeItems(proteins) || "未明显看到蛋白质",
      vegetables: summarizeItems(vegetables) || "未明显看到蔬菜",
      drink: summarizeItems(drinks) || "无明显饮品",
      cooking: summarizeCooking(items, oilLevel),
    },
    carbRisk,
    structure_scores: {
      staple: stapleScore,
      protein: proteinScore,
      vegetables: vegetableScore,
      oil_sauce: oilLevel,
      shared_table: sharedTable,
    },
    nutrition_knowledge: {
      version: nutritionKnowledgeVersion,
      refs: nutritionRefs,
    },
    strengths,
    watch,
  };
}

function buildMealNutritionRefs(items) {
  const refs = [];
  const seen = new Set();
  for (const item of items) {
    for (const match of item.nutrition_refs || []) {
      const key = `${item.name}:${match.food}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({
        item: item.name,
        food: match.food,
        group: match.group,
        portion: match.portion,
        carbs: match.carbs,
        gi: match.gi,
        gl: match.gl,
        insulinIndex: match.insulinIndex,
        glLevel: match.glLevel,
        iiLevel: match.iiLevel,
        note: match.note,
      });
    }
  }
  return refs;
}

function hasKnowledgeLevel(item, key, level) {
  return (item.nutrition_refs || []).some((ref) => ref[key] === level);
}

function portionScore(items) {
  const score = { small: 1, medium: 2, large: 3, unknown: 1 };
  return items.reduce((sum, item) => sum + (score[item.portion] || 1), 0);
}

function normalizeOilLevel(value, items) {
  if (["low", "medium", "high", "unknown"].includes(value)) return value;
  if (items.some((item) => item.category === "fat_sauce" || item.cooking === "fried")) return "high";
  if (items.some((item) => item.cooking === "stir_fried")) return "medium";
  return "unknown";
}

function summarizeItems(items) {
  return items.map((item) => item.name).filter(Boolean).join("、");
}

function summarizeCooking(items, oilLevel) {
  const cookingLabels = {
    steamed: "蒸/清淡",
    boiled: "水煮/焯",
    stir_fried: "炒制",
    fried: "煎炸",
    soup: "汤汁",
    raw: "生食",
    unknown: "",
  };
  const labels = [...new Set(items.map((item) => cookingLabels[item.cooking]).filter(Boolean))];
  const oilText = oilLevel === "low" ? "油脂较少" : oilLevel === "medium" ? "油脂/汤汁中等" : oilLevel === "high" ? "油脂/酱汁偏多" : "油脂不确定";
  return `${labels.join("、") || "家常做法"}；${oilText}`;
}

function normalizeStructuredMeal(parsed, mealItems, rules, sample) {
  const observations = toTextArray(parsed.observations);
  const swaps = toTextArray(parsed.swaps);
  const mealOrder = toTextArray(parsed.meal_order);
  const title = cleanText(parsed.title) || "餐盘结构分析";
  const summary = cleanText(parsed.summary) || buildMealSummary(rules) || sample.summary;
  const boundary =
    cleanText(parsed.boundary) ||
    "餐盘分析基于图片估计，用于饮食结构和行为建议，不替代医生或营养师的个体化方案。多人共享餐桌需按实际摄入量重新确认。";

  return {
    title,
    summary,
    risk_level: rules.carbRisk === "偏高" ? "orange" : rules.carbRisk === "中" ? "yellow" : "green",
    confidence: "high",
    result: {
      plate: rules.plate,
      carbRisk: rules.carbRisk,
      observations: observations.length ? observations : [...rules.strengths, ...rules.watch],
      swaps: swaps.length ? swaps : fallbackMealSwaps(rules),
      meal_order: mealOrder.length ? mealOrder : ["两个小调整：① 先吃菜和蛋白、最后吃主食；② 把 1/3 白米饭换成杂粮/杂豆。有助于平稳这餐的餐后血糖。"],
      detected_items: mealItems,
      meal_rules: rules,
      nutrition_refs: rules.nutrition_knowledge.refs,
      nutrition_notes: buildNutritionNotes(rules.nutrition_knowledge.refs),
      medical_boundary: boundary,
      ai_source: "structured_meal_pipeline",
    },
  };
}

function buildNutritionNotes(refs) {
  return refs.slice(0, 6).map((ref) => {
    const glLabel = ref.glLevel === "low" ? "低 GL" : ref.glLevel === "medium" ? "中 GL" : ref.glLevel === "high" ? "高 GL" : "GL 未知";
    const iiLabel = ref.iiLevel === "low" ? "低 II" : ref.iiLevel === "medium" ? "中 II" : ref.iiLevel === "high" ? "高 II" : "II 未知";
    return `${ref.item}≈${ref.food}：GI ${ref.gi}，GL ${ref.gl}（${glLabel}），II ${ref.insulinIndex}（${iiLabel}）。${ref.note}`;
  });
}

function buildMealSummary(rules) {
  return `这餐主食风险为${rules.carbRisk}；建议按实际摄入量确认米饭份量，优先先吃菜和蛋白、最后吃主食，必要时把 1/3 白米饭换成杂粮/杂豆。`;
}

function fallbackMealSwaps(rules) {
  const swaps = [
    "先吃菜和蛋白、最后吃主食；如果主食偏精细，把 1/3 白米饭换成杂粮/杂豆。",
    "主食按小半碗到一拳起步，根据饱腹感和餐后状态调整。",
    "餐后 15–30 分钟内轻松步行 15 分钟，观察餐后反应。",
  ];
  if (rules.structure_scores.oil_sauce === "medium" || rules.structure_scores.oil_sauce === "high") {
    swaps.unshift("番茄蛋和炒菜汤汁少拌饭，减少额外油脂和汤汁带来的波动。");
  }
  if (rules.structure_scores.shared_table) {
    swaps.unshift("这是共享餐桌估计，记录时请按自己实际吃掉的份量调整。");
  }
  return swaps;
}

function normalizeLabelOcr(payload) {
  const nutrition = payload?.nutrition_per_100 && typeof payload.nutrition_per_100 === "object" ? payload.nutrition_per_100 : {};
  return {
    product_name: cleanText(payload?.product_name) || "食品配料表",
    category: cleanText(payload?.category) || "未识别",
    ingredients: Array.isArray(payload?.ingredients)
      ? payload.ingredients
          .map((item, index) => ({
            rank: Number.isFinite(Number(item.rank)) ? Number(item.rank) : index + 1,
            name: cleanText(item.name || item.raw),
            raw: cleanText(item.raw || item.name),
            role: normalizeIngredientRole(item.role, item.name || item.raw),
          }))
          .filter((item) => item.name)
          .sort((a, b) => a.rank - b.rank)
      : [],
    nutrition_per_100: {
      basis: ["100ml", "100g", "serving", "unknown"].includes(nutrition.basis) ? nutrition.basis : "unknown",
      energy_kj: numericOrNull(nutrition.energy_kj),
      protein_g: numericOrNull(nutrition.protein_g),
      fat_g: numericOrNull(nutrition.fat_g),
      carbohydrate_g: numericOrNull(nutrition.carbohydrate_g),
      sugar_g: numericOrNull(nutrition.sugar_g),
      fiber_g: numericOrNull(nutrition.fiber_g),
      sodium_mg: numericOrNull(nutrition.sodium_mg),
    },
    claims: toTextArray(payload?.claims),
    notes: toTextArray(payload?.notes),
  };
}

function normalizeIngredientRole(role, name) {
  const value = cleanText(role);
  if (["base", "plant", "added_sugar", "sweetener", "refined_carb", "fat", "protein", "fiber", "vitamin_mineral", "additive"].includes(value)) {
    return value;
  }
  if (matchesAny(name, labelIngredientKnowledge.addedSugar)) return "added_sugar";
  if (matchesAny(name, labelIngredientKnowledge.refinedCarb)) return "refined_carb";
  if (matchesAny(name, labelIngredientKnowledge.sweetener)) return "sweetener";
  if (matchesAny(name, labelIngredientKnowledge.saturatedFat)) return "fat";
  if (matchesAny(name, labelIngredientKnowledge.protein)) return "protein";
  if (matchesAny(name, labelIngredientKnowledge.fiber)) return "fiber";
  if (/维生素|矿物质|钙|铁|锌|钠/i.test(name || "")) return "vitamin_mineral";
  if (/酸钠|碳酸|色素|香精|防腐|稳定剂|乳化剂/i.test(name || "")) return "additive";
  if (/叶|花|草|茶|果|植物/i.test(name || "")) return "plant";
  return "unknown";
}

function buildLabelRules(labelOcr) {
  const ingredients = labelOcr.ingredients;
  const nutrition = labelOcr.nutrition_per_100;
  const sugarHits = findIngredientHits(ingredients, labelIngredientKnowledge.addedSugar);
  const refinedHits = findIngredientHits(ingredients, labelIngredientKnowledge.refinedCarb);
  const sweetenerHits = findIngredientHits(ingredients, labelIngredientKnowledge.sweetener);
  const fatHits = findIngredientHits(ingredients, labelIngredientKnowledge.saturatedFat);
  const fiberHits = findIngredientHits(ingredients, labelIngredientKnowledge.fiber);
  const proteinHits = findIngredientHits(ingredients, labelIngredientKnowledge.protein);
  const additiveItems = ingredients.filter((item) => item.role === "additive" || item.role === "vitamin_mineral");
  const sugar = nutrition.sugar_g;
  const carbs = nutrition.carbohydrate_g;
  const energy = nutrition.energy_kj;
  const sodium = nutrition.sodium_mg;
  const basis = nutrition.basis === "100ml" ? "100ml" : nutrition.basis === "100g" ? "100g" : "每份/未标明";
  const isDrink = /饮料|水|茶|咖啡|奶|汁/i.test(`${labelOcr.product_name}${labelOcr.category}`) || nutrition.basis === "100ml";

  const positives = [];
  const concerns = [];
  const trafficLights = [];
  let riskScore = 0;

  if (!sugarHits.length) positives.push("配料表未见白砂糖、果葡糖浆、蜂蜜等添加糖。");
  if (Number.isFinite(sugar) && sugar === 0) positives.push(`${basis} 糖 0g，比含糖饮料或甜点更适合作为控糖替代。`);
  if (Number.isFinite(carbs) && carbs === 0) positives.push(`${basis} 碳水化合物 0g，餐后血糖负担很低。`);
  if (Number.isFinite(energy) && energy === 0) positives.push(`${basis} 能量 0kJ，不会额外增加能量摄入。`);
  if (Number.isFinite(sodium) && sodium <= 120) positives.push(`${basis} 钠 ${sodium}mg，钠负担较低。`);
  if (fiberHits.length) positives.push(`配料中看到 ${fiberHits.map((item) => item.name).join("、")}，对饱腹感更友好。`);
  if (proteinHits.length) positives.push(`配料中看到 ${proteinHits.map((item) => item.name).join("、")}，蛋白质来源更明确。`);

  if (sugarHits.length) {
    const firstSugar = Math.min(...sugarHits.map((item) => item.rank));
    riskScore += firstSugar <= 3 ? 4 : 2;
    concerns.push(`添加糖相关配料出现在第 ${firstSugar} 位附近，越靠前越需要少买少吃。`);
  }
  if (Number.isFinite(sugar) && sugar >= (isDrink ? 5 : 10)) {
    riskScore += 4;
    concerns.push(`${basis} 糖 ${sugar}g，属于餐后波动重点关注项。`);
  }
  if (Number.isFinite(carbs) && carbs >= (isDrink ? 8 : 20)) {
    riskScore += 2;
    concerns.push(`${basis} 碳水 ${carbs}g，需要结合份量和进食场景控制。`);
  }
  if (refinedHits.length) {
    riskScore += 2;
    concerns.push(`含 ${refinedHits.map((item) => item.name).join("、")} 等精制碳水来源，饱腹感和餐后稳定性通常不如全谷物。`);
  }
  if (fatHits.length) {
    riskScore += 2;
    concerns.push(`含 ${fatHits.map((item) => item.name).join("、")}，需要关注饱和脂肪或反式脂肪风险。`);
  }
  if (Number.isFinite(sodium) && sodium > (isDrink ? 120 : 300)) {
    riskScore += sodium > 600 ? 3 : 1;
    concerns.push(`${basis} 钠 ${sodium}mg，钠摄入需要留意。`);
  }
  if (sweetenerHits.length) concerns.push(`含 ${sweetenerHits.map((item) => item.name).join("、")} 等甜味剂，可替代糖，但不建议因此放大饮用量。`);
  if (additiveItems.length) concerns.push(`含 ${additiveItems.map((item) => item.name).slice(0, 4).join("、")} 等功能或添加成分，不等于有控糖功效。`);
  if (!proteinHits.length && (!Number.isFinite(nutrition.protein_g) || nutrition.protein_g === 0)) concerns.push("蛋白质不突出，不能当作有饱腹感的加餐。");
  if (!fiberHits.length && (!Number.isFinite(nutrition.fiber_g) || nutrition.fiber_g === 0)) concerns.push("膳食纤维不突出，对延缓吸收的帮助有限。");

  trafficLights.push(buildLabelTraffic("添加糖", sugarHits.length ? sugarHits.map((item) => item.name).join("、") : "配料表未见", sugarHits.length ? "bad" : "good", sugarHits.length ? "添加糖越靠前越不适合常买。" : "优于含糖饮料、糖果和甜点。"));
  trafficLights.push(buildLabelTraffic("糖/碳水", nutritionValueText(sugar, "g 糖", basis, carbs, "g 碳水"), metricStatus("sugar_carb", Math.max(sugar || 0, carbs || 0), isDrink), "看营养成分表，不只看正面宣传。"));
  trafficLights.push(buildLabelTraffic("钠", Number.isFinite(sodium) ? `${basis} ${sodium}mg` : "未识别", metricStatus("sodium", sodium, isDrink), "饮料钠通常不应成为主要负担。"));
  trafficLights.push(buildLabelTraffic("饱腹营养", proteinHits.length || fiberHits.length ? [...proteinHits, ...fiberHits].map((item) => item.name).join("、") : "蛋白质/膳食纤维不突出", proteinHits.length || fiberHits.length ? "good" : "watch", "加餐更看重蛋白质和膳食纤维。"));
  trafficLights.push(buildLabelTraffic("配料复杂度", ingredients.length ? `${ingredients.length} 项配料` : "未识别", additiveItems.length || sweetenerHits.length ? "watch" : "good", "草本/功能成分不等于控糖功效或医疗效果。"));

  let purchaseLabel = "适合常买";
  let purchaseAdvice = "更适合";
  if (riskScore >= 4) {
    purchaseLabel = "不建议常买";
    purchaseAdvice = "建议替换";
  } else if (riskScore >= 2 || concerns.length > positives.length + 1) {
    purchaseLabel = "偶尔少量";
    purchaseAdvice = "需控制";
  }

  return {
    product_name: labelOcr.product_name,
    category: labelOcr.category,
    purchase_label: purchaseLabel,
    purchaseAdvice,
    riskScore,
    basis,
    positives: positives.slice(0, 5),
    concerns: dedupeText(concerns).slice(0, 6),
    traffic_lights: trafficLights,
    alternatives: fallbackLabelAlternatives(labelOcr, riskScore),
    use_tips: fallbackLabelUseTips(labelOcr, purchaseLabel, isDrink),
    boundary: buildLabelBoundary(labelOcr, purchaseLabel),
    ocr: labelOcr,
    knowledge_version: `${labelKnowledgeVersion}+${nutritionKnowledgeVersion}`,
  };
}

function buildLabelNarrativeMessages({ labelOcr, rules }) {
  const prompt = [
    "下面是食品标签 OCR 和后端规则判断。请只基于这些数据生成糖尿病前期用户能看懂的购买建议。",
    "要求：不要说治疗、降糖、逆转；不要说完全不会引起血糖波动；植物成分只能作为配料事实，不得宣传功效。",
    "输出严格 JSON：",
    `{"title":"","summary":"","purchase_label":"适合常买|偶尔少量|不建议常买","positives":[],"concerns":[],"use_tips":[],"alternatives":[],"boundary":""}`,
    `OCR=${JSON.stringify(labelOcr)}`,
    `RULES=${JSON.stringify(rules)}`,
  ].join("\n");
  return [
    {
      role: "system",
      content: "你是糖尿病前期生活方式食品标签分析助手。只输出 JSON 对象，建议要克制、可执行、避免医疗承诺。",
    },
    { role: "user", content: prompt },
  ];
}

function normalizeStructuredLabel(parsed, labelOcr, rules, sample) {
  const purchaseLabel = ["适合常买", "偶尔少量", "不建议常买"].includes(parsed.purchase_label) ? parsed.purchase_label : rules.purchase_label;
  const purchaseAdvice = parsed.purchaseAdvice || rules.purchaseAdvice || labelAdviceFromLabel(purchaseLabel);
  const positives = labelTextArray(parsed.positives).length ? labelTextArray(parsed.positives) : rules.positives;
  const concerns = labelTextArray(parsed.concerns).length ? labelTextArray(parsed.concerns) : rules.concerns;
  const useTips = labelTextArray(parsed.use_tips).length ? labelTextArray(parsed.use_tips) : rules.use_tips;
  const alternatives = labelTextArray(parsed.alternatives).length ? labelTextArray(parsed.alternatives) : rules.alternatives;
  const title = sanitizeLabelCopy(parsed.title) || `${rules.product_name}配料表分析`;
  const summary = sanitizeLabelCopy(parsed.summary) || buildLabelRuleSummary(rules);
  const boundary = sanitizeLabelCopy(parsed.boundary) || rules.boundary;

  return {
    title,
    summary,
    risk_level: purchaseLabel === "不建议常买" ? "orange" : purchaseLabel === "偶尔少量" ? "yellow" : "green",
    confidence: "high",
    result: {
      purchaseAdvice,
      purchase_label: purchaseLabel,
      score: rules.riskScore,
      product: {
        name: rules.product_name,
        category: rules.category,
      },
      ingredients: labelOcr.ingredients,
      nutrition: labelOcr.nutrition_per_100,
      traffic_lights: rules.traffic_lights,
      positives: positives.slice(0, 5),
      concerns: dedupeText(concerns).slice(0, 6),
      use_tips: useTips.slice(0, 5),
      reasons: dedupeText(concerns.length ? concerns : positives).slice(0, 4),
      alternatives: alternatives.slice(0, 5),
      boundary,
      knowledge_version: rules.knowledge_version,
      medical_boundary: "配料表分析用于购物和加餐选择参考，不替代医生或营养师的个体化建议。",
      ai_source: "structured_label_pipeline",
    },
  };
}

function buildLabelRuleNarrative(rules) {
  return {
    title: `${rules.product_name}配料表分析`,
    summary: buildLabelRuleSummary(rules),
    purchase_label: rules.purchase_label,
    positives: rules.positives,
    concerns: rules.concerns,
    use_tips: rules.use_tips,
    alternatives: rules.alternatives,
    boundary: rules.boundary,
  };
}

function labelTextArray(value) {
  return toTextArray(value).map(sanitizeLabelCopy).filter(Boolean);
}

function sanitizeLabelCopy(value) {
  return cleanText(value)
    .replace(/完全不会引起血糖波动/g, "餐后血糖负担较低")
    .replace(/不会引起血糖波动/g, "餐后血糖负担较低")
    .replace(/治疗作用|降糖效果|降糖作用|辅助降糖/g, "控糖功效")
    .replace(/治疗或降糖/g, "控糖");
}

function buildLabelRuleSummary(rules) {
  if (rules.purchase_label === "适合常买") {
    return "这款食品的添加糖和糖/碳水负担较低，可作为更稳的替代选择；但不要把功能配料理解为控糖功效。";
  }
  if (rules.purchase_label === "偶尔少量") {
    return "这款食品有部分需要留意的配料或营养成分，更适合偶尔少量，不建议作为每天固定加餐。";
  }
  return "这款食品存在较明确的添加糖、精制碳水或高钠/高脂信号，不建议常买，建议换成更低糖、更高蛋白或更高纤维的选择。";
}

function fallbackLabelAlternatives(labelOcr, riskScore) {
  const isDrink = /饮料|水|茶|汁|奶/i.test(`${labelOcr.product_name}${labelOcr.category}`);
  if (riskScore >= 4) {
    return isDrink ? ["无糖茶或白水", "无糖气泡水", "原味无糖酸奶"] : ["原味坚果小把", "无糖酸奶", "鸡蛋/豆制品等高蛋白加餐"];
  }
  return isDrink ? ["白水和淡茶仍放在第一位", "想喝饮料时优先选 0 糖 0 能量款"] : ["优先选短配料表、低糖、高蛋白或高纤维版本"];
}

function fallbackLabelUseTips(labelOcr, purchaseLabel, isDrink) {
  if (purchaseLabel === "适合常买") {
    return isDrink
      ? ["可以替代含糖饮料，但日常补水仍以白水为主。", "不要因为 0 糖 0 能量就长期大量替代饮水。", "肠胃敏感时避免空腹大量饮用。"]
      : ["可以作为更稳的加餐选择，但仍按包装份量控制。"];
  }
  if (purchaseLabel === "偶尔少量") return ["更适合放在正餐后少量吃，避免空腹当加餐。", "吃完观察个人餐后反应，不作为每天固定选择。"];
  return ["不作为常备零食或饮料。", "已经买了也尽量小份量、随餐、少频次。"];
}

function buildLabelBoundary(labelOcr, purchaseLabel) {
  if (purchaseLabel === "适合常买") return "可以作为含糖饮料或高糖零食的替代，但不代表有控糖功效或医疗效果。";
  if (purchaseLabel === "偶尔少量") return "偶尔少量可以，尽量不要作为每日固定加餐或夜间零食。";
  return "不建议常买；如已经购买，建议小份量、低频次，并优先替换为无糖、高蛋白或高纤维选择。";
}

function buildLabelTraffic(label, value, status, note) {
  return { label, value, status, note };
}

function nutritionValueText(primary, primaryUnit, basis, secondary, secondaryUnit) {
  const main = Number.isFinite(primary) ? `${basis} ${primary}${primaryUnit}` : "未识别";
  if (!Number.isFinite(secondary)) return main;
  return `${main} / ${secondary}${secondaryUnit}`;
}

function metricStatus(type, value, isDrink) {
  if (!Number.isFinite(value)) return "watch";
  if (type === "sugar_carb") {
    if (value === 0) return "good";
    if (value >= (isDrink ? 5 : 10)) return "bad";
    return "watch";
  }
  if (type === "sodium") {
    if (value <= (isDrink ? 120 : 300)) return "good";
    if (value > (isDrink ? 240 : 600)) return "bad";
    return "watch";
  }
  return "watch";
}

function labelAdviceFromLabel(label) {
  if (label === "适合常买") return "更适合";
  if (label === "不建议常买") return "建议替换";
  return "需控制";
}

function findIngredientHits(ingredients, terms) {
  return ingredients.filter((item) => matchesAny(item.name, terms) || matchesAny(item.raw, terms));
}

function matchesAny(value, terms) {
  const text = cleanText(value).toLowerCase();
  return terms.some((term) => text.includes(term.toLowerCase()));
}

function numericOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dedupeText(items) {
  return [...new Set(toTextArray(items))];
}

function buildReportFields(rows, rules) {
  const fields = rows.map((row) => ({
    label: labelForRow(row),
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

function buildStandardComparison(rows, rules) {
  const labRef = (analyte, time) => rows.find((row) => row.analyte === analyte && row.time === time)?.reference || "";
  const comparisons = [];
  if (Number.isFinite(rules.glucose.fasting)) {
    comparisons.push({
      indicator: "空腹血糖",
      value: `${rules.glucose.fasting} mmol/L`,
      standard: "ADA/CDC：<5.6 正常；5.6-6.9 糖前期；>=7.0 糖尿病阈值",
      lab_reference: labRef("glucose", "fasting"),
      judgement: judgementText(rules.flags.fasting_glucose),
      note: "空腹血糖是标准筛查点，需结合检测条件和医生判断。",
    });
  }
  if (Number.isFinite(rules.glucose.h2)) {
    comparisons.push({
      indicator: "OGTT 2h 血糖",
      value: `${rules.glucose.h2} mmol/L`,
      standard: "ADA/CDC：<7.8 正常；7.8-11.0 糖前期；>=11.1 糖尿病阈值",
      lab_reference: labRef("glucose", "2h"),
      judgement: judgementText(rules.flags.two_hour_ogtt),
      note: "2h 是 OGTT 糖耐量判断的核心时间点。",
    });
  }
  if (Number.isFinite(rules.glucose.h1)) {
    comparisons.push({
      indicator: "OGTT 1h 血糖",
      value: `${rules.glucose.h1} mmol/L`,
      standard: "非 ADA/CDC 糖前期诊断点；部分 1h OGTT 共识用 >=8.6 作为高风险观察切点",
      lab_reference: labRef("glucose", "1h"),
      judgement: rules.flags.one_hour_glucose === "high_post_load_signal_not_diagnostic" ? "观察偏高" : "未达观察切点",
      note: "只作为餐后早期波动信号，不能单独判定糖耐量异常。",
    });
  }
  if (Number.isFinite(rules.glucose.h3)) {
    const delta = rules.derived.curve?.glucose_3h_minus_fasting;
    comparisons.push({
      indicator: "OGTT 3h 血糖",
      value: `${rules.glucose.h3} mmol/L`,
      standard: "非标准诊断点，主要看是否向空腹水平回落",
      lab_reference: labRef("glucose", "3h"),
      judgement: Number.isFinite(delta) && delta > 1 ? "回落偏慢" : "回落尚可",
      note: Number.isFinite(delta) ? `比空腹高 ${delta} mmol/L，适合做趋势观察。` : "适合结合曲线形态观察。",
    });
  }
  if (Number.isFinite(rules.hba1c)) {
    comparisons.push({
      indicator: "HbA1c",
      value: `${rules.hba1c}%`,
      standard: "ADA/CDC：<5.7 正常；5.7-6.4 糖前期；>=6.5 糖尿病阈值",
      lab_reference: labRef("hba1c", "unknown"),
      judgement: judgementText(rules.flags.hba1c),
      note: "反映近 2-3 个月平均血糖，受贫血、HbF 等因素影响。",
    });
  }
  if (rules.derived.homa_ir) {
    const value =
      rules.derived.homa_ir.low === rules.derived.homa_ir.high
        ? String(rules.derived.homa_ir.value)
        : `${rules.derived.homa_ir.low}-${rules.derived.homa_ir.high}`;
    comparisons.push({
      indicator: "HOMA-IR",
      value,
      standard: "常见研究切点约 <2.0 或 <2.5；不同人群和检测方法差异较大",
      lab_reference: "",
      judgement: rules.flags.homa_ir === "elevated_by_common_cutoffs" ? "需关注" : "未达常见偏高切点",
      note: rules.derived.homa_ir.note,
    });
  }
  return comparisons;
}

function buildCurveRows(rules) {
  const labels = [
    ["fasting", "空腹"],
    ["h1", "1h"],
    ["h2", "2h"],
    ["h3", "3h"],
  ];
  return labels
    .map(([key, label]) => ({
      time: label,
      glucose: formatMaybe(rules.glucose[key], "mmol/L"),
      insulin: formatMaybe(rules.insulin_raw.values[key], rules.insulin_raw.unit),
      insulin_ratio: key === "fasting" ? "1.0x" : formatRatio(rules.derived.insulin_ratio[key]),
      c_peptide: formatMaybe(rules.c_peptide_raw.values[key], rules.c_peptide_raw.unit),
      c_peptide_ratio: key === "fasting" ? "1.0x" : formatRatio(rules.derived.c_peptide_ratio[key]),
    }))
    .filter((row) => row.glucose || row.insulin || row.c_peptide);
}

function buildDerivedIndicators(rules) {
  const items = [];
  const curve = rules.derived.curve || {};
  if (rules.derived.homa_ir) {
    const homa = rules.derived.homa_ir;
    items.push({
      label: "HOMA-IR",
      value: homa.low === homa.high ? String(homa.value) : `${homa.low}-${homa.high}`,
      note: homa.note,
    });
  }
  if (curve.glucose_peak) {
    items.push({ label: "血糖峰值", value: `${curve.glucose_peak.label} ${curve.glucose_peak.value} mmol/L`, note: "用于观察峰值是否前移和是否顺利回落。" });
  }
  if (curve.insulin_peak) {
    items.push({ label: "胰岛素峰值", value: `${curve.insulin_peak.label} ${curve.insulin_peak.value} ${rules.insulin_raw.unit}`, note: "与血糖峰值一起看分泌时机。" });
  }
  if (curve.c_peptide_peak) {
    items.push({ label: "C肽峰值", value: `${curve.c_peptide_peak.label} ${curve.c_peptide_peak.value} ${rules.c_peptide_raw.unit}`, note: "C肽更能反映内源性分泌趋势。" });
  }
  if (curve.recovery_note) {
    items.push({ label: "3h 回落", value: "趋势观察", note: curve.recovery_note });
  }
  return items;
}

function buildProfessionalAdvice(rules) {
  const advice = [];
  if (rules.flags.fasting_glucose === "normal" && rules.flags.two_hour_ogtt === "normal") {
    advice.push("标准筛查点目前未达糖前期常用切点，重点不是紧张单次结果，而是把本次作为后续趋势基线。");
  } else {
    advice.push("标准筛查点出现异常时，应带原始报告给医生确认，并结合 HbA1c、家族史、腰围和用药情况判断。");
  }
  if (Number.isFinite(rules.derived.curve?.glucose_3h_minus_fasting) && rules.derived.curve.glucose_3h_minus_fasting > 1) {
    advice.push("3h 血糖仍高于空腹超过 1 mmol/L，后续可重点记录晚餐主食份量、进餐顺序、餐后活动与 3h 主观状态。");
  }
  if (Number.isFinite(rules.derived.curve?.insulin_3h_to_fasting_ratio) && rules.derived.curve.insulin_3h_to_fasting_ratio > 1.5) {
    advice.push("3h 胰岛素仍为空腹的较高倍数，建议下一次复查保持同样空腹时长、前 3 天饮食和运动条件，避免把条件差异误当成趋势。");
  }
  if (!Number.isFinite(rules.hba1c)) {
    advice.push("这张图没有 HbA1c，若要评估近 2-3 个月平均血糖，可在医生建议下补充 HbA1c，并和 OGTT 一起看。");
  }
  advice.push("日常行动优先做低风险实验：主食后置、每餐保留蛋白和蔬菜、餐后 10-20 分钟轻活动，再观察餐后困倦、饥饿和下次检测趋势。");
  return advice;
}

function judgementText(flag) {
  if (flag === "normal") return "正常";
  if (flag === "prediabetes_threshold") return "达到糖前期筛查切点";
  if (flag === "diabetes_threshold") return "达到糖尿病筛查切点";
  if (flag === "missing") return "未识别";
  return "观察";
}

function formatMaybe(value, unit) {
  if (!Number.isFinite(value)) return "";
  return `${value}${unit ? ` ${unit}` : ""}`;
}

function formatRatio(value) {
  return Number.isFinite(value) ? `${value}x` : "";
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
