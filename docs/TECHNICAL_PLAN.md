# GLUCOLIT MVP 技术方案

版本：v1.0  
日期：2026-07-03  
部署目标：Cloudflare Pages + Pages Functions + D1  
生产域名：`https://glucolit.xuemusi.com`

## 1. 目标

本次实现黑客松 MVP，不做完整医疗健康平台。目标是跑通可演示闭环：

`手机号进入 -> 今日代谢首页 -> AI 工具识别报告/餐盘/配料表 -> 生成行动 -> 勾选打卡 -> 首页状态变化`

核心原则：

- 移动端 H5 优先，桌面端居中展示。
- AI 分析优先调用 Tokendance OpenAI-compatible chat completions，失败时回落到本地兜底样例，现场不依赖模型稳定性。
- D1 只保存演示必要状态：用户、每日状态、识别结果、行动、打卡。
- 页面全程使用健康教育和行为支持表达，不做诊断、治疗、用药建议或疗效承诺。

## 2. 页面设计

### 2.1 注册入口

用户输入手机号后直接注册或登录。

功能：

- 手机号基础校验。
- 未注册则创建用户，已注册则直接返回用户。
- 前端把 `user_id` 与 `session_token` 存入 `localStorage`。
- 不做短信验证码、密码、复杂用户体系。

### 2.2 首页

目标：5 秒内让评委看懂产品价值。

功能：

- 展示今日状态：`需关注` / `已响应` / `今日已完成`。
- 首页首屏使用深色 `今日关注 / AI 监控中` 状态卡，展示餐后峰值、睡眠、未打卡天数和餐后趋势曲线。
- 展示 2-3 条 AI 监控预警，每条包含信号、影响和行动。
- 支持压力/精力轻量选择。
- 展示最近报告、餐食、配料表和打卡记录。
- 用户完成行动后，首页状态自动变化。

### 2.3 AI 工具页

目标：一个入口承载报告解读、餐盘分析、配料表分析。

功能：

- 三个场景切换：`报告解读`、`餐盘分析`、`配料表分析`。
- 提供 scanner 风格拍照/上传入口，支持选择图片；MVP 当前上传后使用稳定样例结果完成分析。
- 同时提供 `使用样例` 兜底入口，保证路演稳定。
- 后端模型：`kimi-k2.6`，网关：`https://tokendance.space/gateway/v1`。
- API Key 存放在 Cloudflare Pages Secret：`TOKENDANCE_API_KEY`，不进入客户端和仓库。
- 报告解读展示关键指标和“确认无误”校对按钮。
- 餐盘分析展示餐盘结构、碳水风险、替换建议。
- 配料表分析展示购买建议、风险原因、食用边界。
- 分析结果写入 D1，失败时使用前端兜底结果。

### 2.4 行动页

目标：把 AI 分析转成当天能做的 checklist。

功能：

- 展示五类行动：饮食、睡眠、运动、压力、精力。
- 每类最多一条任务。
- 支持单项勾选。
- 支持一键完成 Demo。
- 全部完成后，今日状态变为 `completed`。

### 2.5 陪伴页 P1

目标：展示用户主动发起的 AI 陪伴入口。

功能：

- 电话式 UI。
- 预置一轮 AI 话术。
- 用户选择“愿意”后把运动行动标记为已确认。
- 不做真实外呼，不主动打扰用户。

### 2.6 科普/社区页 P1

目标：证明未来社区方向。

功能：

- 录入原站公开内容：6 个指南专题、9 篇研究解读。
- 指南专题展示标题、英文标签、摘要、关键词和原站链接。
- 研究解读展示标题、英文副标题、日期、证据标签、来源、摘要和原站链接。
- 支持点击 `查看详情` 在 H5 内阅读摘要、行动化阅读提示和证据边界。
- 2 条用户打卡样例。
- 1 个活动/服务卡片。
- 不做发帖、评论、点赞，也暂不复刻原站全文。

## 3. 数据库设计

D1 数据库：`glucolit`  
绑定名：`DB`

### 3.1 users

保存最小用户信息。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | 用户 ID |
| phone | TEXT UNIQUE | 手机号 |
| display_name | TEXT | 显示名 |
| profile | TEXT | 用户画像 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### 3.2 sessions

保存演示级登录态。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| token | TEXT PK | 会话 token |
| user_id | TEXT | 用户 ID |
| created_at | TEXT | 创建时间 |
| expires_at | TEXT | 过期时间 |

### 3.3 daily_states

保存每日状态和压力/精力记录。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | 状态 ID |
| user_id | TEXT | 用户 ID |
| date | TEXT | 日期 |
| status | TEXT | `attention` / `responded` / `completed` |
| stress_state | TEXT | 压力状态 |
| energy_state | TEXT | 精力状态 |
| metrics_json | TEXT | 血糖/睡眠/步数等 JSON |
| reasons_json | TEXT | 风险原因 JSON |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### 3.4 analysis_results

