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
      state.streamStatus = payload.thinking === "disabled" ? "已关闭思考模式，正在流式识别..." : "正在流式识别...";
      render();
    }
    if (event === "token") {
      state.streamText += payload.content || "";
      state.streamStatus = "模型正在输出结构化结果...";
      render();
    }
    if (event === "fallback") {
      state.streamStatus = payload.message || "已切换兜底结果";
      render();
    }
    if (event === "done") {
      applyAnalysisResult(payload);
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
  state.streamStatus = data.fallback ? "已使用兜底结果" : "识别完成";
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
          <span class="risk-pill">${state.loading ? "流式识别中" : state.latestAnalysisMeta?.fallback === false ? "模型分析" : "失败自动兜底"}</span>
        </div>
        <div class="scanner-frame">
          <div class="scanner-line"></div>
          <strong>${state.selectedFileName || scannerHint(state.selectedTool)}</strong>
          <span>${state.selectedFileName ? "已选择图片，模型会边识别边输出结果" : "支持拍照/相册；识别结果会流式显示"}</span>
        </div>
        <input class="file-input" id="photoInput" type="file" accept="image/*">
        <div class="tool-actions">
          <button class="primary-button" type="button" data-photo-trigger>${state.loading ? "正在识别关键信息..." : "拍照上传"}</button>
          <button class="secondary-button" type="button" data-analyze="${state.selectedTool}">使用样例</button>
        </div>
      </div>
      ${state.loading || state.streamText ? renderStreamOutput() : ""}
      ${state.latestAnalysis ? renderAnalysis(state.latestAnalysis) : ""}
      ${boundary()}
    </section>
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

function renderAnalysis(analysis) {
  const result = analysis.result;
  const sourceLabel =
    state.latestAnalysisMeta?.fallback === false
      ? `模型分析 · ${state.latestAnalysisMeta.model || "kimi-k2.6"}`
      : "演示兜底结果";
  if (analysis.type === "report") {
    return `
      <div class="analysis-card stack">
        <div class="panel-header"><h3>${analysis.title}</h3><span class="risk-pill">${sourceLabel}</span></div>
        <p class="muted">${analysis.summary}</p>
        <div class="field-table">
          ${result.fields.map((field) => `<div><strong>${field.label}</strong><span>${field.value}<br><small>${field.note}</small></span></div>`).join("")}
        </div>
        <button class="secondary-button" type="button">确认无误，生成今日行动</button>
      </div>
    `;
  }
  if (analysis.type === "meal") {
    return `
      <div class="analysis-card stack">
        <div class="panel-header"><h3>${analysis.title}</h3><span class="risk-pill">${sourceLabel}</span></div>
        <p class="muted">${analysis.summary}</p>
        <ul class="warning-list">${result.observations.map((item) => `<li>${item}</li>`).join("")}</ul>
        <p class="helper">替换建议：${result.swaps.join("；")}</p>
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
  const readable = streamReadableText(state.streamText);
  return `
    <div class="stream-card" aria-live="polite">
      <div class="stream-header">
        <span>${state.streamStatus || "准备识别..."}</span>
        <i></i>
      </div>
      <p class="typewriter-text">${escapeHtml(readable || "等待模型返回第一段内容...")}</p>
    </div>
  `;
}

function streamReadableText(raw) {
  const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const summary = cleaned.match(/"summary"\s*:\s*"([^"]*)/);
  if (summary?.[1]) return summary[1];
  const title = cleaned.match(/"title"\s*:\s*"([^"]*)/);
  if (title?.[1]) return title[1];
  return cleaned.slice(0, 220);
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
      state.selectedFileName = "";
      render();
    });
  });
  document.querySelectorAll("[data-tool-shortcut]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedTool = button.dataset.toolShortcut;
      state.latestAnalysis = null;
      state.selectedFileName = "";
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
      state.selectedFileName = file.name || "已选择图片";
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
