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
            <p class="eyebrow">AI 监控中 · ${metrics.dataSource}</p>
            <h2>今日关注</h2>
          </div>
          <span class="status-pill${statusClass}">${statusLabels[daily.status]}</span>
        </div>
        <p class="focus-copy">餐后峰值偏高叠加睡眠不足。今晚先完成饭后 15-20 分钟步行，不需要重启完整计划。</p>
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
          <span class="risk-pill">${state.latestAnalysisMeta?.fallback === false ? "模型分析" : "失败自动兜底"}</span>
        </div>
        <div class="scanner-frame">
          <div class="scanner-line"></div>
          <strong>${state.selectedFileName || scannerHint(state.selectedTool)}</strong>
          <span>${state.selectedFileName ? "已选择图片，将使用演示识别结果完成流程" : "支持拍照/相册；Demo 会使用稳定样例结果"}</span>
        </div>
        <input class="file-input" id="photoInput" type="file" accept="image/*" capture="environment">
        <div class="tool-actions">
          <button class="primary-button" type="button" data-photo-trigger>${state.loading ? "正在识别关键信息..." : "拍照上传"}</button>
          <button class="secondary-button" type="button" data-analyze="${state.selectedTool}">使用样例</button>
        </div>
      </div>
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
  const content = data?.content || { articles: [], cases: [], event: null };
  return `
    <section class="stack">
      <div class="hero-card">
        <p class="eyebrow">科普 / 社区</p>
        <h2>可信内容和打卡样例</h2>
        <p class="muted">静态证明未来社区方向，不做发帖评论。</p>
      </div>
      ${content.articles.map((article) => `<article class="article-card"><span class="tag">${article.source}</span><h3>${article.title}</h3><p class="muted">${article.summary}</p></article>`).join("")}
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

function loadingMarkup() {
  return `<section class="stack"><div class="card"><h2>正在加载...</h2><p class="muted">正在读取演示用户状态。</p></div></section>`;
}

function bindViewEvents() {
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
      render();
      const image = await fileToBase64(file);
      const data = await api("/api/analyze", {
        method: "POST",
        body: JSON.stringify({
          user_id: state.user.id,
          type: state.selectedTool,
          photo_name: file.name,
          mime_type: file.type,
          image_data: image.base64,
        }),
      });
      state.latestAnalysis = data.analysis;
      state.latestAnalysisMeta = { fallback: data.fallback, model: data.model, model_error: data.model_error };
      state.loading = false;
      await loadAppState();
      render();
    });
  });
  document.querySelectorAll("[data-analyze]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.loading = true;
      render();
      const data = await api("/api/analyze", {
        method: "POST",
        body: JSON.stringify({ user_id: state.user.id, type: button.dataset.analyze }),
      });
      state.latestAnalysis = data.analysis;
      state.latestAnalysisMeta = { fallback: data.fallback, model: data.model, model_error: data.model_error };
      state.loading = false;
      await loadAppState();
      render();
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
