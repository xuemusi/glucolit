# GLUCOLIT 经典 Bug 案例库

日期：2026-07-05  
用途：把 GLUCOLIT 两天开发中反复出现的 bug 和返工模式沉淀为可复用案例，供后续需求设计、技术方案、测试用例、UI 验收和生产验证前检索。

配套 skill：

```text
/Users/huangqisheng/.agents/skills/bug-case-library
```

## 分类

| 分类 | 说明 |
| --- | --- |
| `requirements-drift` | 需求理解或范围变化导致返工 |
| `ui-quality` | UI 层级、排版、移动端、交互、可访问性问题 |
| `state-management` | 前端状态、tab、localStorage、打卡状态串台 |
| `ai-model` | 模型慢、模型输出差、OCR/JSON/兜底问题 |
| `production-cache` | 生产资源版本、缓存、本地与线上不一致 |
| `deployment-config` | 环境变量、secret、Cloudflare/D1 配置 |
| `concurrency` | 多会话/多分支并发修改冲突 |
| `test-gap` | 测试没覆盖用户可见行为 |
| `product-acceptance` | 工程通过但产品体验不通过 |

## 抽象模式层

具体案例只回答“这次哪里坏了”。抽象模式要回答“以后哪里还会用同一种方式坏掉”。后续修 bug 或做新功能时，先查本节，再看下面的具体案例证据。

| 模式 ID | 失败机制 | 不变量 | 早期信号 | 预防闸口 | 对应案例 |
| --- | --- | --- | --- | --- | --- |
| `P-ENV-VERIFY` | 本地、代码仓库、生产环境不是同一个事实源，任何一层都可能成功但用户仍看到旧结果。 | 用户验收必须基于生产事实，而不是本地通过或 Git 已推送。 | 用户说“我看还是旧的”、资源带版本号、CDN/Pages/浏览器缓存存在。 | 部署后生产 URL smoke，确认 HTML、JS/CSS 版本、关键 UI 文案和接口返回。 | `CACHE-001` |
| `P-RESULT-SCHEMA` | AI 或后端直接吐自然语言，前端被迫展示字段堆，产品结构失控。 | 用户可见结果必须先有结构 schema，再接模型和数据。 | 结果页像 OCR 字段列表、长段文字、缺少标准对比和行动建议。 | 先定义信息架构、表格、风险等级、建议分区和折叠层级，再开发接口。 | `UI-001`, `AI-002` |
| `P-STATE-SCOPE` | 多 tab、多工具、多模式共享状态，导致完成态、loading、结果和错误串台。 | 每个用户任务上下文都必须有独立状态槽。 | 页面有多个 tab/tool，但代码只有全局 `latestAnalysis`、`loading`、`error`。 | 技术方案先画状态模型，并补跨 tab 回归用例。 | `STATE-001` |
| `P-LATENCY-BUDGET` | 外部模型/网络链路延迟没有基准，前端用拍脑袋超时误杀成功请求。 | 超时、loading 和降级策略必须由真实 P95/P99 耗时决定。 | 模型链路串联 OCR、视觉和叙述；本地短样例能过，真实图片慢。 | 上线前用真实样例测端到端耗时、首响应、阶段完成和最终完成。 | `AI-001` |
| `P-AI-GUARDRAIL` | 模型输出被当成可靠专业结论，缺少规则层、禁用词和兜底结构。 | AI 输出只能作为候选表达，专业判断必须有规则和边界保护。 | 同图多模型结论差异大、出现绝对化健康建议、JSON 成功但内容不专业。 | schema + 规则计算 + 禁用词 + 默认建议 + 多模型质量样例。 | `AI-002` |
| `P-CONFIG-OBSERVABLE` | 生产 Secret、供应商、模型名和 base URL 不透明，本地无法复现，线上只能猜。 | 外部依赖配置必须可观测、可验证，但不能泄露敏感值。 | 本地 401、线上能跑、返回结果看不出真实 provider/model。 | 文档记录非敏感配置，接口返回 model/provider 标记，生产 smoke 验证。 | `PROD-001` |
| `P-CONCURRENT-TRUTH` | 多会话并发修改时，旧工作树和旧 UI 结构会把新改动覆盖掉。 | 修改前后的事实源必须是最新 main 和当前文件内容。 | 用户说“另一个会话改了”、同文件多人改、文档追加冲突。 | 开工前 fetch，提交前再 fetch，对同文件先读最新结构再 patch。 | `CONCURRENCY-001` |
| `P-MOBILE-INTERACTION` | 移动端不是桌面缩小版，hover、tap highlight、热区和 active 态会暴露粗糙感。 | 核心移动交互必须可触、可见、不会粘滞。 | 桌面截图好看但手机点击发灰、hover 粘住、按钮小于 44px。 | 移动端真实触控验收，hover 包 media query，按钮热区标准化。 | `UI-002` |

