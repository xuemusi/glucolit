# GLUCOLIT MVP 测试用例

测试目标：验证生产环境 `https://glucolit.xuemusi.com` 能跑通黑客松 MVP 主流程。

## 1. 环境检查

| ID | 用例 | 步骤 | 预期 |
| --- | --- | --- | --- |
| ENV-001 | 首页可访问 | 打开 `/` | HTTP 200，页面出现 `Glucolit` |
| ENV-002 | 静态资源可访问 | 请求 `/styles.css`、`/app.js` | HTTP 200 |
| ENV-003 | API 可访问 | 请求 `/api/content` | HTTP 200，返回文章卡片 |

## 2. 注册

| ID | 用例 | 步骤 | 预期 |
| --- | --- | --- | --- |
| AUTH-001 | 新手机号注册 | POST `/api/auth/register`，手机号使用测试号 | 返回 `user.id` 和 `session_token` |
| AUTH-002 | 已有手机号再次进入 | 同手机号再次 POST | 返回同一手机号用户，不报错 |
| AUTH-003 | 非法手机号 | 输入 `abc` 或少于 6 位 | HTTP 400，返回错误 |

## 3. 首页

| ID | 用例 | 步骤 | 预期 |
| --- | --- | --- | --- |
| HOME-001 | 加载首页状态 | 注册后 GET `/api/app-state` | 返回 `dailyState.status=attention` |
| HOME-002 | 展示风险信号 | 打开首页 | 至少出现 2 条风险解释 |
| HOME-003 | 更新压力/精力 | PATCH `/api/daily-state` | 返回更新后的压力/精力 |
| HOME-004 | 最近记录 | 完成一次分析后返回首页 | 最近记录出现对应分析 |

## 4. AI 工具

| ID | 用例 | 步骤 | 预期 |
| --- | --- | --- | --- |
| AI-001 | 报告解读 | POST `/api/analyze`，`type=report` | 返回 HbA1c、空腹血糖、OGTT 等指标，并有边界声明 |
| AI-002 | 报告校对 | 前端点击“确认无误” | 页面进入可生成行动状态 |
| AI-003 | 餐盘分析 | POST `/api/analyze`，`type=meal` | 返回餐盘结构、碳水风险、替换建议 |
| AI-004 | 配料表分析 | POST `/api/analyze`，`type=label` | 返回购买建议、风险原因、食用边界 |
| AI-005 | 合规表达 | 检查分析文本 | 不出现“治愈、逆转、不能吃、用药建议”等禁用表达 |
| AI-006 | 拍照入口可见 | 打开 AI 工具页 | 出现 scanner 上传区域、`拍照上传`、`使用样例` |
| AI-007 | 配料表拍照入口 | 切换到 `配料表分析` | 标题变为拍食品配料表，并可触发上传或样例分析 |
| AI-008 | 模型分析通路 | POST `/api/analyze`，`type=label` | 返回 `fallback=false`、`model=kimi-k2.6` 或模型失败时明确返回 `fallback=true` 且有兜底结果 |
| AI-009 | 图片字段通路 | POST `/api/analyze` 带 `photo_name`、`mime_type`、`image_data` | 接口不报错，成功或兜底都写入 `analysis_results` |

## 5. 行动与打卡

| ID | 用例 | 步骤 | 预期 |
| --- | --- | --- | --- |
| ACT-001 | 查询行动 | GET `/api/actions?user_id=...` | 返回五类行动 |
| ACT-002 | 单项打卡 | PATCH `/api/actions/:id` 为 `done` | 该行动状态变为 `done` |
| ACT-003 | 一键完成 | POST `/api/actions/complete` | 五类行动均为 `done`，首页状态变为 `completed` |
| ACT-004 | 首页状态变化 | 完成行动后 GET `/api/app-state` | `dailyState.status=completed` |

## 6. 我的页

| ID | 用例 | 步骤 | 预期 |
| --- | --- | --- | --- |
| PROF-001 | 打开我的页 | 点击底部“我的” | 出现 `我的健康档案` 和复查日期 |
| PROF-002 | 固定指标展示 | 查看我的页 | 出现 OGTT 2h 血糖、HOMA-IR、HbA1c、胰岛素峰值 |
| PROF-003 | OGTT 曲线 | 查看我的页曲线模块 | 同时出现基线葡萄糖和复查葡萄糖 |
| PROF-004 | 长期档案 | 查看固定指标档案 | 出现糖化、甲功、血脂/肝酶、抗体分组 |
| PROF-005 | 最近报告抽取 | 完成一次报告图片分析后进入我的页 | 出现“最近报告抽取”，指标标记为待校对 |
| PROF-006 | 合规边界 | 查看我的页底部 | 出现健康教育与趋势观察边界，不出现诊疗承诺 |

## 7. 科普/社区页

| ID | 用例 | 步骤 | 预期 |
| --- | --- | --- | --- |
| EDU-001 | 文章卡片 | 打开“科普” | 出现原站研究解读，至少 9 篇文章 |
| EDU-002 | 用户案例 | 打开“科普” | 至少 2 条用户案例 |
| EDU-003 | 活动卡片 | 打开“科普” | 至少 1 个活动或服务卡片 |
| EDU-004 | 指南专题 | 打开“科普” | 出现 6 个指南专题：糖前基础、CGM、饮食、运动睡眠、情绪管理、代谢健康 |
| EDU-005 | 内容详情 | 点击任一 `查看详情` | 在 H5 内打开详情视图，包含证据边界和原站完整内容入口 |
| EDU-006 | 原站链接 | 点击任一 `原站` 或详情页完整内容入口 | 新窗口打开 `https://glucolit.vercel.app/zh/...` 原站详情 |

## 8. 移动端体验

| ID | 用例 | 步骤 | 预期 |
| --- | --- | --- | --- |
| UI-001 | iPhone 尺寸 | 390x844 打开首页 | 内容不横向溢出 |
| UI-002 | 底部导航 | 点击首页、AI、行动、我的、科普 | 页面切换正常 |
| UI-003 | 核心流程 | 从注册到打卡完成 | 3 分钟内可跑完，无阻断 |
| UI-004 | 首页今日关注 | 打开首页 | 首屏出现 `今日关注`、`AI 监控中`、餐后峰值/睡眠/未打卡信号，不出现表格化 2x2 指标中心布局 |
| UI-005 | 监控预警表达 | 首页查看预警模块 | 模块名称为 `AI 监控预警`，每条包含影响与行动 |

## 9. 生产冒烟命令

把手机号替换为新的测试号：

```bash
BASE=https://glucolit.xuemusi.com
PHONE=139$(date +%s | tail -c 9)

curl -sS "$BASE/api/content"
curl -sS -X POST "$BASE/api/auth/register" \
  -H 'content-type: application/json' \
  --data "{\"phone\":\"$PHONE\"}"
```

拿到 `user.id` 后继续：

```bash
USER_ID=<user_id>

curl -sS "$BASE/api/app-state?user_id=$USER_ID"
curl -sS -X POST "$BASE/api/analyze" \
  -H 'content-type: application/json' \
  --data "{\"user_id\":\"$USER_ID\",\"type\":\"report\"}"
curl -sS "$BASE/api/actions?user_id=$USER_ID"
curl -sS -X POST "$BASE/api/actions/complete" \
  -H 'content-type: application/json' \
  --data "{\"user_id\":\"$USER_ID\"}"
curl -sS "$BASE/api/app-state?user_id=$USER_ID"
```
