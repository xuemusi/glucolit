const app = document.querySelector("#app");
const registerDialog = document.querySelector("#registerDialog");
const registerForm = document.querySelector("#registerForm");
const registerError = document.querySelector("#registerError");
const phoneInput = document.querySelector("#phoneInput");
const resetUser = document.querySelector("#resetUser");
const navButtons = [...document.querySelectorAll(".nav-button")];

const state = {
  view: "home",
  user: JSON.parse(localStorage.getItem("glucolit:user") || "null"),
  sessionToken: localStorage.getItem("glucolit:session"),
  appState: null,
  selectedTool: "report",
  toolState: {
    report: createToolState(),
    meal: createToolState(),
    label: createToolState(),
  },
  selectedContent: null,
};

function createToolState() {
  return {
    latestAnalysis: null,
    latestAnalysisMeta: null,
    selectedFileName: "",
    selectedImagePreview: "",
    streamText: "",
    streamStatus: "",
    loading: false,
  };
}

function currentToolState() {
  return toolState(state.selectedTool);
}

function toolState(type) {
  if (!state.toolState[type]) state.toolState[type] = createToolState();
  return state.toolState[type];
}

const statusLabels = {
  attention: "需留意",
  responded: "已处理",
  completed: "今日已完成",
};

const toolLabels = {
  report: "报告解读",
  meal: "餐盘分析",
  label: "配料表分析",
};

const categoryOrder = ["diet", "sleep", "exercise", "stress", "energy"];
const actionContext = {
  diet: {
    source: "来自餐后峰值偏高",
    rationale: "先调整主食份量和进食顺序，减少今晚餐后波动压力。",
    fallback: "做不到时，只先把主食留到蔬菜和蛋白后面吃。",
  },
  sleep: {
    source: "来自昨晚睡眠不足",
    rationale: "睡眠不足会影响第二天胰岛素敏感性，今晚先把入睡时间拉回稳定区间。",
    fallback: "做不到早睡时，先完成睡前 10 分钟离屏。",
  },
  exercise: {
    source: "来自餐后峰值偏高 + 连续 3 天未完成饭后步行",
    rationale: "饭后轻活动是今天最直接的低风险干预，先完成它再看其他任务。",
    fallback: "做不到 15-20 分钟时，饭后先走 8 分钟也算完成降级版。",
  },
  stress: {
    source: "来自压力状态偏紧绷",
    rationale: "短呼吸练习能降低今晚继续靠零食或刷屏缓解压力的概率。",
    fallback: "做不到 3 分钟时，先做 6 次慢呼吸。",
  },
  energy: {
    source: "来自下午精力偏低",
    rationale: "下午困倦时更容易选择含糖饮料，先准备一个替代选择。",
    fallback: "做不到完全替换时，先把含糖饮料减半。",
  },
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "请求失败");
  }
  return data;
}

async function analyzeApi(body, tool = body.type || state.selectedTool) {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      accept: "text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "请求失败");
  }

  if (!contentType.includes("text/event-stream")) {
    const data = await response.json();
    applyAnalysisResult(data, tool);
    return;
  }

  await readAnalysisStream(response, tool);
}

async function readAnalysisStream(response, tool) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const slot = toolState(tool);

  const handleBlock = (block) => {
    let event = "message";
    const dataLines = [];
    block.split("\n").forEach((rawLine) => {
      const line = rawLine.trimEnd();
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    });
    if (!dataLines.length) return;

    const payload = JSON.parse(dataLines.join("\n"));
    if (event === "meta") {
      slot.latestAnalysisMeta = { fallback: payload.fallback, model: payload.model, thinking: payload.thinking };
      slot.streamStatus = "正在看清图片里的关键信息";
      updateStreamOutput(tool);
    }
    if (event === "token") {
      slot.streamText += payload.content || "";
      slot.streamStatus = "正在整理成你能直接用的建议";
      updateStreamOutput(tool);
    }
    if (event === "fallback") {
      slot.streamStatus = payload.message ? "图片信息不够稳定，先给你一份参考建议" : "先给你一份参考建议";
      updateStreamOutput(tool);
    }
    if (event === "done") {
      applyAnalysisResult(payload, tool);
      updateStreamOutput(tool);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";
    blocks.forEach(handleBlock);
  }
  if (buffer.trim()) handleBlock(buffer);
}

function applyAnalysisResult(data, tool = data.analysis?.type || state.selectedTool) {
  const slot = toolState(tool);
  slot.latestAnalysis = data.analysis;
  slot.latestAnalysisMeta = { fallback: data.fallback, model: data.model, model_error: data.model_error };
  slot.streamStatus = data.fallback ? "已整理参考建议" : "建议已生成";
  slot.streamText = "";
}

function saveSession(data) {
  state.user = data.user;
  state.sessionToken = data.session_token;
  localStorage.setItem("glucolit:user", JSON.stringify(data.user));
  localStorage.setItem("glucolit:session", data.session_token);
}

async function loadAppState() {
  if (!state.user) return;
  state.appState = await api(`/api/app-state?user_id=${encodeURIComponent(state.user.id)}`);
}

function setView(view) {
  state.view = view;
  if (view !== "content") state.selectedContent = null;
  navButtons.forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  render();
}

function boundary() {
  return `<p class="medical-boundary">本产品用于健康教育与生活方式行为支持，不替代医生诊断和治疗。如报告指标异常或身体不适，请及时咨询专业医生。</p>`;
}

function render() {
  if (!state.user) {
    app.innerHTML = `<section class="stack"><div class="hero-card"><p class="eyebrow">Welcome</p><h2>把异常指标变成今天能做到的一小步</h2><p class="muted">输入手机号后开始保存你的记录。</p></div></section>`;
    if (!registerDialog.open) registerDialog.showModal();
    return;
  }

  const views = {
    home: renderHome,
    tools: renderTools,
    actions: renderActions,
    profile: renderProfile,
    companion: renderCompanion,
    content: renderContent,
  };
  app.innerHTML = views[state.view]();
  bindViewEvents();
}