## 案例记录

## CACHE-001 前端代码已改但生产仍显示旧页面

- Category: `production-cache`
- Pattern: `P-ENV-VERIFY`
- Area: 首页 / 餐盘结果 / 报告结果
- Severity: P1

### Symptom

用户反馈“生产环境部署了？我看着还是这样子的，是缓存么”。本地代码或 GitHub main 已更新，但线上仍显示旧 UI 或旧交互。

### Root Cause

技术原因：静态资源 `app.js` / `styles.css` 版本号没有同步更新，或者后续提交把资源版本回退，浏览器继续加载旧资源。

流程原因：前端改动的完成标准只看提交和本地检查，没有强制验证生产 HTML 中的资源版本。

### Why Existing Checks Missed It

`npm run check` 只能做 JS 语法检查，不会覆盖生产缓存、Cloudflare Pages 部署结果和浏览器资源版本。

### Fix

每次前端行为或样式变更后更新 `index.html` 静态资源版本，并用生产 URL 检查 HTML 中实际加载的版本号。

### Prevention Checklist

- [ ] 前端 JS/CSS 行为变更后，更新资源版本号。
- [ ] 部署后 `curl https://glucolit.xuemusi.com` 确认版本号。
- [ ] Playwright 访问生产 URL，而不是只测本地文件。

### Regression Test

```bash
curl -fsSL "https://glucolit.xuemusi.com/?check=$(date +%s)" | rg "app.js\\?v=|styles.css\\?v="
```

### Related Workflow Gates

- product-development-workflow Gate 3: Deployment / Rollback
- product-development-workflow Gate 6: Production verification

## UI-001 用户截图发现排版不专业、内容像堆字段

- Category: `ui-quality`, `product-acceptance`
- Pattern: `P-RESULT-SCHEMA`
- Area: 报告分析结果 / 餐盘结果 / 配料表结果
- Severity: P0/P1

### Symptom

用户反馈报告内容少、没有专业建议、没有标准对比，排版堆在一起。餐盘和配料表最初也是长段文字或卡片堆叠，缺少表格、红绿灯、结构化指标。

### Root Cause

技术原因：前端直接渲染模型摘要和 OCR 字段，没有先定义“用户需要看的结果结构”。

流程原因：UI 验收标准缺失，没有在开发前规定报告必须有标准对比、曲线结构、专业建议和医生问题。

### Why Existing Checks Missed It

接口返回成功，语法检查通过，但没有产品人 walkthrough 和移动端截图验收。

### Fix

报告结果改为标准对比表、曲线结构表、计算指标卡、专业建议分区；餐盘/配料表改为表格、红绿灯和重点信号。

### Prevention Checklist

- [ ] AI 结果先设计结构，再接模型。
- [ ] UI 改动必须有 360/390 移动端截图。
- [ ] 产品人按“能否 5 秒看懂结论”验收。
- [ ] 专业内容默认分层，不把原始 OCR 字段作为主结果。

### Regression Test

上传报告样例后，结果页必须出现：

- `标准对比`
- `曲线结构`
- `计算指标`
- `专业建议`
- 原始 OCR 字段默认折叠

### Related Workflow Gates

- product-development-workflow Gate 2: Product And UI Design
- product-development-workflow Gate 7: Product Acceptance

## STATE-001 AI 工具 tab 切换后状态标签串台

- Category: `state-management`, `test-gap`
- Pattern: `P-STATE-SCOPE`
- Area: AI 工具页
- Severity: P1

### Symptom

报告、餐盘、配料表之间切换时，未生成结果的 tab 继承了另一个 tab 的“已生成建议”状态或结果残留。

### Root Cause

技术原因：前端只有全局 `latestAnalysis` / stream 状态，没有按 tool tab 分槽保存。

流程原因：技术方案未把 UI 状态模型画出来，测试用例只测单一路径，没有测跨 tab 切换。

### Why Existing Checks Missed It

