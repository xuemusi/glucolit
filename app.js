const app = document.querySelector("#app");
const registerDialog = document.querySelector("#registerDialog");
const registerForm = document.querySelector("#registerForm");
const registerError = document.querySelector("#registerError");
const phoneInput = document.querySelector("#phoneInput");
const resetUser = document.querySelector("#resetUser");
const navButtons = [...document.querySelectorAll(".nav-button")];
const analysisTimeoutMs = 150000;

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
  devicePanelOpen: false,
  connectedDevices: JSON.parse(localStorage.getItem("glucolit:devices") || "{}"),
  syncingDevices: {},
  reportActionDraft: null,
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
    lastRequest: null,
    error: null,
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

const hardwareDevices = [
  {
    id: "apple_watch",
    name: "Apple Watch",
    signal: "步数 / 睡眠 / 心率",
    status: "建议优先接入",
    accent: "mint",
  },
  {
    id: "cgm",
    name: "CGM 传感器",
    signal: "餐后曲线 / 波动",
    status: "预留接口",
    accent: "amber",
  },
  {
    id: "scale_bp",
    name: "体脂秤与血压计",
    signal: "体重 / 腰围 / 血压",
    status: "可手动同步",
    accent: "teal",
  },
];

const categoryOrder = ["diet", "sleep", "exercise", "stress", "energy"];
const actionContext = {
  diet: {
    source: "发现你最近的餐后血糖有些波动",
    rationale: "调换一下吃饭顺序（先吃菜和肉，最后吃主食）比单纯挨饿容易得多。这样能给血糖铺个“缓冲垫”，不让它坐过山车。",
    fallback: "如果今天没准备杂粮饭，只做到“把白米饭留到最后吃”，也已经非常棒了。",
    guard: "注意：如果感到心慌、手抖、手心出汗或头晕，这可能是低血糖信号，请立刻吃糖并视情况就医。正在用药的糖友请加倍小心。",
  },
  sleep: {
    source: "看到你最近 3 天的睡眠都不到 7 小时",
    rationale: "睡眠不足是身体隐形的压力源，会直接降低第二天的胰岛素敏感性。今晚早睡一点，明天控糖底气更足。",
    fallback: "如果今天实在无法早睡，就挑战在睡前 10 分钟把手机放到一旁，静静躺会儿。",
    guard: "注意：如果你经常整夜失眠、半夜憋醒，或者白天经常控制不住地犯困，建议找专业医生聊聊睡眠健康。",
  },
  exercise: {
    source: "检测到你餐后血糖有些偏高，且最近 3 天没怎么饭后散步",
    rationale: "饭后是血糖冲高的关键期，这时候稍微活动一下，就像一把“隐形扫帚”，能帮身体把多余的糖分消耗掉。今天我们优先盯防你近期血糖峰值最高的晚餐后。",
    fallback: "实在没时间或太累？饭后哪怕只走 8 分钟，也已经能起作用了。动起来就是胜利。",
    guard: "注意：如果运动中觉得头晕、胸闷、喘不过气，请立刻停下休息并喝点水。千万别硬撑，身体最重要。",
  },
  stress: {
    source: "捕捉到你今天有些精神紧绷、压力偏大",
    rationale: "压力荷尔蒙会直接让血糖升高。通过慢呼吸帮身体踩下神经的“刹车”，能让你放松下来，有效防止晚上因为情绪性压力而想吃零食。",
    fallback: "静不下心做足 3 分钟？只做 6 次深呼吸也可以，这已经能给身体发出放松的信号了。",
    guard: "注意：如果在深呼吸时感觉胸闷、憋气或头晕，请立刻换回平时的呼吸节奏，别勉强自己。",
  },
  energy: {
    source: "发现你最近一到下午就比较容易疲惫困倦",
    rationale: "下午犯困往往伴随着血糖的大起大落。提前用无糖茶和坚果做个“防护盾”，可以平稳你下午的精力和血糖状态。",
    fallback: "如果今天特别想喝甜的，试试改点微糖，或者只喝半杯，这已经是一大步跨越了。",
    guard: "注意：下午如果要喝含咖啡因的茶或咖啡，建议在睡前 6 小时前喝完。如果减少了甜食，也要留意身体有没有明显的低血糖心慌反应。",
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
  const slot = toolState(tool);
  slot.lastRequest = body;
  slot.error = null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, analysisTimeoutMs);

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept: "text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) {
      clearTimeout(timeoutId);
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "请求失败");
    }

    if (!contentType.includes("text/event-stream")) {
      clearTimeout(timeoutId);
      const data = await response.json();
      applyAnalysisResult(data, tool);
      return;
    }

    await readAnalysisStream(response, tool, controller);
    clearTimeout(timeoutId);
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
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
  const frame = document.querySelector('.app-frame');
  if (frame) {
    if (state.user && state.view === 'home') {
      frame.classList.add('theme-nature');
      if (!frame.querySelector('.leaf-spray')) {
        const spray = document.createElement('div');
        spray.className = 'leaf-spray';
        spray.setAttribute('aria-hidden', 'true');
        spray.innerHTML = '<span></span><span></span><span></span><span></span><span></span>';
        frame.appendChild(spray);
      }
    } else {
      frame.classList.remove('theme-nature');
      const spray = frame.querySelector('.leaf-spray');
      if (spray) spray.remove();
    }
  }

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
    <header class="brand">
      <div>
        <p class="eyebrow">AI Metabolic Companion</p>
        <div class="logo-row">
          <span class="logo-mark"></span>
          <h1 class="wordmark">GLUCOLIT</h1>
        </div>
      </div>
      <button class="switch" type="button">
        <svg class="swap-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4"></path><path d="M3 6h18"></path><path d="M7 22l-4-4 4-4"></path><path d="M21 18H3"></path></svg>
        <span>切换</span>
      </button>
    </header>

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
            <div class="score-dot"></div>
          </div>
          <div>
            <p class="focus-copy">餐后峰值偏高叠加睡眠不足。今天先完成峰值最高那餐后的轻走动，不需要重启完整计划。</p>
            <div class="soft-checks" aria-label="今日记录摘要">
              <span>饮食 2/3 记录</span>
              <span>睡眠 7.2 小时</span>
              <span>运动 30 分钟</span>
            </div>
          </div>
        </div>
        <div class="chart-box" id="variant-three">
          <div class="chart-meta"><span>近24小时血糖趋势 ⓘ</span><span>mmol/L</span></div>
          <div class="axis-y"><span>15</span><span>12</span><span>9</span><span>6</span><span>3</span></div>
          <svg viewBox="0 0 330 130" aria-hidden="true" preserveAspectRatio="none">
            <path d="M36 91 C82 85, 120 50, 168 48 C204 46, 225 83, 242 83 C265 83, 285 73, 315 76 L315 115 L36 115 Z" fill="rgba(52, 145, 65, 0.12)"></path>
            <path d="M36 91H315M36 74H315M36 56H315M36 39H315" stroke="rgba(97, 111, 95, 0.15)" stroke-dasharray="5 6"></path>
            <path d="M36 91 C82 85, 120 50, 168 48 C204 46, 225 83, 242 83 C265 83, 285 73, 315 76" fill="none" stroke="#209a43" stroke-width="2.5" stroke-linecap="round"></path>
            <circle cx="168" cy="48" r="5" fill="#f17724" stroke="#fff" stroke-width="2.5"></circle>
            <circle cx="242" cy="83" r="5" fill="#79c829" stroke="#fff" stroke-width="2.5"></circle>
            <circle cx="315" cy="76" r="5" fill="#09a746" stroke="#fff" stroke-width="2.5"></circle>
          </svg>
          <div class="axis-x"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
        </div>
        <div class="metric-grid">
          <div class="metric-card">
            <span>餐后峰值</span>
            <strong>${metrics.glucoseTrend[1].value}</strong>
            <em>mmol/L</em>
          </div>
          <div class="metric-card">
            <span>睡眠</span>
            <strong>${metrics.sleepHours}</strong>
            <em>小时</em>
          </div>
          <div class="metric-card">
            <span>未打卡</span>
            <strong>${metrics.missedCheckinDays}</strong>
            <em>天</em>
          </div>
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
      ${renderHardwareDock()}
      ${boundary()}
    </section>
  `;
}

function renderHardwareDock() {
  const connectedCount = hardwareDevices.filter((device) => state.connectedDevices[device.id]).length;
  const panelClass = state.devicePanelOpen ? " open" : "";
  const isAnySyncing = hardwareDevices.some((d) => state.syncingDevices?.[d.id]);
  
  return `
    <div class="device-float${panelClass}" aria-label="硬件设备接入">
      <!-- Hover 胶囊气泡提示 -->
      <div class="device-tooltip">
        <span class="device-tooltip-icon">⌚️</span>
        <span class="device-tooltip-text">可接入智能手表评估数据</span>
      </div>

      <!-- 悬浮圆形按钮 (Watch Orb) -->
      <button class="device-orb" type="button" data-device-panel-toggle aria-expanded="${state.devicePanelOpen ? "true" : "false"}">
        <!-- 呼吸雷达外圈 -->
        <span class="device-orb-pulse-ring"></span>
        <span class="device-orb-pulse-ring2"></span>
        
        <!-- 表盘内容 -->
        <div class="device-orb-watch">
          <!-- 环形同步进度条 -->
          <svg class="device-orb-svg" viewBox="0 0 40 40">
            <circle class="orb-track" cx="20" cy="20" r="16"></circle>
            <circle class="orb-progress" cx="20" cy="20" r="16" style="stroke-dasharray: 100; stroke-dashoffset: ${100 - (connectedCount / 3) * 100}"></circle>
          </svg>
          <div class="device-orb-icon-inner">
            <!-- 手表矢量图 (Apple Watch 风格) -->
            <svg class="watch-icon-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 5V2.5C9 2.22 9.22 2 9.5 2h5c0.28 0 0.5 0.22 0.5 0.5V5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              <path d="M9 19v2.5c0 0.28 0.22 0.5 0.5 0.5h5c0.28 0 0.5-0.22 0.5-0.5V19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              <rect x="6.5" y="5" width="11" height="14" rx="3.2" fill="rgba(13, 108, 97, 0.08)" stroke="currentColor" stroke-width="1.8" />
              <rect x="17.5" y="7.5" width="1.2" height="3" rx="0.6" fill="currentColor" />
              <rect x="17.5" y="12" width="1" height="3.5" rx="0.5" fill="currentColor" />
              <circle cx="12" cy="12" r="3.5" stroke="var(--mint)" stroke-width="1.2" stroke-dasharray="16 6" stroke-linecap="round" />
              <circle cx="12" cy="12" r="1.8" stroke="currentColor" stroke-width="1" stroke-dasharray="8 4" opacity="0.6" />
            </svg>
          </div>
          
          <!-- 指示灯 / 连接数 Badge -->
          <span class="device-orb-badge ${connectedCount > 0 ? "has-connected" : ""}">
            ${connectedCount > 0 ? connectedCount : "+"}
          </span>
        </div>
      </button>

      <!-- 展开的设备接入面板 (Device Panel) -->
      <div class="device-panel" role="region" aria-label="设备接入面板">
        <div class="device-panel-head">
          <div>
            <p class="eyebrow">实时健康数据同步</p>
            <h2>将可穿戴设备接进今日健康评估</h2>
          </div>
          <button class="device-close" type="button" data-device-panel-toggle aria-label="收起设备接入面板">×</button>
        </div>
        
        <!-- 同步拟真动画区 (Apple Watch 卡片 + 脉冲心电 + 粒子束) -->
        <div class="device-sync-stage" aria-label="设备同步动画">
          <div class="watch-face-card ${connectedCount > 0 ? "active" : ""}">
            <div class="watch-screen">
              <div class="watch-screen-status">
                <span class="watch-screen-dot ${connectedCount > 0 ? "online" : ""}"></span>
                <span>WATCH</span>
              </div>
              <div class="watch-screen-content">
                <!-- 动态心电脉冲 -->
                <svg class="pulse-wave-svg" viewBox="0 0 60 20">
                  <path d="M0,10 L15,10 L18,3 L22,17 L25,7 L28,12 L31,10 L60,10" fill="none" stroke="currentColor" stroke-width="1.5"></path>
                </svg>
                <div class="watch-screen-data">
                  <strong>72</strong>
                  <small>bpm</small>
                </div>
              </div>
            </div>
          </div>
          
          <!-- 粒子能量光束 -->
          <div class="sync-beam-new ${isAnySyncing ? "syncing" : connectedCount > 0 ? "active" : ""}">
            <div class="beam-glow"></div>
            <div class="particles">
              <i></i><i></i><i></i>
            </div>
          </div>
          
          <!-- 血糖估计评估节点 -->
          <div class="glucose-node-new ${connectedCount > 0 ? "active" : ""}">
            <strong>6.8</strong>
            <span>餐后估计</span>
          </div>
        </div>
        
        <!-- 优化后的设备选项列表 -->
        <div class="device-list">
          ${hardwareDevices
            .map((device) => {
              const connected = Boolean(state.connectedDevices[device.id]);
              const syncing = Boolean(state.syncingDevices?.[device.id]);
              
              let actionText = device.status;
              let btnClass = device.accent;
              if (syncing) {
                actionText = "同步数据中...";
                btnClass += " syncing";
              } else if (connected) {
                actionText = "已接入今日";
                btnClass += " connected";
              }
              
              // 针对不同设备生成精细 SVG
              let deviceIconSvg = "";
              if (device.id === "apple_watch") {
                deviceIconSvg = `
                  <svg class="row-icon-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M9 5V2.5C9 2.22 9.22 2 9.5 2h5c0.28 0 0.5 0.22 0.5 0.5V5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                    <path d="M9 19v2.5c0 0.28 0.22 0.5 0.5 0.5h5c0.28 0 0.5-0.22 0.5-0.5V19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                    <rect x="6.5" y="5" width="11" height="14" rx="3.2" stroke="currentColor" stroke-width="1.8" />
                    <rect x="17.5" y="7.5" width="1.2" height="3" rx="0.6" fill="currentColor" />
                    <rect x="17.5" y="12" width="1" height="3.5" rx="0.5" fill="currentColor" />
                    <circle cx="12" cy="12" r="2.8" stroke="currentColor" stroke-width="1.2" opacity="0.75" />
                  </svg>
                `;
              } else if (device.id === "cgm") {
                deviceIconSvg = `
                  <svg class="row-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="9"></circle>
                    <path d="M12 7v10M7 12h10" stroke-dasharray="2 2"></path>
                    <circle cx="12" cy="12" r="3.5" fill="currentColor" fill-opacity="0.2"></circle>
                  </svg>
                `;
              } else {
                deviceIconSvg = `
                  <svg class="row-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="4"></rect>
                    <path d="M3 9h18M9 21V9"></path>
                    <circle cx="15" cy="15" r="1.5"></circle>
                  </svg>
                `;
              }
              
              return `
                <button class="device-row-new ${btnClass}" type="button" data-device-connect="${device.id}" ${syncing ? "disabled" : ""}>
                  <span class="device-icon-wrapper" aria-hidden="true">
                    ${deviceIconSvg}
                  </span>
                  <span class="device-row-info">
                    <strong>${device.name}</strong>
                    <small>${device.signal}</small>
                  </span>
                  <div class="device-row-status">
                    ${syncing ? '<span class="device-spinner"></span>' : ""}
                    <em>${actionText}</em>
                  </div>
                </button>
              `;
            })
            .join("")}
        </div>
        <p class="device-note">当前为演示接入状态；真实接入会在获得授权后同步步数、睡眠、心率和餐后曲线，用于生成更贴近当天的提醒。</p>
      </div>
    </div>
  `;
}

function buildHomeReminders(reasons = []) {
  const fallbacks = [
    {
      impact: "餐后回落可能变慢，晚间更容易疲惫。",
      action: "餐后 15–30 分钟内散步 15 分钟，有助于平稳餐后血糖、舒缓情绪。",
    },
    {
      impact: "第二天胰岛素敏感性可能下降，空腹状态更容易波动。",
      action: "23:30 前上床，睡前 30 分钟不刷短视频。",
    },
    {
      impact: "连续记录变少后，更难判断哪些行动真的有效。",
      action: "今天只补一个餐后 8 分钟轻走版本也算完成。",
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
        action: "今天做降级版：餐后先轻走 8 分钟，完成一件即可。",
      };
    }
    if (/餐后|晚餐|血糖|波动/.test(reason)) {
      return {
        signal: reason,
        impact: "晚餐后的波动会影响夜间恢复，也会影响第二天空腹状态。",
        action: "餐后 15–30 分钟内散步 15 分钟，有助于平稳餐后血糖、舒缓情绪。",
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
        ${slot.error ? `
          <div class="error-tip-box stack">
            <p class="error-message">${escapeHtml(slot.error.message)}</p>
          </div>
          <button class="retry-button" type="button" data-retry="${state.selectedTool}">重新发起识别</button>
        ` : ""}
        <div class="tool-actions">
          <button class="primary-button" type="button" data-photo-trigger ${slot.loading ? "disabled" : ""}>${slot.loading ? "正在为你分析..." : "拍照上传"}</button>
          <button class="secondary-button" type="button" data-analyze="${state.selectedTool}" ${slot.loading ? "disabled" : ""}>使用样例</button>
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
  if (slot.error) return slot.error.isTimeout ? "请求超时" : "识别失败";
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
        <p class="muted">${highlightReportText(analysis.summary)}</p>
        ${result.key_findings?.length ? `<ul class="report-finding-list">${result.key_findings.map((item) => `<li class="${reportTextTone(item)}">${highlightReportText(item)}</li>`).join("")}</ul>` : ""}
        ${renderReportStandardTable(result.standard_comparison || [])}
        ${renderReportCurveTable(result.curve_rows || [])}
        ${renderReportDerived(result.derived_indicators || [])}
        ${result.interpretation ? `<section class="report-section"><h4>专业解读</h4><p class="helper">${highlightReportText(result.interpretation)}</p></section>` : ""}
        ${renderReportAdvice(result.professional_advice || result.action_suggestions || [], "专业建议")}
        ${renderReportAdvice(result.doctor_questions || [], "就诊时可问")}
        ${renderRawFields(result.fields || [])}
        <button class="secondary-button" type="button" data-generate-report-action="${analysis.id}" ${reportActionButtonDisabled(analysis) ? "disabled" : ""}>${reportActionButtonLabel(analysis)}</button>
      </div>
      ${renderReportActionPreview(analysis)}
    `;
  }
  if (analysis.type === "meal") {
    return renderMealAnalysis(analysis, sourceLabel);
  }
  if (analysis.type === "label") {
    return renderLabelAnalysis(analysis, sourceLabel);
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

function reportActionDraftFor(analysis) {
  return state.reportActionDraft?.analysisId === analysis.id ? state.reportActionDraft : null;
}

function reportActionButtonLabel(analysis) {
  const draft = reportActionDraftFor(analysis);
  if (draft?.status === "generating") return "正在把报告转成今日行动...";
  if (draft?.status === "adding") return "正在加入今日行动...";
  if (draft?.status === "added") return "已加入今日行动";
  return "信息确认无误，生成今日行动";
}

function reportActionButtonDisabled(analysis) {
  const draft = reportActionDraftFor(analysis);
  return draft?.status === "generating" || draft?.status === "adding" || draft?.status === "added";
}

function reportActionCandidate() {
  const existing = state.appState?.actions?.find((action) => action.category === "exercise");
  return existing || {
    id: "",
    category: "exercise",
    title: "运动",
    detail: "饭后约 30 分钟开始散步，体力不足时先走 15-20 分钟。",
    status: "todo",
    source: "analysis",
  };
}

function actionDisplayDetail(action) {
  if (action?.category === "exercise" && action.source === "analysis") {
    return "饭后约 30 分钟开始散步，体力不足时先走 15-20 分钟。";
  }
  return action?.detail || "";
}

function renderReportActionPreview(analysis) {
  const draft = reportActionDraftFor(analysis);
  if (!draft || !["ready", "adding", "added"].includes(draft.status)) return "";

  const action = reportActionCandidate();
  const context = getActionContext(action);
  const added = draft.status === "added";
  const adding = draft.status === "adding";

  return `
    <div class="report-action-preview stack">
      <div class="panel-header">
        <div>
          <p class="eyebrow">${added ? "已加入今日行动" : "行动预览"}</p>
          <h3>已把报告转成今天的一件事</h3>
        </div>
        <span class="risk-pill">来自报告</span>
      </div>
      <p class="source-note"><strong>识别依据</strong><span>根据你的 OGTT / 胰岛素释放曲线，今天优先关注餐后血糖峰值管理。</span></p>
      <div class="action-steps compact">
        <p><strong>怎么去做</strong><span>${escapeHtml(actionDisplayDetail(action))}</span></p>
        <p><strong>为什么做</strong><span>${escapeHtml(context.rationale)}</span></p>
        <p><strong>做不到时</strong><span>${escapeHtml(context.fallback)}</span></p>
        <p class="guard"><strong>身体红线</strong><span>${escapeHtml(context.guard)}</span></p>
      </div>
      ${draft.error ? `<p class="form-error">${escapeHtml(draft.error)}</p>` : ""}
      <div class="report-action-buttons">
        ${
          added
            ? `<button class="primary-button" type="button" data-go="actions">去行动页打卡</button>`
            : `
              <button class="primary-button" type="button" data-add-report-action="${analysis.id}" ${adding ? "disabled" : ""}>${adding ? "正在加入..." : "加入今日行动"}</button>
              <button class="secondary-button" type="button" data-add-report-action="${analysis.id}" data-next-view="actions" ${adding ? "disabled" : ""}>去行动页打卡</button>
            `
        }
      </div>
    </div>
  `;
}

function renderLabelAnalysis(analysis, sourceLabel) {
  const result = analysis.result || {};
  const advice = labelAdvice(result.purchase_label || result.purchaseAdvice);

  return `
    <div class="analysis-card label-analysis stack">
      <div class="label-hero ${advice.className}">
        <div>
          <p class="eyebrow">配料表识别</p>
          <h3>${escapeHtml(analysis.title)}</h3>
          ${result.product?.name ? `<span>${escapeHtml(result.product.name)}</span>` : ""}
        </div>
        <strong>${escapeHtml(advice.label)}</strong>
      </div>
      <p class="label-summary">${highlightLabelText(analysis.summary)}</p>
      ${renderLabelTrafficTable(result.traffic_lights || [])}
      ${renderLabelIngredientTable(result.ingredients || [], result.nutrition || {})}
      <div class="label-signal-grid">
        ${renderLabelSignalList("好在哪里", result.positives || [], "good")}
        ${renderLabelSignalList("需要留意", result.concerns || result.reasons || [], "warn")}
      </div>
      ${renderLabelSignalList("怎么吃/怎么喝", result.use_tips || [], "neutral")}
      ${renderLabelSignalList("替代选择", result.alternatives || [], "good")}
      <p class="meal-source">${escapeHtml(sourceLabel)} · 基于食品控糖规则评估</p>
      <p class="helper">${escapeHtml(result.boundary || result.medical_boundary || "")}</p>
    </div>
  `;
}

function labelAdvice(value) {
  if (value === "适合常买" || value === "更适合") return { label: "适合常买", className: "good" };
  if (value === "不建议常买" || value === "建议替换") return { label: "不建议常买", className: "danger" };
  return { label: "偶尔少量", className: "warn" };
}

function renderLabelTrafficTable(items) {
  if (!items.length) return "";
  return `
    <section class="label-section">
      <h4>购买红绿灯</h4>
      <div class="label-table-wrap">
        <table class="label-table">
          <thead><tr><th>项目</th><th>判断</th><th>说明</th></tr></thead>
          <tbody>
            ${items.map((item) => `
              <tr>
                <td><strong>${highlightLabelText(item.label)}</strong></td>
                <td><span class="label-status ${escapeHtml(item.status || "watch")}">${escapeHtml(labelStatusText(item.status))}</span><small>${highlightLabelText(item.value || "")}</small></td>
                <td>${highlightLabelText(item.note || "")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderLabelIngredientTable(ingredients, nutrition) {
  const topIngredients = ingredients.slice(0, 8);
  const nutrientRows = [
    ["能量", nutrition.energy_kj, "kJ"],
    ["糖", nutrition.sugar_g, "g"],
    ["碳水", nutrition.carbohydrate_g, "g"],
    ["蛋白质", nutrition.protein_g, "g"],
    ["脂肪", nutrition.fat_g, "g"],
    ["钠", nutrition.sodium_mg, "mg"],
  ].filter((row) => row[1] !== null && row[1] !== undefined);
  if (!topIngredients.length && !nutrientRows.length) return "";
  return `
    <section class="label-section">
      <h4>识别到的配料和营养</h4>
      <div class="label-detail-grid">
        ${topIngredients.length ? `
          <div class="label-mini-panel">
            <span>配料顺序</span>
            <ol>${topIngredients.map((item) => `<li>${highlightLabelText(item.name)}</li>`).join("")}</ol>
          </div>
        ` : ""}
        ${nutrientRows.length ? `
          <div class="label-mini-panel">
            <span>营养成分 ${escapeHtml(nutrition.basis || "")}</span>
            <div class="label-nutrition-grid">
              ${nutrientRows.map(([label, value, unit]) => `<div><strong>${escapeHtml(String(value))}${escapeHtml(unit)}</strong><small>${escapeHtml(label)}</small></div>`).join("")}
            </div>
          </div>
        ` : ""}
      </div>
    </section>
  `;
}

function renderLabelSignalList(title, items, tone) {
  if (!items.length) return "";
  return `
    <section class="label-section label-signal ${tone}">
      <h4>${escapeHtml(title)}</h4>
      <ul>${items.map((item) => `<li class="${labelTextTone(item, tone)}">${highlightLabelText(item)}</li>`).join("")}</ul>
    </section>
  `;
}

function labelStatusText(status) {
  if (status === "good") return "友好";
  if (status === "bad") return "少买";
  return "留意";
}

function highlightLabelText(text) {
  const safe = escapeHtml(text || "");
  return safe.replace(
    /(不建议常买|偶尔少量|需控制|建议替换|需要留意|不能替代|不要长期大量|大量|少买|添加糖|白砂糖|蔗糖|果葡糖浆|麦芽糊精|蜂蜜|浓缩果汁|精制碳水|甜味剂|钠|高钠|饱和脂肪|反式脂肪|不突出|蛋白质\/膳食纤维不突出|控糖功效|医疗效果|功能成分|植物成分|0\s*糖|0\s*碳水|0g|0kJ|低钠|无糖|适合常买)/g,
    (match) => {
      const tone = /不建议|需控制|需要留意|不能替代|不要长期大量|大量|少买|添加糖|白砂糖|蔗糖|果葡糖浆|麦芽糊精|蜂蜜|浓缩果汁|精制碳水|甜味剂|高钠|饱和|反式|不突出|控糖功效|医疗效果|功能成分|植物成分/.test(match)
        ? "danger"
        : /0\s*糖|0\s*碳水|0g|0kJ|低钠|无糖|适合常买/.test(match)
          ? "good"
          : "warn";
      return `<mark class="label-mark ${tone}">${match}</mark>`;
    },
  );
}

function labelTextTone(text, fallback = "neutral") {
  if (/不建议|需控制|需要留意|不能替代|大量|添加糖|精制|甜味剂|钠|饱和|反式|不突出|控糖功效|医疗效果|功能成分/.test(text || "")) return "danger";
  if (/0\s*糖|0\s*碳水|无糖|低钠|适合|友好|替代含糖/.test(text || "")) return "good";
  return fallback;
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
  const actionItems = title === "建议吃法" ? withMealDefaultActions(items) : items;
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

function withMealDefaultActions(items) {
  const current = Array.isArray(items) ? items : [];
  const defaults = [];
  if (!current.some((item) => /211|2\s*份蔬菜/.test(item))) {
    defaults.push("采用 211 餐盘法（2 份蔬菜、1 份蛋白质、1 份主食），先按这个比例看当前餐盘，再调整主食份量。");
  }
  if (!current.some((item) => /先吃.*(菜|蔬菜).*蛋白.*(后|最后).*主食|1\/3.*(杂粮|杂豆)/.test(item))) {
    defaults.push("这餐蛋白质偏少、主食偏精细时，两个小调整：① 先吃菜和蛋白、最后吃主食；② 把 1/3 白米饭换成杂粮/杂豆。有助于平稳这餐的餐后血糖。");
  }
  return [...defaults, ...current];
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

function highlightReportText(text) {
  const safe = escapeHtml(text || "");
  return safe.replace(
    /(糖前期|糖尿病阈值|异常|偏高|升高|高于|需关注|观察偏高|回落偏慢|未完全回到|风险|高风险|餐后早期波动|餐后波动|3h|3小时|HOMA-IR|胰岛素抵抗|复查|HbA1c|OGTT 2h|OGTT 1h|正常|未达|<\s*5\.7|<\s*7\.8|0 糖|低钠)/g,
    (match) => {
      const tone = /糖前期|糖尿病阈值|异常|偏高|升高|高于|需关注|观察偏高|回落偏慢|未完全回到|风险|高风险|餐后早期波动|餐后波动|3h|3小时|HOMA-IR|胰岛素抵抗|复查/.test(match)
        ? "danger"
        : /正常|未达|<\s*5\.7|<\s*7\.8|0 糖|低钠/.test(match)
          ? "good"
          : "warn";
      return `<mark class="report-mark ${tone}">${match}</mark>`;
    },
  );
}

function reportTextTone(text) {
  if (/糖前期|糖尿病阈值|异常|偏高|升高|高于|需关注|观察偏高|回落偏慢|未完全回到|风险|高风险|餐后早期波动|胰岛素抵抗|复查/.test(text || "")) return "danger";
  if (/正常|未达|较稳|友好|0 糖|低钠/.test(text || "")) return "good";
  return "warn";
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
                    <td>${highlightReportText(row.indicator)}</td>
                    <td><strong>${highlightReportText(row.value)}</strong>${row.lab_reference ? `<small>实验室 ${highlightReportText(row.lab_reference)}</small>` : ""}</td>
                    <td>${highlightReportText(row.standard)}<small>${highlightReportText(row.note || "")}</small></td>
                    <td><span class="table-pill ${reportTextTone(row.judgement)}">${highlightReportText(row.judgement)}</span></td>
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
                    <td>${highlightReportText(row.glucose || "-")}</td>
                    <td>${highlightReportText(row.insulin || "-")}<small>${highlightReportText(row.insulin_ratio || "")}</small></td>
                    <td>${highlightReportText(row.c_peptide || "-")}<small>${highlightReportText(row.c_peptide_ratio || "")}</small></td>
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
        ${items.map((item) => `<div class="${reportTextTone(`${item.label} ${item.value} ${item.note}`)}"><span>${highlightReportText(item.label)}</span><strong>${highlightReportText(item.value)}</strong><small>${highlightReportText(item.note)}</small></div>`).join("")}
      </div>
    </section>
  `;
}

function renderReportAdvice(items, title) {
  if (!items.length) return "";
  return `
    <section class="report-section">
      <h4>${escapeHtml(title)}</h4>
      <ul class="content-list report-advice-list">${items.map((item) => `<li class="${reportTextTone(item)}">${highlightReportText(item)}</li>`).join("")}</ul>
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

  const loadingPhrases = [
    "正在提取报告中的",
    "已完成单位换算和",
    "正在识别餐盘中的",
    "已完成餐盘结构判断",
    "正在识别配料顺序",
    "已完成添加糖"
  ];
  if (loadingPhrases.some((phrase) => cleaned.includes(phrase))) {
    const lines = cleaned.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      return lines[lines.length - 1];
    }
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
  const primaryFromAnalysis = primary?.source === "analysis";

  return `
    <section class="stack">
      <div class="hero-card">
        <div class="hero-top">
          <div>
            <p class="eyebrow">今日行动</p>
            <h2>${primaryDone ? "太棒了，今天已搞定" : "今天，只专注这 1 件事"}</h2>
          </div>
          ${
            primary
              ? `<button class="ghost-button" type="button" data-action-id="${primary.id}">${primaryDone ? "撤销完成" : "我做到了"}</button>`
              : ""
          }
        </div>
        <p class="muted">${primaryFromAnalysis ? "根据刚确认的 OGTT / 胰岛素报告信号" : `根据你最近的身体信号（${primaryContext.source}）`}，AI 帮你挑出了今天的“头等大事”。先把这件事搞定，其他的都是加分项，不要有压力。</p>
      </div>
      ${primary ? `<div class="action-section"><p class="eyebrow">核心行动 ${primaryDone ? 1 : 0}/1</p>${renderActionCard(primary, true)}</div>` : ""}
      <div class="action-section">
        <div class="section-heading compact">
          <p class="eyebrow">加分挑战 ${optionalDoneCount}/${optional.length}</p>
          <h2>还有精力？再来一个</h2>
        </div>
        ${optional.map((action) => renderActionCard(action, false)).join("")}
      </div>
      ${renderCrisisSupportCard()}
      ${boundary()}
    </section>
  `;
}

function getActionContext(action) {
  if (!action) {
    return {
      source: "今日关注信号",
      rationale: "先完成一个低门槛行动。",
      fallback: "做不到时可以选择更轻的版本。",
      guard: "如出现明显身体不适，请先停止行动并按需咨询医生。",
    };
  }
  return actionContext[action.category] || actionContext.exercise;
}

function renderActionCard(action, isPrimary = false) {
  const context = getActionContext(action);
  return `
    <div class="action-card ${action.status} ${isPrimary ? "primary-action" : "optional-action"}">
      <div class="action-row">
        <div>
          <span class="tag">${isPrimary ? "核心行动" : action.title}</span>
          ${isPrimary ? `<h3>${action.title}</h3>` : ""}
          <div class="action-steps">
            <p><strong>怎么去做</strong><span>${escapeHtml(actionDisplayDetail(action))}</span></p>
            <p><strong>为什么做</strong><span>${escapeHtml(context.rationale)}</span></p>
            <p><strong>做不到时</strong><span>${escapeHtml(context.fallback)}</span></p>
            <p class="guard"><strong>身体红线</strong><span>${escapeHtml(context.guard)}</span></p>
          </div>
          ${action.status === "done" ? `<p class="small">${isPrimary ? "太棒了，今天的核心行动已搞定。连续坚持 3 天，我们一起来看身体的奇妙变化。" : "太棒了，加分行动已搞定。"}</p>` : ""}
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
          <p class="eyebrow">悄悄提醒</p>
          <h2>AI 行动陪伴</h2>
          <p class="muted">我注意到你今天有几个代谢小波动。别担心，我们不需要重新启动那些复杂的计划，今天先试试这一件简单的小事：饭后 15-30 分钟出门散散步，走 15 分钟就好。你觉得怎么样？</p>
        </div>
        <div class="wave" aria-hidden="true"></div>
        <button class="primary-button" type="button" data-companion-confirm>好呀，今天就做这件事</button>
        <button class="secondary-button" type="button" data-companion-light>有点难，能换个更轻松的吗</button>
      </div>
      ${renderCrisisSupportCard()}
      ${boundary()}
    </section>
  `;
}

function renderCrisisSupportCard() {
  return `
    <div class="card crisis-card">
      <h2>当你觉得有些累、需要人听听心里话时</h2>
      <p class="muted">如果此时你感到压力太大、情绪难以承受，或者有一些难过无助的念头，请记得你绝不是孤单一个人。我们可以随时停下来，向温暖的手伸出求助：</p>
      <ul class="content-list">
        <li>全国心理援助热线：12356（一键拨打）</li>
        <li>危及生命的紧急情况：拨打 120 / 110</li>
        <li>也可以联系你信任的家人或朋友陪在身边</li>
      </ul>
      <a class="primary-button support-call" href="tel:12356">拨打心理援助热线：12356</a>
    </div>
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
        <p class="profile-chart-copy">2 小时回落变快，是这次很关键的好变化；后续继续看复查趋势是否稳定。</p>
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
        <li>一次只改一个变量：${keywords[1] || "饮食、运动或睡眠"}，观察趋势变化。</li>
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
  const switchBtn = document.querySelector(".app-frame.theme-nature .switch");
  if (switchBtn) {
    switchBtn.addEventListener("click", () => {
      localStorage.removeItem("glucolit:user");
      localStorage.removeItem("glucolit:session");
      localStorage.removeItem("glucolit:devices");
      state.user = null;
      state.sessionToken = null;
      state.appState = null;
      state.connectedDevices = {};
      state.devicePanelOpen = false;
      clearSelectedImage();
      render();
    });
  }

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
  document.querySelectorAll("[data-device-panel-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      state.devicePanelOpen = !state.devicePanelOpen;
      render();
    });
  });
  document.querySelectorAll("[data-device-connect]").forEach((button) => {
    button.addEventListener("click", () => {
      const deviceId = button.dataset.deviceConnect;
      const isConnected = Boolean(state.connectedDevices[deviceId]);
      
      if (state.syncingDevices && state.syncingDevices[deviceId]) {
        return; // 同步中，防重复点击
      }
      
      if (!isConnected) {
        if (!state.syncingDevices) {
          state.syncingDevices = {};
        }
        state.syncingDevices[deviceId] = true;
        state.devicePanelOpen = true;
        render();
        
        setTimeout(() => {
          if (state.syncingDevices && state.syncingDevices[deviceId]) {
            delete state.syncingDevices[deviceId];
            state.connectedDevices = {
              ...state.connectedDevices,
              [deviceId]: true,
            };
            localStorage.setItem("glucolit:devices", JSON.stringify(state.connectedDevices));
            render();
          }
        }, 1200);
      } else {
        state.connectedDevices = {
          ...state.connectedDevices,
          [deviceId]: false,
        };
        localStorage.setItem("glucolit:devices", JSON.stringify(state.connectedDevices));
        state.devicePanelOpen = true;
        render();
      }
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
        console.error(error);
        const isTimeout = error.name === "AbortError";
        slot.error = {
          message: isTimeout ? "由于生成建议耗时较长（已超时），你可以稍后在“最近记录”中查看，或点击重试" : (error.message || "识别失败，请稍后重试"),
          isTimeout
        };
        slot.streamStatus = isTimeout ? "请求超时" : "识别失败";
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
        console.error(error);
        const isTimeout = error.name === "AbortError";
        slot.error = {
          message: isTimeout ? "由于生成建议耗时较长（已超时），你可以稍后在“最近记录”中查看，或点击重试" : (error.message || "识别失败，请稍后重试"),
          isTimeout
        };
        slot.streamStatus = isTimeout ? "请求超时" : "识别失败";
      } finally {
        slot.loading = false;
        render();
      }
    });
  });
  document.querySelectorAll("[data-retry]").forEach((button) => {
    button.addEventListener("click", async () => {
      const tool = button.dataset.retry;
      const slot = toolState(tool);
      if (!slot.lastRequest) return;
      slot.loading = true;
      slot.latestAnalysis = null;
      slot.latestAnalysisMeta = null;
      slot.streamText = "";
      slot.error = null;
      slot.streamStatus = "正在重新提交分析...";
      render();
      try {
        await analyzeApi(slot.lastRequest, tool);
        await loadAppState();
      } catch (error) {
        console.error(error);
        const isTimeout = error.name === "AbortError";
        slot.error = {
          message: isTimeout ? "由于生成建议耗时较长（已超时），你可以稍后在“最近记录”中查看，或点击重试" : (error.message || "识别失败，请稍后重试"),
          isTimeout
        };
        slot.streamStatus = isTimeout ? "请求超时" : "识别失败";
      } finally {
        slot.loading = false;
        render();
      }
    });
  });
  document.querySelectorAll("[data-generate-report-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const analysisId = button.dataset.generateReportAction;
      state.reportActionDraft = { analysisId, status: "generating" };
      render();
      window.setTimeout(() => {
        if (state.reportActionDraft?.analysisId !== analysisId || state.reportActionDraft.status !== "generating") return;
        state.reportActionDraft = { analysisId, status: "ready" };
        render();
      }, 700);
    });
  });
  document.querySelectorAll("[data-add-report-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const analysisId = button.dataset.addReportAction;
      state.reportActionDraft = { analysisId, status: "adding" };
      render();
      try {
        await api("/api/actions/from-analysis", {
          method: "POST",
          body: JSON.stringify({ user_id: state.user.id, analysis_id: analysisId }),
        });
        await loadAppState();
        state.reportActionDraft = { analysisId, status: "added" };
        if (button.dataset.nextView) {
          setView(button.dataset.nextView);
          return;
        }
        render();
      } catch (error) {
        console.error(error);
        state.reportActionDraft = { analysisId, status: "ready", error: error.message || "加入失败，请稍后重试" };
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
  localStorage.removeItem("glucolit:devices");
  state.user = null;
  state.sessionToken = null;
  state.appState = null;
  state.connectedDevices = {};
  state.devicePanelOpen = false;
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