保存报告/餐盘/配料表分析结果。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | 分析 ID |
| user_id | TEXT | 用户 ID |
| type | TEXT | `report` / `meal` / `label` |
| title | TEXT | 标题 |
| summary | TEXT | 一句话总结 |
| risk_level | TEXT | `green` / `yellow` / `orange` / `red` |
| result_json | TEXT | 结构化结果 |
| confidence | TEXT | 置信度 |
| created_at | TEXT | 创建时间 |

### 3.5 actions

保存今日行动。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | 行动 ID |
| user_id | TEXT | 用户 ID |
| date | TEXT | 日期 |
| category | TEXT | `diet` / `sleep` / `exercise` / `stress` / `energy` |
| title | TEXT | 展示标题 |
| detail | TEXT | 行动内容 |
| status | TEXT | `todo` / `confirmed` / `done` |
| source | TEXT | `default` / `analysis` / `companion` |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### 3.6 checkins

保存打卡流水。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | 打卡 ID |
| user_id | TEXT | 用户 ID |
| action_id | TEXT | 行动 ID |
| date | TEXT | 日期 |
| note | TEXT | 备注 |
| created_at | TEXT | 创建时间 |

## 4. 接口设计

接口总数：8 个。

### 4.1 POST `/api/auth/register`

输入：

```json
{ "phone": "13800138000" }
```

输出：

```json
{
  "user": { "id": "usr_xxx", "phone": "13800138000", "display_name": "GLUCOLIT 用户" },
  "session_token": "sess_xxx"
}
```

### 4.2 GET `/api/app-state?user_id=...`

返回首页所需全部状态：用户、每日状态、行动、最近分析、健康档案、内容卡片。

`healthProfile` 当前为结构化种子档案，来源是用户提供的“我的健康档案”Markdown。后续可迁移到 D1：

- `health_profiles`：长期档案摘要。
- `health_metric_snapshots`：报告抽取后的指标快照。
- `health_assessments`：阶段判断、风险优先级和随访计划。

当前报告识别仍写入 `analysis_results`；“我的”页只读取最近一次报告里的 `result.ogtt` 作为待校对指标，不自动覆盖长期档案。

### 4.3 PATCH `/api/daily-state`

更新压力/精力。

输入：

```json
{ "user_id": "usr_xxx", "stress_state": "压力高", "energy_state": "疲惫" }
```

### 4.4 POST `/api/analyze`

触发模型分析，失败时回落样例分析。

输入：

```json
{
  "user_id": "usr_xxx",
  "type": "report",
  "photo_name": "report.jpg",
  "mime_type": "image/jpeg",
  "image_data": "base64..."
}
```

`type` 可选：`report`、`meal`、`label`。

输出包含：

- `analysis`：结构化分析结果。
- `fallback`：是否使用兜底样例。
- `model`：成功时返回模型名。
- `model_error`：兜底时用于调试的错误信息。

报告图片链路：

- `qwen3-vl-plus` 做 OCR，抽取葡萄糖、胰岛素、C 肽、HbA1c 等字段。
- 后端规则层计算 OGTT 标准对比、HOMA-IR、曲线峰值、3h 回落、胰岛素/C 肽相对空腹倍数。
- 叙述模型默认走 `REPORT_NARRATIVE_BASE_URL` + `REPORT_NARRATIVE_MODEL`；未配置 `REPORT_NARRATIVE_API_KEY` 时回退 `TOKENDANCE_MODEL`。
- 前端优先渲染规则层结构：`standard_comparison`、`curve_rows`、`derived_indicators`、`professional_advice`，避免模型文案偏弱时影响专业呈现。

### 4.5 GET `/api/actions?user_id=...`

查询今日行动。

### 4.6 PATCH `/api/actions/:id`

更新单条行动状态。

输入：

```json
{ "user_id": "usr_xxx", "status": "done" }
```

### 4.7 POST `/api/actions/complete`

一键完成今日行动。

输入：

```json
{ "user_id": "usr_xxx" }
```

### 4.8 GET `/api/content`

返回科普/社区静态内容。

## 5. 部署设计

- 代码仓库：`xuemusi/glucolit`
- 生产分支：`main`
- Cloudflare Pages 项目：`glucolit`
- D1：`glucolit`
- 自定义域名：`glucolit.xuemusi.com`
- 自动部署：GitHub Actions 调用 `cloudflare/wrangler-action@v3`

GitHub secrets：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## 6. 后续可扩展

- 接入真实多模态模型，把 `POST /api/analyze` 从样例结果替换为模型调用。
- 加短信验证码或 OAuth。
- 加真实上传文件到 R2。
- 加医生/营养师后台。
- 加设备数据接入和周期复盘。