单个工具分析能成功，接口也正常；缺少“生成报告 -> 切换餐盘 -> 切换配料表”的状态回归测试。

### Fix

按 `report` / `meal` / `label` 分槽保存结果、上传预览、流式状态和模型 meta，状态标签只读取当前 tab。

### Prevention Checklist

- [ ] 多 tab/多模式页面必须设计状态分槽。
- [ ] 测试用例必须覆盖跨 tab 切换和未生成态。
- [ ] 切换 tab 时确认 loading、error、done、preview 不串台。

### Regression Test

1. 报告页生成结果。
2. 切换餐盘页。
3. 预期餐盘页不显示报告结果，也不显示报告的“已生成建议”状态。

### Related Workflow Gates

- product-development-workflow Gate 3: Technical Plan
- product-development-workflow Gate 4: Test Plan Before Code

## AI-001 前端固定超时误杀慢模型成功请求

- Category: `ai-model`, `test-gap`
- Pattern: `P-LATENCY-BUDGET`
- Area: 餐盘图片分析
- Severity: P0

### Symptom

用户上传餐盘照片后页面提示失败或卡住，但生产后端实际上可以完成分析；真实链路总耗时超过前端固定 abort 窗口。

### Root Cause

技术原因：前端 35s 固定超时与真实模型链路不匹配；餐盘链路中视觉识别和叙述模型总耗时可能超过 100s。

流程原因：模型接入前没有做端到端延迟基准，也没有把“首 token 时间”和“done 时间”分开测。

### Why Existing Checks Missed It

本地样例和短路径通过，但没有用用户真实图片跑生产 `/api/analyze` SSE 完整链路。

### Fix

前端超时窗口延长到 150s；后端增加 `meal_vision_done`、`meal_narrative_done`、`llm_request_failed` 等结构化日志；后续切换更快模型。

### Prevention Checklist

- [ ] 模型链路上线前必须测真实样例端到端耗时。
- [ ] 分开记录首响应、首 token、阶段完成、最终 done。
- [ ] 慢模型路径必须有用户可理解的等待、重试或稍后查看。
- [ ] 前端超时不能短于 P95 链路耗时。

### Regression Test

用真实餐盘图请求生产 `/api/analyze`，记录：

- HTTP 200
- `fallback=false`
- `model_error=null`
- `done` 事件返回
- 总耗时在前端超时窗口内

### Related Workflow Gates

- product-development-workflow Gate 3: Failure Modes
- product-development-workflow Gate 6: Verification

## AI-002 模型输出不够专业，靠提示词无法保底

- Category: `ai-model`, `ui-quality`
- Pattern: `P-AI-GUARDRAIL`
- Area: 报告解读 / 配料表 / 餐盘
- Severity: P1

### Symptom

报告只输出简单总结，缺少标准对比和专业建议；配料表模型可能输出“完全不会引起血糖波动”等不合规或过度乐观表达。

### Root Cause

技术原因：模型直接承担专业结构、判断和文案，缺少后端规则层和前端结构化展示保底。

流程原因：先接模型再补产品结构，导致结果质量被模型波动放大。

### Why Existing Checks Missed It

只看模型能否返回 JSON，没有检查输出是否满足专业结构和合规词表。

### Fix

引入 OCR/视觉抽取 + 后端规则计算 + 叙述模型的分层结构；报告增加 `standard_comparison`、`curve_rows`、`derived_indicators`、`professional_advice`；配料表增加规则层和禁用词检查。

### Prevention Checklist

- [ ] AI 产品先定义结构化 schema 和规则层。
- [ ] 模型只负责表达时，仍要有后端默认建议兜底。
- [ ] 禁用词和医疗边界必须自动检查。
- [ ] 至少比较 2 个模型的质量和延迟。

### Regression Test

同一张报告/配料表图，结果必须包含结构化字段且不出现禁用词：

```text
治愈 / 逆转 / 保证降低血糖 / 建议吃药 / 停药 / 不能吃 / 必须吃
```

### Related Workflow Gates

- product-development-workflow Gate 3: Technical Plan
- product-development-workflow Gate 4: AI/model quality cases

## PROD-001 生产 Secret / 模型供应商配置不可见导致本地无法复现

- Category: `deployment-config`, `observability`
- Pattern: `P-CONFIG-OBSERVABLE`
- Area: 模型供应商配置
- Severity: P1

### Symptom

本地无法用相同 API Key 直测 `88996api.cloud` 的 Gemini 模型，返回 401；线上又能调用，说明生产 Secret 与本地环境不一致。