function renderHome() {
  const data = state.appState;
  if (!data) return loadingMarkup();
  const daily = data.dailyState;
  const metrics = daily.metrics;
  const statusClass = daily.status === "completed" ? " completed" : "";

  return `
    <section class="stack">
      <div class="focus-card">
        <div class="hero-top">
          <div>
            <p class="eyebrow">今日健康概览</p>
            <h2>早上好，今天稳一点</h2>
          </div>
          <span class="status-pill${statusClass}">${statusLabels[daily.status]}</span>
        </div>
        <div class="wellness-score">
          <div class="score-ring" aria-label="今日状态 82 分">
            <strong>82</strong>
            <span>稳住节奏</span>
          </div>
          <div>
            <p class="focus-copy">餐后峰值偏高叠加睡眠不足。今晚先完成饭后 15-20 分钟步行，不需要重启完整计划。</p>
            <div class="soft-checks" aria-label="今日记录摘要">
              <span>饮食 2/3 记录</span>
              <span>睡眠 7.2 小时</span>
              <span>运动 30 分钟</span>
            </div>
          </div>
        </div>
        <div class="focus-chart" aria-label="餐后血糖趋势">
          <svg viewBox="0 0 320 126" role="img" aria-label="餐后血糖趋势">
            <path class="focus-band" d="M0 72 H320 V102 H0 Z"></path>
            <path class="focus-line" d="M16 86 C62 78, 86 42, 126 44 S192 92, 234 76 S284 55, 306 62"></path>
            <circle class="focus-point coral" cx="126" cy="44" r="6"></circle>
            <circle class="focus-point amber" cx="234" cy="76" r="6"></circle>
            <circle class="focus-point mint" cx="306" cy="62" r="6"></circle>
          </svg>
        </div>
        <div class="signal-row">
          <div><span>餐后峰值</span><strong>${metrics.glucoseTrend[1].value}</strong><small>mmol/L</small></div>
          <div><span>睡眠</span><strong>${metrics.sleepHours}</strong><small>小时</small></div>
          <div><span>未打卡</span><strong>${metrics.missedCheckinDays}</strong><small>天</small></div>
        </div>
      </div>
      <div class="card">
        <div class="panel-header">
          <h2>今日提醒</h2>
          <button class="ghost-button" data-go="actions" type="button">去打卡</button>
        </div>
        <ul class="warning-list">
          ${buildHomeReminders(daily.reasons)
            .map((item) => `<li><strong>${escapeHtml(item.signal)}</strong><span>影响：${escapeHtml(item.impact)}</span><em>建议：${escapeHtml(item.action)}</em></li>`)
            .join("")}
        </ul>
      </div>

      <div class="card stack">
        <div class="panel-header">
          <h2>拍照分析</h2>
          <span class="tag">报告 / 餐盘 / 配料表</span>
        </div>
        <div class="scan-grid">
          <button class="scan-card" type="button" data-tool-shortcut="report"><strong>报告</strong><span>OGTT / HbA1c</span></button>
          <button class="scan-card" type="button" data-tool-shortcut="meal"><strong>餐盘</strong><span>主食和结构</span></button>
          <button class="scan-card" type="button" data-tool-shortcut="label"><strong>配料表</strong><span>添加糖和替换</span></button>
        </div>
      </div>

      <div class="card stack">
        <h2>压力 / 精力</h2>
        ${choiceGroup("stress", ["放松", "有点紧", "压力高"], daily.stress_state)}
        ${choiceGroup("energy", ["有劲", "一般", "疲惫"], daily.energy_state)}
      </div>

      <div class="card">
        <h2>最近记录</h2>
        <ul class="recent-list">
          ${renderRecentAnalysisItems(data.recentAnalysis)}
        </ul>
      </div>
      ${boundary()}
    </section>
  `;
}

function buildHomeReminders(reasons = []) {
  const fallbacks = [
    {
      impact: "餐后回落可能变慢，晚间更容易疲惫。",
      action: "晚餐主食少 1/3，饭后 15-20 分钟轻走。",
    },
    {
      impact: "第二天胰岛素敏感性可能下降，空腹状态更容易波动。",
      action: "23:30 前上床，睡前 30 分钟不刷短视频。",
    },
    {
      impact: "连续记录变少后，更难判断哪些行动真的有效。",
      action: "今天只补一个 8 分钟轻量版本也算完成。",
    },
  ];

  return reasons.map((reason, index) => {
    if (/睡眠|熬夜/.test(reason)) {
      return {
        signal: reason,
        impact: "睡眠不足会影响第二天餐后恢复和精力。",
        action: "今晚先把上床时间提前 20 分钟，睡前 30 分钟停屏。",
      };
    }
    if (/未完成|未打卡|步行|连续/.test(reason)) {
      return {
        signal: reason,
        impact: "饭后活动中断后，餐后峰值更容易停留久一点。",
        action: "今天做降级版：饭后轻走 8-10 分钟，完成一件即可。",
      };
    }
    if (/餐后|晚餐|血糖|波动/.test(reason)) {
      return {
        signal: reason,
        impact: "晚餐后的波动会影响夜间恢复，也会影响第二天空腹状态。",
        action: "晚餐先吃蔬菜和蛋白，主食少 1/3，饭后轻走 15 分钟。",
      };
    }
    const fallback = fallbacks[index % fallbacks.length];
    return { signal: reason, ...fallback };
  });
}

function renderRecentAnalysisItems(items = []) {
  if (!items.length) {
    return `<li><strong>还没有识别记录</strong><span class="small recent-summary">可以先上传报告、餐盘或配料表，生成第一条记录。</span></li>`;
  }
  return items
    .map((item) => {
      const typeLabel = toolLabels[item.type] || "分析";
      const time = formatDateTime(item.created_at);
      return `
        <li>
          <div class="recent-topline">
            <span class="tag">${escapeHtml(typeLabel)}</span>
            <span>${escapeHtml(time)}</span>
          </div>
          <strong>${escapeHtml(item.title)}</strong>
          <span class="small recent-summary">${escapeHtml(item.summary)}</span>
          <button class="text-link" type="button" data-record-id="${escapeHtml(item.id)}">查看详情</button>
        </li>
      `;
    })
    .join("");
}

