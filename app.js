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
  latestAnalysis: null,
  latestAnalysisMeta: null,
  selectedFileName: "",
  selectedImagePreview: "",
  selectedContent: null,
  streamText: "",
  streamStatus: "",
  loading: false,
};

const statusLabels = {
  attention: "需关注",
  responded: "已响应",
  completed: "今日已完成",
};

const toolLabels = {
  report: "报告解读",
  meal: "餐盘分析",
  label: "配料表分析",
};

const categoryOrder = ["diet", "sleep", "exercise", "stress", "energy"];

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

async function analyzeApi(body) {
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
    applyAnalysisResult(data);
    return;
  }

  await readAnalysisStream(response);
}

async function readAnalysisStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

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
      state.latestAnalysisMeta = { fallback: payload.fallback, model: payload.model, thinking: payload.thinking };
      state.streamStatus = "正在看清图片里的关键信息";
      updateStreamOutput();
    }
    if (event === "token") {
      state.streamText += payload.content || "";
      state.streamStatus = "正在整理成你能直接用的建议";
      updateStreamOutput();
    }
    if (event === "fallback") {
      state.streamStatus = payload.message ? "图片信息不够稳定，先给你一份参考建议" : "先给你一份参考建议";
      updateStreamOutput();
    }
    if (event === "done") {
      applyAnalysisResult(payload);
      updateStreamOutput();
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

function applyAnalysisResult(data) {
  state.latestAnalysis = data.analysis;
  state.latestAnalysisMeta = { fallback: data.fallback, model: data.model, model_error: data.model_error };
  state.streamStatus = data.fallback ? "已整理参考建议" : "建议已生成";
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
    app.innerHTML = `<section class="stack"><div class="hero-card"><p class="eyebrow">Welcome</p><h2>把异常指标变成今天能做到的一小步</h2><p class="muted">输入手机号后进入 GLUCOLIT 黑客松 Demo。</p></div></section>`;
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
            <p class="eyebrow">今日健康概览 · ${metrics.dataSource}</p>
            <h2>早上好，今天稳一点</h2>
          </div>
          <span class="status-pill${statusClass}">${statusLabels[daily.status]}</span>
        </div>
        <div class="wellness-score">
          <div class="score-ring" aria-label="今日状态 82 分">
            <strong>82</strong>
            <span>状态良好</span>
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
          <h2>AI 监控预警</h2>
          <button class="ghost-button" data-go="actions" type="button">去行动</button>
        </div>
        <ul class="warning-list">
          ${daily.reasons
            .map((reason) => `<li><strong>${reason}</strong><span>影响：可能让餐后波动更难回落。</span><em>行动：连接到今晚一个低风险小行动。</em></li>`)
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
          ${(data.recentAnalysis.length ? data.recentAnalysis : [{ title: "还没有识别记录", summary: "去 AI 工具页用样例报告、餐盘或配料表跑一次。" }])
            .map((item) => `<li><strong>${item.title}</strong><br><span class="small">${item.summary}</span></li>`)
            .join("")}
        </ul>
      </div>
      ${boundary()}
    </section>
  `;
}

function choiceGroup(kind, options, active) {
  return `
    <div class="choice-grid" data-choice="${kind}">
      ${options.map((option) => `<button class="choice-button${option === active ? " active" : ""}" type="button" data-value="${option}">${option}</button>`).join("")}
    </div>
  `;
}

function renderTools() {
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
        <div class="scanner-frame${state.selectedImagePreview ? " has-preview" : ""}">
          <div class="scanner-line"></div>
          ${state.selectedImagePreview ? renderScannerPreview() : `
            <strong>${scannerHint(state.selectedTool)}</strong>
            <span>${scannerIdleCopy(state.selectedTool)}</span>
          `}
        </div>
        <input class="file-input" id="photoInput" type="file" accept="image/*">
        <div class="tool-actions">
          <button class="primary-button" type="button" data-photo-trigger>${state.loading ? "正在为你分析..." : "拍照上传"}</button>
          <button class="secondary-button" type="button" data-analyze="${state.selectedTool}">使用样例</button>
        </div>
      </div>
      ${state.loading || state.streamText ? renderStreamOutput() : ""}
      ${state.latestAnalysis ? renderAnalysis(state.latestAnalysis) : ""}
      ${boundary()}
    </section>
  `;
}

function renderScannerPreview() {
  return `
    <img class="scanner-preview" src="${escapeHtml(state.selectedImagePreview)}" alt="已上传图片预览">
    <div class="scanner-caption">
      <strong>${escapeHtml(state.selectedFileName || "已选择图片")}</strong>
      <span>${scannerSelectedCopy(state.selectedTool)}</span>
    </div>
  `;
}

function toolIntro(type) {
  if (type === "report") return "识别 HbA1c、空腹血糖、餐后 2 小时血糖等字段，并要求用户校对。";
  if (type === "meal") return "识别主食、蛋白、蔬菜和烹饪方式，输出碳水风险和替换建议。";
  return "识别添加糖、精制碳水、蛋白和膳食纤维，给出购买建议。";
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
  if (state.loading) return "正在读取";
  if (state.selectedFileName && !state.latestAnalysis && state.streamStatus) return "请重试";
  if (state.latestAnalysisMeta?.fallback === false) return "已生成建议";
  if (state.latestAnalysis) return "参考建议";
  return "可拍照上传";
}

function scannerIdleCopy(type) {
  if (type === "report") return "拍清楚指标和参考范围，我会帮你圈出需要校对的地方";
  if (type === "meal") return "拍完整餐盘，我会看主食、蛋白、蔬菜和烹饪方式";
  return "拍清楚配料表和营养成分，我会帮你判断适不适合常买";
}

function scannerSelectedCopy(type) {
  if (!state.loading && state.latestAnalysis) return "已根据这张图生成建议，可重新拍照替换";
  if (!state.loading && state.streamStatus) return "这张图已保留，可重新拍照再试";
  if (type === "report") return "已收到图片，正在找血糖、胰岛素和 HbA1c 等关键项";
  if (type === "meal") return "已收到图片，正在看餐盘结构和餐后波动风险";
  return "已收到图片，正在看添加糖、膳食纤维、蛋白质和碳水";
}

function renderAnalysis(analysis) {
  const result = analysis.result;
  const sourceLabel =
    state.latestAnalysisMeta?.fallback === false
      ? "已生成建议"
      : "参考建议";
  if (analysis.type === "report") {
    return `
      <div class="analysis-card stack">
        <div class="panel-header"><h3>${analysis.title}</h3><span class="risk-pill">${sourceLabel}</span></div>
        <p class="muted">${analysis.summary}</p>
        ${result.key_findings?.length ? `<ul class="warning-list">${result.key_findings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
        <div class="field-table">
          ${(result.fields || []).map((field) => `<div><strong>${escapeHtml(field.label)}</strong><span>${escapeHtml(field.value)}<br><small>${escapeHtml(field.note)}</small></span></div>`).join("")}
        </div>
        ${result.interpretation ? `<p class="helper">${escapeHtml(result.interpretation)}</p>` : ""}
        ${result.action_suggestions?.length ? `<p class="helper">行动建议：${result.action_suggestions.map(escapeHtml).join("；")}</p>` : ""}
        ${result.doctor_questions?.length ? `<p class="helper">就诊时可问：${result.doctor_questions.map(escapeHtml).join("；")}</p>` : ""}
        <button class="secondary-button" type="button">确认无误，生成今日行动</button>
      </div>
    `;
  }
  if (analysis.type === "meal") {
    return `
      <div class="analysis-card stack">
        <div class="panel-header"><h3>${analysis.title}</h3><span class="risk-pill">${sourceLabel}</span></div>
        <p class="muted">${analysis.summary}</p>
        ${result.plate ? `<div class="field-table">
          <div><strong>主食</strong><span>${escapeHtml(result.plate.staple || "")}</span></div>
          <div><strong>蛋白质</strong><span>${escapeHtml(result.plate.protein || "")}</span></div>
          <div><strong>蔬菜</strong><span>${escapeHtml(result.plate.vegetables || "")}</span></div>
          <div><strong>烹饪</strong><span>${escapeHtml(result.plate.cooking || "")}</span></div>
        </div>` : ""}
        <p class="helper">碳水风险：${escapeHtml(result.carbRisk || "中")}</p>
        <ul class="warning-list">${result.observations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        ${result.nutrition_notes?.length ? `<p class="helper">GI/GL/II 参考：${result.nutrition_notes.map(escapeHtml).join("；")}</p>` : ""}
        ${result.meal_order?.length ? `<p class="helper">进餐顺序：${result.meal_order.map(escapeHtml).join("；")}</p>` : ""}
        <p class="helper">替换建议：${result.swaps.map(escapeHtml).join("；")}</p>
      </div>
    `;
  }
  return `
    <div class="analysis-card stack">
      <div class="panel-header"><h3>${analysis.title}</h3><span class="risk-pill">${sourceLabel}</span></div>
      <p class="muted">${analysis.summary}</p>
      <ul class="warning-list">${result.reasons.map((item) => `<li>${item}</li>`).join("")}</ul>
      <p class="helper">替换建议：${result.alternatives.join("；")}</p>
      <p class="helper">${result.boundary}</p>
    </div>
  `;
}

function renderStreamOutput() {
  const readable = streamReadableText(state.streamText, state.selectedTool);
  return `
    <div class="stream-card" aria-live="polite" data-stream-card>
      <div class="stream-header">
        <span data-stream-status>${state.streamStatus || "准备读取图片"}</span>
        <i></i>
      </div>
      <p class="typewriter-text" data-stream-text>${escapeHtml(readable || streamPlaceholder(state.selectedTool))}</p>
    </div>
  `;
}

function updateStreamOutput() {
  const card = document.querySelector("[data-stream-card]");
  if (!card) {
    if (state.view === "tools") render();
    return;
  }

  const status = card.querySelector("[data-stream-status]");
  const text = card.querySelector("[data-stream-text]");
  if (status) status.textContent = state.streamStatus || "准备读取图片";
  if (text) text.textContent = streamReadableText(state.streamText, state.selectedTool) || streamPlaceholder(state.selectedTool);
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
  const doneCount = sorted.filter((action) => action.status === "done").length;

  return `
    <section class="stack">
      <div class="hero-card">
        <div class="hero-top">
          <div>
            <p class="eyebrow">今日行动</p>
            <h2>${doneCount}/${sorted.length} 已完成</h2>
          </div>
          <button class="ghost-button" type="button" data-complete-all>一键完成</button>
        </div>
        <p class="muted">今天只完成 3-5 件小事，不追求完美。</p>
      </div>
      ${sorted.map(renderActionCard).join("")}
      ${boundary()}
    </section>
  `;
}

function renderActionCard(action) {
  return `
    <div class="action-card ${action.status}">
      <div class="action-row">
        <div>
          <span class="tag">${action.title}</span>
          <p class="muted">${action.detail}</p>
          <p class="small">状态：${action.status === "done" ? "已完成" : action.status === "confirmed" ? "已确认" : "未开始"}</p>
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
          <p class="eyebrow">用户主动发起</p>
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
          <h2>身体成分</h2>
          <span class="tag">固定档案</span>
        </div>
        <div class="mini-metric-grid">
          ${profile.bodyComposition.map((item) => `<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)} ${escapeHtml(item.unit)}</strong><small>${escapeHtml(item.note)}</small></div>`).join("")}
        </div>
      </div>

      <div class="card stack">
        <div class="panel-header">
          <h2>OGTT 曲线对比</h2>
          <span class="tag">基线 vs 复查</span>
        </div>
        ${renderOgttProfileChart(profile)}
        <ul class="content-list">${profile.ogtt.shape.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>

      ${latestExtraction ? renderLatestReportExtraction(latestExtraction) : ""}

      <div class="card stack">
        <div class="panel-header">
          <h2>固定指标档案</h2>
          <span class="tag">可由报告抽取</span>
        </div>
        ${profile.labGroups.map(renderProfileLabGroup).join("")}
      </div>

      <div class="card stack">
        <div class="panel-header">
          <h2>维护期优先级</h2>
          <span class="tag">防回潮</span>
        </div>
        <div class="priority-list">${profile.watchPriorities.map(renderPriorityItem).join("")}</div>
      </div>

      <div class="card stack">
        <div class="panel-header">
          <h2>复查计划</h2>
          <span class="tag">医生确认</span>
        </div>
        <div class="timeline-list">${profile.followUps.map(renderFollowUpItem).join("")}</div>
      </div>

      <div class="card stack">
        <div class="panel-header">
          <h2>监测目标</h2>
          <span class="tag">趋势观察</span>
        </div>
        <div class="mini-metric-grid">
          ${profile.monitoringTargets.map((item) => `<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong><small>按医生建议调整个人目标</small></div>`).join("")}
        </div>
      </div>

      <div class="card stack">
        <div class="panel-header">
          <h2>档案时间线</h2>
          <span class="tag">关键节点</span>
        </div>
        <div class="timeline-list">${profile.timeline.map(renderTimelineEvent).join("")}</div>
      </div>

      <div class="card stack">
        <div class="panel-header">
          <h2>我的行动清单</h2>
          <button class="ghost-button" type="button" data-go="actions">去打卡</button>
        </div>
        <ul class="content-list">${profile.actionChecklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>

      <div class="card">
        <h2>后续要沉淀的字段</h2>
        <div class="tag-row">${profile.fixedMetricSchema.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
      </div>
      <p class="medical-boundary">${escapeHtml(summary.boundary)}</p>
    </section>
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
    <div class="profile-chart" aria-label="复查 OGTT 葡萄糖曲线">
      <svg viewBox="0 0 320 132" role="img">
        <path class="profile-chart-band" d="M0 64 H320 V94 H0 Z"></path>
        <polyline class="profile-chart-line baseline" points="${baselinePoints}"></polyline>
        <polyline class="profile-chart-line latest" points="${points}"></polyline>
      </svg>
      <div class="profile-chart-legend">
        <span><i class="latest"></i>复查葡萄糖</span>
        <span><i class="baseline"></i>基线葡萄糖</span>
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

function renderLatestReportExtraction(extraction) {
  return `
    <div class="card stack">
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
        <p class="eyebrow">科普 / 社区</p>
        <h2>原站社区内容库</h2>
        <p class="muted">已从原站录入 ${guides.length} 个指南专题和 ${articles.length} 篇研究解读。当前先做内容阅读入口，不做发帖评论。</p>
      </div>
      <div class="content-section">
        <div class="section-heading">
          <p class="eyebrow">Topic clusters</p>
          <h2>指南专题</h2>
        </div>
        <div class="content-grid">${guides.map(renderGuideCard).join("")}</div>
      </div>
      <div class="content-section">
        <div class="section-heading">
          <p class="eyebrow">Latest research notes</p>
          <h2>研究解读</h2>
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
        <a class="text-link secondary-link" href="${guide.url}" target="_blank" rel="noreferrer">原站</a>
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
        <a class="text-link secondary-link" href="${article.url}" target="_blank" rel="noreferrer">原站</a>
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
      <a class="primary-button link-button" href="${item.url}" target="_blank" rel="noreferrer">打开原站完整内容</a>
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
      state.latestAnalysis = null;
      clearSelectedImage();
      render();
    });
  });
  document.querySelectorAll("[data-tool-shortcut]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedTool = button.dataset.toolShortcut;
      state.latestAnalysis = null;
      clearSelectedImage();
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
      setSelectedImage(file);
      state.loading = true;
      state.latestAnalysis = null;
      state.latestAnalysisMeta = null;
      state.streamText = "";
      state.streamStatus = "正在压缩并提交图片...";
      render();
      try {
        const image = await fileToBase64(file);
        await analyzeApi({
          user_id: state.user.id,
          type: state.selectedTool,
          photo_name: file.name,
          mime_type: file.type,
          image_data: image.base64,
        });
        await loadAppState();
      } catch (error) {
        state.streamStatus = error.message || "识别失败，请稍后重试";
      } finally {
        state.loading = false;
        render();
      }
    });
  });
  document.querySelectorAll("[data-analyze]").forEach((button) => {
    button.addEventListener("click", async () => {
      clearSelectedImage();
      state.loading = true;
      state.latestAnalysis = null;
      state.latestAnalysisMeta = null;
      state.streamText = "";
      state.streamStatus = "正在提交样例识别...";
      render();
      try {
        await analyzeApi({ user_id: state.user.id, type: button.dataset.analyze });
        await loadAppState();
      } catch (error) {
        state.streamStatus = error.message || "识别失败，请稍后重试";
      } finally {
        state.loading = false;
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

function setSelectedImage(file) {
  clearSelectedImage();
  state.selectedFileName = file.name || "已选择图片";
  if (typeof URL !== "undefined" && URL.createObjectURL) {
    state.selectedImagePreview = URL.createObjectURL(file);
  }
}

function clearSelectedImage() {
  if (state.selectedImagePreview && state.selectedImagePreview.startsWith("blob:") && typeof URL !== "undefined") {
    URL.revokeObjectURL(state.selectedImagePreview);
  }
  state.selectedFileName = "";
  state.selectedImagePreview = "";
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