### Root Cause

技术原因：Cloudflare Pages Secret 存在线上，不在本地 `.env`；不同供应商 key 不通用。

流程原因：技术方案没有把“本地如何复现生产模型配置”写清楚。

### Why Existing Checks Missed It

只记录了 env 名称，没有记录本地验证路径、Secret 来源和不可见时的替代验证方法。

### Fix

通过生产 `/api/analyze` 的 `model` 字段和端到端耗时验证真实生效模型；文档记录 key 不入仓库。

### Prevention Checklist

- [ ] 每个外部供应商配置必须写清 Base URL、Model、Secret 名称。
- [ ] 本地无 Secret 时，必须写生产验证替代路径。
- [ ] 返回结果必须暴露非敏感 `model/provider` 标记。

### Regression Test

生产请求返回的 `model` 字段必须包含预期模型名，例如：

```text
qwen3-vl-plus label OCR + gemini-3.1-flash-lite-preview
```

### Related Workflow Gates

- product-development-workflow Gate 3: Deployment
- product-development-workflow Gate 6: Production verification

## CONCURRENCY-001 多会话并行修改同一页面导致冲突和回退风险

- Category: `concurrency`
- Pattern: `P-CONCURRENT-TRUTH`
- Area: 行动页 / 首页 / 文档
- Severity: P1

### Symptom

一个会话修改打卡记录，另一个会话已经重构行动页；继续套旧补丁会覆盖新设计。文档 `开发进度.md` 多次出现追加冲突。

### Root Cause

技术原因：多个会话同时修改同一文件，且分支基于旧 main。

流程原因：没有把 worktree、fetch、rebase、冲突识别作为每次改动前的强制步骤。

### Why Existing Checks Missed It

单会话视角看文件是合理的，但没有在编辑前确认远端最新提交和同文件并发变化。

### Fix

使用独立 worktree，编辑前 fetch；提交前再次 fetch/rebase；遇到 UI 已被另一个会话重构时丢弃旧补丁，重新基于最新结构设计。

### Prevention Checklist

- [ ] 开始前 `git fetch origin main`。
- [ ] 广泛改动使用 worktree。
- [ ] 提交前再次比较 `HEAD` 与 `origin/main`。
- [ ] 同文件冲突时优先理解新结构，不机械套旧 patch。

### Regression Test

提交前必须满足：

```bash
git fetch origin main
git rev-parse HEAD
git rev-parse origin/main
git status --short
```

### Related Workflow Gates

- product-development-workflow Gate 3: Concurrency
- product-development-workflow Gate 5: Implementation

## UI-002 移动端触控细节让产品显得粗糙

- Category: `ui-quality`, `product-acceptance`
- Pattern: `P-MOBILE-INTERACTION`
- Area: 全局按钮 / 链接 / 卡片
- Severity: P2

### Symptom

移动端点击出现系统蓝/灰高亮，按钮缺少按下态，部分交互热区小于 44px，hover 样式在触控屏上粘滞。

### Root Cause

技术原因：CSS 没有统一移动端 tap highlight、active state、touch target 和 hover media query。

流程原因：UI 验收只看静态截图，没有检查真实触控交互和可访问性。

### Why Existing Checks Missed It

桌面预览和视觉截图不暴露触控按压、粘滞 hover 和热区问题。

### Fix

全局规整触控交互：扩大 tap highlight 屏蔽范围、补 active 状态、按钮最小 44px、hover 包裹 `@media (hover: hover)`。

### Prevention Checklist

- [ ] 所有核心按钮最小触控高度 44px。
- [ ] 触控屏不依赖 hover 表达状态。
- [ ] icon-only 或短文本按钮有足够热区。
- [ ] 移动端实际点击测试。

### Regression Test

Playwright mobile + 手动触控检查：

- 点击按钮无系统蓝灰高亮
- 按钮有可见 active 反馈
- 点击后 hover 不粘滞

### Related Workflow Gates

- product-development-workflow Gate 2: Interaction states
- product-development-workflow Gate 7: Product Acceptance

## 使用方式

新需求或修 bug 前，先查本文件：

```bash
rg "P-|Pattern|Prevention Checklist|Regression Test" docs/经典Bug案例库.md
```

如果发现相似模式，必须先回答这个模式的不变量是否会被本次改动破坏，再把对应 prevention checklist 加进本次技术方案或测试计划。