function formatDateTime(value) {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function choiceGroup(kind, options, active) {
  return `
    <div class="choice-grid" data-choice="${kind}">
      ${options.map((option) => `<button class="choice-button${option === active ? " active" : ""}" type="button" data-value="${option}">${option}</button>`).join("")}
    </div>
  `;
}

function renderTools() {
  const slot = currentToolState();
  return `
    <section class="stack">
      <div class="hero-card tool-hero">
        <p class="eyebrow">AI 工具</p>
        <h2>${toolLabels[state.selectedTool]}</h2>
        <p class="muted">${toolIntro(state.selectedTool)}</p>
      </div>
      <div class="tool-tabs">
        ${Object.entries(toolLabels)
          .map(([type, label]) => `<button class="tab-button${state.selectedTool === type ? " active" : ""}" type="button" data-tool="${type}">${label}</button>`)
          .join("")}
      </div>
      <div class="scanner-panel stack">
        <div class="panel-header">
          <h2>${scannerTitle(state.selectedTool)}</h2>
          <span class="risk-pill">${scannerStateLabel()}</span>
        </div>
        <div class="scanner-frame${slot.selectedImagePreview ? " has-preview" : ""}">
          <div class="scanner-line"></div>
          ${slot.selectedImagePreview ? renderScannerPreview() : `
            <strong>${scannerHint(state.selectedTool)}</strong>
            <span>${scannerIdleCopy(state.selectedTool)}</span>
          `}
        </div>
        <input class="file-input" id="photoInput" type="file" accept="image/*">
        <div class="tool-actions">
          <button class="primary-button" type="button" data-photo-trigger>${slot.loading ? "正在为你分析..." : "拍照上传"}</button>
          <button class="secondary-button" type="button" data-analyze="${state.selectedTool}">使用样例</button>
        </div>
      </div>
      ${slot.loading ? renderStreamOutput() : ""}
      ${slot.latestAnalysis ? renderAnalysis(slot.latestAnalysis) : ""}
      ${boundary()}
    </section>
  `;
}

function renderScannerPreview() {
  const slot = currentToolState();
  return `
    <img class="scanner-preview" src="${escapeHtml(slot.selectedImagePreview)}" alt="已上传图片预览">
    <div class="scanner-caption">
      <strong>${escapeHtml(slot.selectedFileName || "已选择图片")}</strong>
      <span>${scannerSelectedCopy(state.selectedTool)}</span>
    </div>
  `;
}

function toolIntro(type) {
  if (type === "report") return "读取 HbA1c、空腹血糖、餐后 2 小时血糖等指标，并提醒你确认数值。";
  if (type === "meal") return "看主食、蛋白质、蔬菜和烹饪方式，判断餐后波动风险并给出替换建议。";
  return "看添加糖、精制碳水、蛋白质和膳食纤维，给出是否适合常买的建议。";
}

function scannerTitle(type) {
  if (type === "report") return "拍报告截图";
  if (type === "meal") return "拍当前餐盘";
  return "拍食品配料表";
}

function scannerHint(type) {
  if (type === "report") return "对准 HbA1c / OGTT 指标区域";
  if (type === "meal") return "保持餐盘完整入镜";
  return "对准配料和营养成分表";
}

function scannerStateLabel() {
  const slot = currentToolState();
  if (slot.loading) return "正在读取";
  if (slot.selectedFileName && !slot.latestAnalysis && slot.streamStatus) return "请重试";
  if (slot.latestAnalysisMeta?.fallback === false) return "已生成建议";
  if (slot.latestAnalysis) return "参考建议";
  return "可以上传";
}

function scannerIdleCopy(type) {
  if (type === "report") return "拍清楚指标和参考范围，我会帮你圈出需要校对的地方";
  if (type === "meal") return "拍完整餐盘，我会看主食、蛋白、蔬菜和烹饪方式";
  return "拍清楚配料表和营养成分，我会帮你判断适不适合常买";
}

function scannerSelectedCopy(type) {
  const slot = currentToolState();
  if (!slot.loading && slot.latestAnalysis) return "已根据这张图生成建议，可重新拍照替换";
  if (!slot.loading && slot.streamStatus) return "这张图已保留，可重新拍照再试";
  if (type === "report") return "已收到图片，正在找血糖、胰岛素和 HbA1c 等关键项";
  if (type === "meal") return "已收到图片，正在看餐盘结构和餐后波动风险";
  return "已收到图片，正在看添加糖、膳食纤维、蛋白质和碳水";
}

function renderAnalysis(analysis) {
  const result = analysis.result;
  const slot = toolState(analysis.type);
  const sourceLabel =
    slot.latestAnalysisMeta?.fallback === false
      ? "已生成建议"
      : "参考建议";
  if (analysis.type === "report") {
    return `
      <div class="analysis-card report-analysis stack">
        <div class="panel-header"><h3>${analysis.title}</h3><span class="risk-pill">${sourceLabel}</span></div>
        <p class="muted">${analysis.summary}</p>
        ${result.key_findings?.length ? `<ul class="report-finding-list">${result.key_findings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
        ${renderReportStandardTable(result.standard_comparison || [])}
        ${renderReportCurveTable(result.curve_rows || [])}
        ${renderReportDerived(result.derived_indicators || [])}
        ${result.interpretation ? `<section class="report-section"><h4>专业解读</h4><p class="helper">${escapeHtml(result.interpretation)}</p></section>` : ""}
        ${renderReportAdvice(result.professional_advice || result.action_suggestions || [], "专业建议")}
        ${renderReportAdvice(result.doctor_questions || [], "就诊时可问")}
        ${renderRawFields(result.fields || [])}
        <button class="secondary-button" type="button">信息确认无误，生成今日行动</button>
      </div>
    `;
  }
  if (analysis.type === "meal") {
    return renderMealAnalysis(analysis, sourceLabel);
  }
  return renderLabelAnalysis(analysis, sourceLabel);
}

function renderMealAnalysis(analysis, sourceLabel) {
  const result = analysis.result;
  const risk = mealRisk(result.carbRisk || "中");
  return `
    <div class="analysis-card meal-analysis stack">
      <div class="meal-hero ${risk.className}">
        <div>
          <p class="eyebrow">餐盘识别</p>
          <h3>${escapeHtml(analysis.title)}</h3>
        </div>
        <span class="meal-risk-pill">${escapeHtml(risk.label)}</span>
      </div>
      <p class="meal-summary">${highlightMealText(analysis.summary)}</p>
      ${renderMealPlate(result.plate)}
      ${renderMealInsights(result.observations || [])}
      ${renderMealNutritionCards(result.nutrition_refs || [], result.nutrition_notes || [])}
      ${renderMealActionSection("建议吃法", result.meal_order || [])}
      ${renderMealActionSection("替换建议", result.swaps || [])}
      <p class="meal-source">${escapeHtml(sourceLabel)} · 图片估计结果请按实际摄入量确认</p>
    </div>
  `;
}

function renderLabelAnalysis(analysis, sourceLabel) {
  const result = analysis.result;
  const advice = labelPurchaseAdvice(result.purchaseAdvice, analysis.risk_level);
  const reasons = Array.isArray(result.reasons) ? result.reasons : [];
  const alternatives = Array.isArray(result.alternatives) ? result.alternatives : [];
  const boundaryCopy = result.boundary || result.medical_boundary || "配料表建议用于消费选择参考，请结合个人情况和实际摄入量判断。";

  return `
    <div class="analysis-card label-analysis stack">
      <div class="label-hero ${advice.tone}">
        <div>
          <p class="eyebrow">配料表购买建议</p>
          <h3>${escapeHtml(advice.title)}</h3>
        </div>
        <span class="label-advice-pill">${escapeHtml(sourceLabel)}</span>
      </div>
      <p class="label-summary">${highlightLabelText(analysis.summary)}</p>
      <div class="traffic-light" aria-label="购买建议红绿灯">
        ${["green", "yellow", "red"].map((tone) => renderTrafficLightStep(tone, advice.tone)).join("")}
      </div>
      ${reasons.length ? `
        <section class="label-section">
          <h4>触发原因</h4>
          <div class="label-reason-grid">
            ${reasons.map((item) => `<div class="${labelReasonTone(item)}"><span>${escapeHtml(labelReasonTag(item))}</span><p>${highlightLabelText(item)}</p></div>`).join("")}
          </div>
        </section>
      ` : ""}
      ${alternatives.length ? `
        <section class="label-section">
          <h4>更稳的替代选择</h4>
          <div class="label-alternative-list">
            ${alternatives.map((item, index) => `<div><span>${index + 1}</span><p>${highlightLabelText(item)}</p></div>`).join("")}
          </div>
        </section>
      ` : ""}
      <p class="meal-source">${escapeHtml(boundaryCopy)}</p>
    </div>
  `;
}

function labelPurchaseAdvice(value, riskLevel) {
  const normalized = String(value || "").trim();
  if (normalized === "更适合" || riskLevel === "green") {
    return { tone: "green", title: "适合常买" };
  }
  if (normalized === "建议替换" || riskLevel === "red" || riskLevel === "orange") {
    return { tone: "red", title: "不建议常买" };
  }
  return { tone: "yellow", title: "偶尔少量" };
}

function renderTrafficLightStep(tone, activeTone) {
  const labels = {
    green: "适合常买",
    yellow: "偶尔少量",
    red: "不建议常买",
  };
  return `
    <div class="traffic-step ${tone}${tone === activeTone ? " active" : ""}">
      <i></i>
      <strong>${labels[tone]}</strong>
    </div>
  `;
}

function labelReasonTone(text) {
  if (/糖|精制|钠|盐|饱和|反式|脂肪|靠前|偏高|不突出|低/.test(text)) return "warn";
  return "good";
}

function labelReasonTag(text) {
  if (/糖|蔗糖|果葡|糖浆|麦芽糊精/.test(text)) return "添加糖";
  if (/精制|淀粉|小麦粉|米粉|糊精/.test(text)) return "精制碳水";
  if (/钠|盐/.test(text)) return "钠";
  if (/脂肪|饱和|反式|油/.test(text)) return "脂肪";
  if (/纤维/.test(text)) return "膳食纤维";
  if (/蛋白/.test(text)) return "蛋白质";
  return "配料信号";
}

function highlightLabelText(text) {
  const safe = escapeHtml(text);
  return safe.replace(
    /(适合常买|偶尔少量|不建议常买|添加糖|蔗糖|果葡糖浆|麦芽糊精|精制碳水|钠|饱和脂肪|反式脂肪|膳食纤维|蛋白质|无糖|原味|高蛋白|低糖|控制份量)/g,
    (match) => `<mark class="label-mark">${match}</mark>`,
  );
}

function mealRisk(value) {
  if (value === "偏高") return { label: "波动风险偏高", className: "danger" };
  if (value === "低") return { label: "波动风险较低", className: "good" };
  return { label: "波动风险中等", className: "warn" };
}

function renderMealPlate(plate) {
  if (!plate) return "";
  const cards = [
    { label: "主食", value: plate.staple || "未明显看到", tone: "staple" },
    { label: "蛋白质", value: plate.protein || "未明显看到", tone: "protein" },
    { label: "蔬菜", value: plate.vegetables || "未明显看到", tone: "vegetable" },
    { label: "烹饪", value: plate.cooking || "未识别", tone: "cooking" },
  ];
  return `
    <section class="meal-section">
      <h4>餐盘结构</h4>
      <div class="meal-plate-grid">
        ${cards.map((item) => `<div class="meal-plate-card ${item.tone}"><span>${escapeHtml(item.label)}</span><strong>${highlightMealText(item.value)}</strong></div>`).join("")}
      </div>
    </section>
  `;
}

function renderMealInsights(items) {
  if (!items.length) return "";
  return `
    <section class="meal-section">
      <h4>重点信号</h4>
      <div class="meal-table-wrap">
        <table class="meal-table meal-insight-table">
          <thead><tr><th>判断</th><th>重点信号</th></tr></thead>
          <tbody>
        ${items.map((item) => {
          const severity = mealSeverity(item);
          return `<tr>
            <td>${renderMealStatusPill(severity.className, severity.label)}</td>
            <td>${highlightMealText(item)}</td>
          </tr>`;
        }).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderMealNutritionCards(refs, fallbackNotes) {
  const cards = buildMealNutritionCards(refs, fallbackNotes);
  if (!cards.length) return "";
  return `
    <section class="meal-section">
      <h4>GI / GL / 营养素参考</h4>
      <div class="meal-table-wrap">
        <table class="meal-table meal-nutrition-table">
          <thead><tr><th>食物</th><th>状态</th><th>GI</th><th>GL</th><th>营养素</th><th>说明</th></tr></thead>
          <tbody>${cards.map(renderMealNutritionRow).join("")}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderMealNutritionRow(card) {
  const gi = mealMetricValue(card, "GI");
  const gl = mealMetricValue(card, "GL");
  const nutrient = mealMetricValue(card, "营养素");
  return `
    <tr class="${escapeHtml(card.severity)}">
      <td><strong>${escapeHtml(card.title)}</strong></td>
      <td>${renderMealStatusPill(card.severity, card.badge)}</td>
      <td><span class="meal-metric ${escapeHtml(gi.tone)}">${escapeHtml(gi.value)}</span></td>
      <td><span class="meal-metric ${escapeHtml(gl.tone)}">${escapeHtml(gl.value)}</span></td>
      <td><span class="meal-metric ${escapeHtml(nutrient.tone)}">${escapeHtml(nutrient.value)}</span></td>
      <td>${highlightMealText(card.detail)}</td>
    </tr>
  `;
}

function mealMetricValue(card, label) {
  return card.metrics.find((metric) => metric.label === label) || { value: "-", tone: "good" };
}

function renderMealStatusPill(className, label) {
  return `<span class="meal-status-pill ${escapeHtml(className)}">${escapeHtml(label)}</span>`;
}

function buildMealNutritionCards(refs, fallbackNotes) {
  if (Array.isArray(refs) && refs.length && typeof refs[0] === "object") {
    const groups = new Map();
    refs.forEach((ref) => {
      const title = cleanMealItemTitle(ref.item || ref.food || "食物参考");
      if (!groups.has(title)) groups.set(title, []);
      groups.get(title).push(ref);
    });
    return [...groups.entries()].map(([title, items]) => buildStructuredNutritionCard(title, items));
  }
  return groupFallbackNutritionNotes(fallbackNotes || []);
}

function buildStructuredNutritionCard(title, refs) {
  const giValues = uniqueValues(refs.map((ref) => ref.gi));
  const glValues = uniqueValues(refs.map((ref) => ref.gl));
  const nutrients = uniqueValues(refs.map((ref) => nutrientLabel(ref.group)));
  const foods = uniqueValues(refs.map((ref) => ref.food));
  const severity = refs.some((ref) => ref.glLevel === "high" || /汤汁|油脂|加速|偏高|高/.test(ref.note || ""))
    ? "danger"
    : refs.some((ref) => ref.glLevel === "medium")
      ? "warn"
      : "good";
  const badge = severity === "danger" ? "重点关注" : severity === "warn" ? "适量观察" : "较稳";
  const detailNotes = uniqueValues(refs.map((ref) => cleanNutritionNote(ref.note))).filter(Boolean);
  return {
    title,
    badge,
    severity,
    metrics: [
      { label: "GI", value: displayValues(giValues), tone: aggregateMetricTone("GI", giValues) },
      { label: "GL", value: displayValues(glValues), tone: aggregateMetricTone("GL", glValues) },
      { label: "营养素", value: nutrients.join("+") || "参考", tone: severity === "danger" ? "warn" : "good" },
    ],
    detail: `参考：${foods.join("、")}。${detailNotes.join("；") || "按同类食物估算，结合实际摄入量确认。"}`
  };
}

function groupFallbackNutritionNotes(notes) {
  const groups = new Map();
  notes.forEach((note) => {
    const [rawTitle] = String(note).split(/[：:]/);
    const title = cleanMealItemTitle(rawTitle);
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title).push(note);
  });
  return [...groups.entries()].map(([title, groupNotes]) => {
    const text = groupNotes.join("；");
    const giValues = [...text.matchAll(/\bGI\s*([0-9.]+)/g)].map((match) => Number(match[1]));
    const glValues = [...text.matchAll(/\bGL\s*([0-9.]+)/g)].map((match) => Number(match[1]));
    const severity = mealSeverity(text).className;
    return {
      title,
      badge: severity === "danger" ? "重点关注" : severity === "warn" ? "适量观察" : "较稳",
      severity,
      metrics: [
        { label: "GI", value: displayValues(uniqueValues(giValues)), tone: aggregateMetricTone("GI", giValues) },
        { label: "GL", value: displayValues(uniqueValues(glValues)), tone: aggregateMetricTone("GL", glValues) },
        { label: "营养素", value: inferNutrientFromText(text), tone: severity === "danger" ? "warn" : "good" },
      ],
      detail: cleanNutritionNote(text.replace(/\bII\s*[0-9.]+/g, "")),
    };
  });
}

function cleanMealItemTitle(title) {
  return String(title || "食物参考").split("≈")[0].trim() || "食物参考";
}

function cleanNutritionNote(note) {
  return String(note || "")
    .replace(/GI\/GL\/II/g, "GI/GL")
    .replace(/低或中等 II/g, "餐后反应较低到中等")
    .replace(/中等 II/g, "餐后反应中等")
    .replace(/低 II/g, "餐后反应低")
    .replace(/中 II/g, "餐后反应中等")
    .replace(/高 II/g, "餐后反应偏高")
    .replace(/II\s*较低/g, "餐后反应较低")
    .replace(/II\s*较高/g, "餐后反应偏高")
    .replace(/胰岛素指数\s*[0-9.]+（低）/g, "餐后反应低")
    .replace(/胰岛素指数\s*[0-9.]+（中等）/g, "餐后反应中等")
    .replace(/胰岛素指数\s*[0-9.]+（高）/g, "餐后反应偏高")
    .replace(/胰岛素指数(?:为)?(低|中等|偏高|高)/g, "餐后反应$1")
    .replace(/胰岛素指数/g, "餐后反应")
    .replace(/\bII\s*[0-9.]+(?:（[^）]*）)?[，,。；;]*/g, "")
    .replace(/\/\s*(?=[，,。；;\s]|$)/g, "")
    .replace(/\bII\b/g, "餐后反应")
    .replace(/([^\s，。；、:：]+)≈[^\s，。；、:：]+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function nutrientLabel(group) {
  const labels = {
    staple: "主食",
    protein: "蛋白质",
    vegetable: "蔬菜",
    fruit: "水果",
    drink: "饮品",
    fat_sauce: "油脂",
  };
  return labels[group] || "食物";
}

function inferNutrientFromText(text) {
  if (/米饭|主食|糙米|黑米|紫米/.test(text)) return "主食";
  if (/蛋|肉|鸡|鱼|虾|豆腐|蛋白/.test(text)) return "蛋白质";
  if (/菜|番茄|菠菜|丝瓜|黄瓜|蔬菜/.test(text)) return "蔬菜";
  return "参考";
}

function uniqueValues(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ""))];
}

function displayValues(values) {
  if (!values.length) return "-";
  return values.join("/");
}

function aggregateMetricTone(label, values) {
  if (!values.length) return "good";
  const tones = values.map((value) => mealMetricTone(label, Number(value)));
  if (tones.includes("danger")) return "danger";
  if (tones.includes("warn")) return "warn";
  return "good";
}

function mealMetricTone(label, value) {
  if (label === "GI") return value >= 70 ? "danger" : value >= 56 ? "warn" : "good";
  if (label === "GL") return value >= 20 ? "danger" : value >= 11 ? "warn" : "good";
  if (label === "II") return value >= 70 ? "danger" : value >= 40 ? "warn" : "good";
  return "good";
}

function renderMealActionSection(title, items) {
  const actionItems = title === "建议吃法" ? withMeal211(items) : items;
  if (!actionItems.length) return "";
  return `
    <section class="meal-section">
      <h4>${escapeHtml(title)}</h4>
      <div class="meal-action-list">
        ${actionItems.map((item, index) => `<div><span>${index + 1}</span><p>${highlightMealText(item)}</p></div>`).join("")}
      </div>
    </section>
  `;
}

function withMeal211(items) {
  const current = Array.isArray(items) ? items : [];
  if (current.some((item) => /211|2\s*份蔬菜/.test(item))) return current;
  return ["采用 211 餐盘法（2 份蔬菜、1 份蛋白质、1 份主食），先按这个比例看当前餐盘，再调整主食份量。", ...current];
}

function mealSeverity(text) {
  if (/偏高|高 GL|高 II|汤汁|油脂|拌饭|加速|共享|实际摄入|注意|风险/.test(text)) {
    return { className: "danger", label: "重点" };
  }
  if (/中等|中 II|主食|份量|确认|观察|可接受/.test(text)) {
    return { className: "warn", label: "观察" };
  }
  return { className: "good", label: "稳定" };
}

function highlightMealText(text) {
  const safe = escapeHtml(cleanNutritionNote(text));
  return safe.replace(
    /(211 餐盘法|2 份蔬菜|1 份蛋白质|1 份主食|偏高|高 GL|汤汁|油脂|拌饭|加速|共享餐桌|实际摄入量|主食|份量|中等|低 GL|GI\s*[0-9.]+|GL\s*[0-9.]+|营养素)/g,
    (match) => {
      const tone = /偏高|高 GL|高 II|汤汁|油脂|拌饭|加速|共享|实际/.test(match)
        ? "danger"
        : /低 GL|低 II/.test(match)
          ? "good"
          : "warn";
      return `<mark class="meal-mark ${tone}">${match}</mark>`;
    },
  );
}

function renderReportStandardTable(rows) {
  if (!rows.length) return "";
  return `
    <section class="report-section">
      <h4>标准对比</h4>
      <div class="report-table-wrap">
        <table class="report-table">
          <thead><tr><th>指标</th><th>本次</th><th>标准/参考</th><th>判读</th></tr></thead>
          <tbody>
            ${rows
              .map(
                (row) => `
                  <tr>
                    <td>${escapeHtml(row.indicator)}</td>
                    <td><strong>${escapeHtml(row.value)}</strong>${row.lab_reference ? `<small>实验室 ${escapeHtml(row.lab_reference)}</small>` : ""}</td>
                    <td>${escapeHtml(row.standard)}<small>${escapeHtml(row.note || "")}</small></td>
                    <td><span class="table-pill">${escapeHtml(row.judgement)}</span></td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderReportCurveTable(rows) {
  if (!rows.length) return "";
  return `
    <section class="report-section">
      <h4>检查曲线</h4>
      <div class="report-table-wrap">
        <table class="report-table curve-table">
          <thead><tr><th>时间</th><th>血糖</th><th>胰岛素</th><th>C肽</th></tr></thead>
          <tbody>
            ${rows
              .map(
                (row) => `
                  <tr>
                    <td>${escapeHtml(row.time)}</td>
                    <td>${escapeHtml(row.glucose || "-")}</td>
                    <td>${escapeHtml(row.insulin || "-")}<small>${escapeHtml(row.insulin_ratio || "")}</small></td>
                    <td>${escapeHtml(row.c_peptide || "-")}<small>${escapeHtml(row.c_peptide_ratio || "")}</small></td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderReportDerived(items) {
  if (!items.length) return "";
  return `
    <section class="report-section">
      <h4>进一步参考指标</h4>
      <div class="mini-metric-grid report-derived-grid">
        ${items.map((item) => `<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong><small>${escapeHtml(item.note)}</small></div>`).join("")}
      </div>
    </section>
  `;
}

function renderReportAdvice(items, title) {
  if (!items.length) return "";
  return `
    <section class="report-section">
      <h4>${escapeHtml(title)}</h4>
      <ul class="content-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>
  `;
}

function renderRawFields(fields) {
  if (!fields.length) return "";
  return `
    <details class="raw-fields">
      <summary>查看识别到的原始指标</summary>
      <div class="field-table">
        ${fields.map((field) => `<div><strong>${escapeHtml(field.label)}</strong><span>${escapeHtml(field.value)}<br><small>${escapeHtml(field.note)}</small></span></div>`).join("")}
      </div>
    </details>
  `;
}

function renderStreamOutput() {
  const slot = currentToolState();
  const readable = streamReadableText(slot.streamText, state.selectedTool);
  return `
    <div class="stream-card" aria-live="polite" data-stream-card>
      <div class="stream-header">
        <span data-stream-status>${slot.streamStatus || "准备读取图片"}</span>
        <i></i>
      </div>
      <p class="typewriter-text" data-stream-text>${escapeHtml(readable || streamPlaceholder(state.selectedTool))}</p>
    </div>
  `;
}

function updateStreamOutput(tool = state.selectedTool) {
  if (state.selectedTool !== tool) return;
  const slot = toolState(tool);
  const card = document.querySelector("[data-stream-card]");
  if (!card) {
    if (state.view === "tools") render();
    return;
  }

  const status = card.querySelector("[data-stream-status]");
  const text = card.querySelector("[data-stream-text]");
  if (status) status.textContent = slot.streamStatus || "准备读取图片";
  if (text) text.textContent = streamReadableText(slot.streamText, tool) || streamPlaceholder(tool);
}

function streamReadableText(raw, type) {
  const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  if (!cleaned) return "";

  const directFields = ["summary", "interpretation", "boundary", "carbRisk"];
  for (const field of directFields) {
    const match = cleaned.match(new RegExp(`"${field}"\\s*:\\s*"([^"]*)`));
    if (match?.[1]) return match[1];
  }

  const listFields = ["key_findings", "action_suggestions", "observations", "reasons", "swaps", "alternatives"];
  for (const field of listFields) {
    const match = cleaned.match(new RegExp(`"${field}"\\s*:\\s*\\[[\\s\\S]*?"([^"]{6,})`));
    if (match?.[1]) return match[1];
  }

  if (/^[{\[]/.test(cleaned) || /"\w+"\s*:/.test(cleaned)) return streamPlaceholder(type);
  return cleaned.slice(0, 160);
}

function streamPlaceholder(type) {
  if (type === "report") return "我会先提取关键指标，再提醒你哪些数值需要人工确认。";
  if (type === "meal") return "我会先看餐盘里主食、蛋白质和蔬菜的比例，再给出更稳的吃法。";
  return "我会先看添加糖位置、膳食纤维、蛋白质和每份碳水，再给出购买建议。";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function renderActions() {
  const data = state.appState;
  if (!data) return loadingMarkup();
  const sorted = [...data.actions].sort((a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category));
  const primary = sorted.find((action) => action.category === "exercise") || sorted[0];
  const optional = sorted.filter((action) => action.id !== primary?.id);
  const primaryDone = primary?.status === "done";
  const optionalDoneCount = optional.filter((action) => action.status === "done").length;
  const primaryContext = getActionContext(primary);

  return `
    <section class="stack">
      <div class="hero-card">
        <div class="hero-top">
          <div>
            <p class="eyebrow">今日行动</p>
            <h2>${primaryDone ? "主行动已完成" : "先完成 1 个主行动"}</h2>
          </div>
          ${
            primary
              ? `<button class="ghost-button" type="button" data-action-id="${primary.id}">${primaryDone ? "取消完成" : "完成主行动"}</button>`
              : ""
          }
        </div>
        <p class="muted">${primaryContext.source}。今天先把最高优先级做完，其他行动只作为可选加分。</p>
      </div>
      ${primary ? `<div class="action-section"><p class="eyebrow">主行动 ${primaryDone ? 1 : 0}/1</p>${renderActionCard(primary, true)}</div>` : ""}
      <div class="action-section">
        <div class="section-heading compact">
          <p class="eyebrow">可选行动 ${optionalDoneCount}/${optional.length}</p>
          <h2>有余力再做</h2>
        </div>
        ${optional.map((action) => renderActionCard(action, false)).join("")}
      </div>
      ${boundary()}
    </section>
  `;
}

function getActionContext(action) {
  if (!action) {
    return { source: "来自今日关注信号", rationale: "先完成一个低门槛行动。", fallback: "做不到时可以选择更轻的版本。" };
  }
  return actionContext[action.category] || actionContext.exercise;
}

function renderActionCard(action, isPrimary = false) {
  const context = getActionContext(action);
  return `
    <div class="action-card ${action.status} ${isPrimary ? "primary-action" : "optional-action"}">
      <div class="action-row">
        <div>
          <span class="tag">${isPrimary ? "主行动" : action.title}</span>
          ${isPrimary ? `<h3>${action.title}</h3>` : ""}
          <p class="muted">${action.detail}</p>
          <p class="source-note"><strong>${context.source}</strong><span>${context.rationale}</span></p>
          <p class="small">${action.status === "done" ? "已记录：今晚优先级完成，连续 3 天后再看趋势。" : context.fallback}</p>
        </div>
        <button class="checkbox ${action.status === "done" ? "done" : ""}" aria-label="完成${action.title}" type="button" data-action-id="${action.id}"></button>
      </div>
    </div>
  `;
}

function renderCompanion() {
  return `
    <section class="stack">
      <div class="card call-card">
        <div class="avatar" aria-hidden="true"></div>
        <div>
          <p class="eyebrow">你来决定</p>
          <h2>AI 行动陪伴</h2>
          <p class="muted">我看到你今天已经有几个关注信号。我们不用重启完整计划，先完成一件事：晚饭后走 15 分钟。</p>
        </div>
        <div class="wave" aria-hidden="true"></div>
        <button class="primary-button" type="button" data-companion-confirm>愿意，把它设为今天的行动</button>
        <button class="secondary-button" type="button" data-companion-light>换一个轻一点的</button>
      </div>
      ${boundary()}
    </section>
  `;
}

function renderProfile() {
  const profile = state.appState?.healthProfile;
  if (!profile) return loadingMarkup();
  const summary = profile.summary;
  const latestExtraction = profile.latestReportExtraction;

  return `
    <section class="stack">
      <div class="profile-hero">
        <div class="hero-top">
          <div>
            <p class="eyebrow">我的健康档案 · ${escapeHtml(profile.source.review_date)}</p>
            <h2>${escapeHtml(summary.label)}</h2>
          </div>
          <span class="status-pill completed">${escapeHtml(summary.phase)}</span>
        </div>
        <p class="profile-lead">${escapeHtml(summary.status)}</p>
        <p class="helper">${escapeHtml(summary.mechanism)}</p>
      </div>

      <div class="profile-metric-grid">
        ${profile.keyMetrics.map(renderProfileMetricCard).join("")}
      </div>

      <div class="card stack">
        <div class="panel-header">
          <h2>糖耐量曲线对比</h2>
          <span class="tag">前后对比</span>
        </div>
        ${renderOgttProfileChart(profile)}
        <p class="profile-chart-copy">2 小时回落变快，是这次最重要的好变化；后续继续看复查趋势是否稳定。</p>
        <ul class="content-list">${profile.ogtt.shape.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>

      ${renderProfileProfessionalDetails(profile, latestExtraction)}

      <div class="card stack">
        <div class="panel-header">
          <h2>近期重点关注</h2>
          <span class="tag">避免反复</span>
        </div>
        <div class="priority-list">${profile.watchPriorities.map(renderPriorityItem).join("")}</div>
      </div>

      <div class="card stack">
        <div class="panel-header">
          <h2>复查计划</h2>
          <span class="tag">按医嘱调整</span>
        </div>
        <div class="timeline-list">${profile.followUps.map(renderFollowUpItem).join("")}</div>
      </div>

      <div class="card stack">
        <div class="panel-header">
          <h2>我的行动清单</h2>
          <button class="ghost-button" type="button" data-go="actions">去打卡</button>
        </div>
        <ul class="content-list">${profile.actionChecklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
      <p class="medical-boundary">${escapeHtml(summary.boundary)}</p>
    </section>
  `;
}

function renderProfileProfessionalDetails(profile, latestExtraction) {
  return `
    <details class="profile-details">
      <summary>
        <span>
          <strong>完整专业指标</strong>
          <small>身体成分、复查指标、报告抽取和观察目标</small>
        </span>
        <em>展开</em>
      </summary>
      <div class="profile-details-body stack">
        <section class="stack">
          <div class="panel-header">
            <h2>身体成分</h2>
            <span class="tag">长期记录</span>
          </div>
          <div class="mini-metric-grid">
            ${profile.bodyComposition.map((item) => `<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)} ${escapeHtml(item.unit)}</strong><small>${escapeHtml(item.note)}</small></div>`).join("")}
          </div>
        </section>

        ${latestExtraction ? renderLatestReportExtraction(latestExtraction, true) : ""}

        <section class="stack">
          <div class="panel-header">
            <h2>复查指标记录</h2>
            <span class="tag">上传报告后补充</span>
          </div>
          ${profile.labGroups.map(renderProfileLabGroup).join("")}
        </section>

        <section class="stack">
          <div class="panel-header">
            <h2>日常观察目标</h2>
            <span class="tag">看长期趋势</span>
          </div>
          <div class="mini-metric-grid">
            ${profile.monitoringTargets.map((item) => `<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong><small>按医生建议调整个人目标</small></div>`).join("")}
          </div>
        </section>

        <section class="stack">
          <div class="panel-header">
            <h2>健康记录时间线</h2>
            <span class="tag">关键节点</span>
          </div>
          <div class="timeline-list">${profile.timeline.map(renderTimelineEvent).join("")}</div>
        </section>

        <section>
          <h2>下次复查可补充的指标</h2>
          <p class="muted">这些不是今天都要填写，用于下次上传报告或和医生沟通时逐步完善。</p>
          <div class="tag-row">${profile.fixedMetricSchema.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
        </section>
      </div>
    </details>
  `;
}

function renderProfileMetricCard(metric) {
  return `
    <div class="profile-metric-card">
      <span>${escapeHtml(metric.label)}</span>
      <strong>${escapeHtml(metric.latest)}<small>${escapeHtml(metric.unit)}</small></strong>
      <p>${escapeHtml(metric.change)} · ${escapeHtml(metric.status)}</p>
      <em>基线 ${escapeHtml(metric.baseline)}${escapeHtml(metric.unit)}</em>
    </div>
  `;
}

function renderOgttProfileChart(profile) {
  const points = buildSparklinePoints(profile.ogtt.glucose.latest, 4.2, 9.8);
  const baselinePoints = buildSparklinePoints(profile.ogtt.glucose.baseline, 4.2, 9.8);
  return `
    <div class="profile-chart" aria-label="复查糖耐量葡萄糖曲线">
      <svg viewBox="0 0 320 132" role="img">
        <path class="profile-chart-band" d="M0 64 H320 V94 H0 Z"></path>
        <polyline class="profile-chart-line baseline" points="${baselinePoints}"></polyline>
        <polyline class="profile-chart-line latest" points="${points}"></polyline>
      </svg>
      <div class="profile-chart-legend">
        <span><i class="latest"></i>最近复查</span>
        <span><i class="baseline"></i>首次检查</span>
      </div>
      <div class="profile-time-row">${profile.ogtt.times.map((time) => `<span>${escapeHtml(time)}</span>`).join("")}</div>
    </div>
  `;
}

function buildSparklinePoints(values, min, max) {
  const usableWidth = 284;
  const left = 18;
  const top = 16;
  const height = 82;
  const step = usableWidth / Math.max(values.length - 1, 1);
  return values
    .map((value, index) => {
      const ratio = Math.max(0, Math.min(1, (Number(value) - min) / (max - min)));
      const x = left + step * index;
      const y = top + height - ratio * height;
      return `${roundNumber(x)},${roundNumber(y)}`;
    })
    .join(" ");
}

function roundNumber(value) {
  return Math.round(value * 10) / 10;
}

function renderLatestReportExtraction(extraction, embedded = false) {
  return `
    <div class="${embedded ? "profile-detail-section" : "card"} stack">
      <div class="panel-header">
        <h2>最近报告抽取</h2>
        <span class="tag">待校对</span>
      </div>
      <p class="muted">${escapeHtml(extraction.summary)}</p>
      <div class="mini-metric-grid">
        ${extraction.metrics.map((item) => `<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)} ${escapeHtml(item.unit)}</strong><small>${escapeHtml(item.note)}</small></div>`).join("")}
      </div>
    </div>
  `;
}

function renderProfileLabGroup(group) {
  return `
    <section class="profile-lab-group">
      <h3>${escapeHtml(group.title)}</h3>
      <div class="profile-lab-list">
        ${group.items
          .map(
            (item) => `
              <div>
                <strong>${escapeHtml(item.label)}</strong>
                <span>${escapeHtml(item.baseline)} → ${escapeHtml(item.latest)}</span>
                <small>${escapeHtml(item.note)}</small>
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderPriorityItem(item) {
  return `
    <div class="priority-item">
      <strong>${escapeHtml(item.rank)}</strong>
      <div>
        <span>${escapeHtml(item.title)}</span>
        <p>${escapeHtml(item.detail)}</p>
      </div>
    </div>
  `;
}

function renderFollowUpItem(item) {
  return `
    <div class="timeline-item">
      <strong>${escapeHtml(item.time)}</strong>
      <p>${escapeHtml(item.detail)}</p>
    </div>
  `;
}

function renderTimelineEvent(item) {
  return `
    <div class="timeline-item">
      <strong>${escapeHtml(item.date)} · ${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.detail)}</p>
    </div>
  `;
}

function renderContent() {
  const data = state.appState;
  const content = data?.content || { guides: [], articles: [], cases: [], event: null };
  const guides = content.guides || [];
  const articles = content.articles || [];
  if (state.selectedContent) {
    return renderContentDetail(state.selectedContent);
  }
  return `
    <section class="stack">
      <div class="hero-card">
        <p class="eyebrow">科普</p>
        <h2>糖前知识库</h2>
        <p class="muted">已整理 ${guides.length} 个指南主题和 ${articles.length} 篇研究参考，帮你把专业内容转成日常可执行的选择。</p>
      </div>
      <div class="content-section">
        <div class="section-heading">
          <p class="eyebrow">主题</p>
          <h2>指南专题</h2>
        </div>
        <div class="content-grid">${guides.map(renderGuideCard).join("")}</div>
      </div>
      <div class="content-section">
        <div class="section-heading">
          <p class="eyebrow">研究参考</p>
          <h2>研究怎么用到生活里</h2>
        </div>
        <div class="content-grid">${articles.map(renderArticleCard).join("")}</div>
      </div>
      <div class="card">
        <h2>用户案例</h2>
        <ul class="content-list">${content.cases.map((item) => `<li>${item}</li>`).join("")}</ul>
      </div>
      <div class="card">
        <h2>${content.event?.title || "活动"}</h2>
        <p class="muted">${content.event?.summary || ""}</p>
      </div>
      ${boundary()}
    </section>
  `;
}

function renderGuideCard(guide) {
  return `
    <article class="article-card guide-card">
      <div class="article-meta">
        <span class="tag">${guide.source}</span>
        <span>${guide.label}</span>
      </div>
      <h3>${guide.title}</h3>
      <p class="muted">${guide.summary}</p>
      <div class="tag-row">${(guide.keywords || []).map((tag) => `<span>${tag}</span>`).join("")}</div>
      <div class="content-actions">
        <button class="text-link" type="button" data-content-kind="guide" data-content-id="${guide.originPath}">查看详情</button>
        <a class="text-link secondary-link" href="${guide.url}" target="_blank" rel="noreferrer">查看来源</a>
      </div>
    </article>
  `;
}

function renderArticleCard(article) {
  return `
    <article class="article-card">
      <div class="article-meta">
        <span class="tag">${article.evidence || article.source}</span>
        <span>${article.date || ""}</span>
      </div>
      <h3>${article.title}</h3>
      <p class="article-subtitle">${article.subtitle || ""}</p>
      <p class="muted">${article.summary}</p>
      <div class="tag-row">${(article.tags || []).slice(0, 4).map((tag) => `<span>${tag}</span>`).join("")}</div>
      <p class="source-line">${article.source}</p>
      <div class="content-actions">
        <button class="text-link" type="button" data-content-kind="article" data-content-id="${article.originPath}">查看详情</button>
        <a class="text-link secondary-link" href="${article.url}" target="_blank" rel="noreferrer">查看来源</a>
      </div>
    </article>
  `;
}

function renderContentDetail(selected) {
  const item = selected.item;
  const isGuide = selected.kind === "guide";
  return `
    <section class="stack">
      <button class="back-button" type="button" data-content-back>返回科普</button>
      <article class="detail-card stack">
        <div class="article-meta">
          <span class="tag">${isGuide ? "指南专题" : item.evidence || "研究解读"}</span>
          <span>${isGuide ? item.label : item.date || ""}</span>
        </div>
        <h2>${item.title}</h2>
        ${item.subtitle ? `<p class="article-subtitle">${item.subtitle}</p>` : ""}
        <p class="muted">${item.summary}</p>
        <div class="tag-row">${(isGuide ? item.keywords || [] : item.tags || []).map((tag) => `<span>${tag}</span>`).join("")}</div>
      </article>
      ${isGuide ? renderGuideDetail(item) : renderArticleDetail(item)}
      <div class="card">
        <h2>证据边界</h2>
        <p class="muted">这部分内容用于理解方向和设计个人生活实验，不替代医生诊断、治疗和用药建议。已有慢病、怀孕、低血糖风险高或指标明显异常时，应先咨询医生。</p>
      </div>
      <a class="primary-button link-button" href="${item.url}" target="_blank" rel="noreferrer">查看来源原文</a>
      ${boundary()}
    </section>
  `;
}

function renderGuideDetail(guide) {
  const keywords = guide.keywords || [];
  return `
    <div class="card">
      <h2>学习路径</h2>
      <ul class="content-list">
        <li>先读核心概念：${guide.summary}</li>
        <li>再选一个观察指标：${keywords[0] || "餐后反应"}，连续记录 1-2 周。</li>
        <li>最后只改一个变量：${keywords[1] || "饮食、运动或睡眠"}，观察趋势变化。</li>
      </ul>
    </div>
  `;
}

function renderArticleDetail(article) {
  return `
    <div class="card">
      <h2>怎么读这篇研究</h2>
      <ul class="content-list">
        <li>先看研究人群、时间和来源，不把单篇研究当成通用结论。</li>
        <li>把结论翻译成一个可执行动作，例如饭后步行、睡眠记录、主食替换或体重/腰围追踪。</li>
        <li>连续记录 2-4 周，看趋势而不是看单次数字。</li>
      </ul>
      <p class="source-line">来源：${article.source}</p>
    </div>
  `;
}

function loadingMarkup() {
  return `<section class="stack"><div class="card"><h2>正在加载...</h2><p class="muted">正在读取演示用户状态。</p></div></section>`;
}

function bindViewEvents() {
  document.querySelectorAll("[data-content-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const content = state.appState?.content || { guides: [], articles: [] };
      const collection = button.dataset.contentKind === "guide" ? content.guides : content.articles;
      const item = collection.find((entry) => entry.originPath === button.dataset.contentId);
      if (!item) return;
      state.selectedContent = { kind: button.dataset.contentKind, item };
      render();
    });
  });
  document.querySelectorAll("[data-content-back]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedContent = null;
      render();
    });
  });
  document.querySelectorAll("[data-go]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.go));
  });
  document.querySelectorAll("[data-record-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.appState?.recentAnalysis?.find((record) => record.id === button.dataset.recordId);
      if (!item) return;
      state.selectedTool = item.type || "report";
      const slot = toolState(state.selectedTool);
      slot.latestAnalysis = item;
      slot.latestAnalysisMeta = { fallback: null };
      slot.streamText = "";
      slot.streamStatus = "";
      slot.loading = false;
      setView("tools");
    });
  });
  document.querySelectorAll("[data-choice]").forEach((group) => {
    group.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", async () => {
        const patch = { user_id: state.user.id };
        if (group.dataset.choice === "stress") patch.stress_state = button.dataset.value;
        if (group.dataset.choice === "energy") patch.energy_state = button.dataset.value;
        await api("/api/daily-state", { method: "PATCH", body: JSON.stringify(patch) });
        await refresh();
      });
    });
  });
  document.querySelectorAll("[data-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedTool = button.dataset.tool;
      render();
    });
  });
  document.querySelectorAll("[data-tool-shortcut]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedTool = button.dataset.toolShortcut;
      setView("tools");
    });
  });
  document.querySelectorAll("[data-photo-trigger]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector("#photoInput")?.click();
    });
  });
  document.querySelectorAll("#photoInput").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const tool = state.selectedTool;
      const slot = toolState(tool);
      setSelectedImage(file);
      slot.loading = true;
      slot.latestAnalysis = null;
      slot.latestAnalysisMeta = null;
      slot.streamText = "";
      slot.streamStatus = "正在压缩并提交图片...";
      render();
      try {
        const image = await fileToBase64(file);
        await analyzeApi({
          user_id: state.user.id,
          type: tool,
          photo_name: file.name,
          mime_type: file.type,
          image_data: image.base64,
        }, tool);
        await loadAppState();
      } catch (error) {
        slot.streamStatus = error.message || "识别失败，请稍后重试";
      } finally {
        slot.loading = false;
        render();
      }
    });
  });
  document.querySelectorAll("[data-analyze]").forEach((button) => {
    button.addEventListener("click", async () => {
      const tool = button.dataset.analyze;
      const slot = toolState(tool);
      clearSelectedImage(tool);
      slot.loading = true;
      slot.latestAnalysis = null;
      slot.latestAnalysisMeta = null;
      slot.streamText = "";
      slot.streamStatus = "正在提交样例识别...";
      render();
      try {
        await analyzeApi({ user_id: state.user.id, type: tool }, tool);
        await loadAppState();
      } catch (error) {
        slot.streamStatus = error.message || "识别失败，请稍后重试";
      } finally {
        slot.loading = false;
        render();
      }
    });
  });
  document.querySelectorAll("[data-action-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = state.appState.actions.find((item) => item.id === button.dataset.actionId);
      await api(`/api/actions/${action.id}`, {
        method: "PATCH",
        body: JSON.stringify({ user_id: state.user.id, status: action.status === "done" ? "todo" : "done" }),
      });
      await refresh();
    });
  });
  document.querySelectorAll("[data-complete-all]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api("/api/actions/complete", {
        method: "POST",
        body: JSON.stringify({ user_id: state.user.id }),
      });
      await refresh();
    });
  });
  document.querySelectorAll("[data-companion-confirm], [data-companion-light]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api("/api/companion/confirm", {
        method: "POST",
        body: JSON.stringify({ user_id: state.user.id }),
      });
      await refresh();
      setView("actions");
    });
  });
}

function setSelectedImage(file, tool = state.selectedTool) {
  const slot = toolState(tool);
  clearSelectedImage(tool);
  slot.selectedFileName = file.name || "已选择图片";
  if (typeof URL !== "undefined" && URL.createObjectURL) {
    slot.selectedImagePreview = URL.createObjectURL(file);
  }
}

function clearSelectedImage(tool = state.selectedTool) {
  const slot = toolState(tool);
  if (slot.selectedImagePreview && slot.selectedImagePreview.startsWith("blob:") && typeof URL !== "undefined") {
    URL.revokeObjectURL(slot.selectedImagePreview);
  }
  slot.selectedFileName = "";
  slot.selectedImagePreview = "";
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.onload = () => {
      const value = String(reader.result || "");
      const [, base64 = ""] = value.split(",");
      resolve({ base64 });
    };
    reader.readAsDataURL(file);
  });
}

async function refresh() {
  await loadAppState();
  render();
}

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  registerError.textContent = "";
  try {
    const data = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ phone: phoneInput.value }),
    });
    saveSession(data);
    registerDialog.close();
    await refresh();
  } catch (error) {
    registerError.textContent = error.message;
  }
});

resetUser.addEventListener("click", () => {
  localStorage.removeItem("glucolit:user");
  localStorage.removeItem("glucolit:session");
  state.user = null;
  state.sessionToken = null;
  state.appState = null;
  clearSelectedImage();
  render();
});

navButtons.forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

if (state.user) {
  loadAppState()
    .catch(() => {
      localStorage.removeItem("glucolit:user");
      localStorage.removeItem("glucolit:session");
      state.user = null;
    })
    .finally(render);
} else {
  render();
}
