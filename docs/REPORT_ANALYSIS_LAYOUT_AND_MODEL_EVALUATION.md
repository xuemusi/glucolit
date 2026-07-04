# 报告分析排版与模型评估记录

日期：2026-07-04

测试图片：`f597b0b444b767ca2b610f45ad68d748.jpg`

## 问题复盘

用户反馈的问题成立：

- 报告结果把 OCR 字段、摘要、建议全部堆在一起，阅读层级不清。
- 原始字段列表太长，默认展开后挤占主要解读空间。
- 缺少“标准对比”表格，用户无法一眼看出空腹、1h、2h、3h、HOMA-IR 分别按什么标准判读。
- 专业建议偏泛，未围绕本次曲线特点展开。
- 上传区长文件名没有强制换行，移动端可能撑破扫描框。

## 根因

- 后端已有 OCR 和规则计算，但前端只渲染 `key_findings` 与 `fields`，没有把规则数据拆成表格化视图。
- `fields` 的 `label` 直接使用 OCR 原文，出现“空腹葡萄糖 5.28 / value 5.28”重复。
- 模型提示词只要求谨慎解读，没有强制输出“标准对比、曲线形态、专业建议”的结构。
- CSS 没有给长文件名和表格内容设置移动端换行策略。

## 调整决策

本次不只换模型，先把结果结构化：

- 后端规则层新增 `standard_comparison`，专门给前端渲染标准对比表。
- 后端规则层新增 `curve_rows`，展示空腹、1h、2h、3h 的血糖、胰岛素、C 肽及相对空腹倍数。
- 后端规则层新增 `derived_indicators`，展示 HOMA-IR、血糖峰值、胰岛素峰值、C 肽峰值、3h 回落情况。
- 后端规则层新增 `professional_advice`，围绕复查/补充检测、曲线记录、进餐结构、餐后活动、检测条件一致性输出。
- 前端报告结果改成分区展示：关键发现、标准对比、曲线结构、计算指标、专业解读、专业建议、就诊问题。
- 原始 OCR 字段默认折叠，作为“查看原始识别字段”。
- 移动端表格改成卡片式表格，不依赖横向滚动。
- 上传文件名增加强制换行，避免长 hash 文件名撑破扫描框。

## 模型测试

新增模型源：

- Base URL：`https://88996api.cloud/v1`
- 可用模型接口返回：`gemini-3-pro-preview`、`gemini-3.1-pro-preview`、`gemini-2.5-pro`、`gemini-2.5-pro-nothinking`、`gpt-5.4-mini`、`gpt-5.4`、`gpt-5.5` 等。

同一份 OCR + 规则数据测试结果：

- `gpt-5.4-mini`：请求 60 秒超时，暂不作为生产默认。
- `gemini-2.5-pro-nothinking`：能输出更清晰的曲线解释和建议，识别到 3h 血糖比空腹高、3h 胰岛素约为空腹 1.9 倍、HOMA-IR 1.76 未达常见偏高切点。

生产决策：

- OCR 仍使用 `qwen3-vl-plus`，因为报告字段识别准确。
- 报告叙述模型切换为可配置的 `REPORT_NARRATIVE_*`，生产默认配置为 `gemini-2.5-pro-nothinking`。
- API Key 通过 Cloudflare Pages secret 配置，不写入仓库。
- 即使模型输出偏弱，前端也依赖后端规则表格保底，避免再次出现“只有一大段泛泛建议”的问题。

## 本次验证点

- 本地 `POST /api/analyze` 使用同一张报告图，返回：
  - `standard_comparison` 5 行。
  - `curve_rows` 4 行。
  - `derived_indicators` 包含 HOMA-IR、血糖峰值、胰岛素峰值、C 肽峰值、3h 回落。
  - `professional_advice` 5 条。
- 本地移动端 Playwright 视觉检查：
  - 页面出现“标准对比”“曲线结构”“专业建议”。
  - 报告表格数量为 2。
  - 原始字段默认折叠。
  - `document.body.scrollWidth` 等于移动视口宽度 390。

## 2026-07-04 速度复测

用户反馈页面响应仍慢，补测 `gemini-3.1-flash-lite-preview` 与 `gemini-3.5-flash`。

同一份报告 OCR + 规则数据，连续 2 次直接调用叙述模型：

| 模型 | 成功率 | 平均耗时 | 质量结论 |
| --- | --- | ---: | --- |
| `gemini-3.1-flash-lite-preview` | 2/2 | 3.79s | 合格，能区分 2h OGTT 诊断点和 1h 观察信号 |
| `gemini-2.5-pro-nothinking` | 2/2 | 3.94s | 当前默认，质量合格 |
| `gemini-3.5-flash` | 2/2 | 6.35s | 可用但更慢 |
| `gpt-5.4-mini` | 2/2 | 28.79s | 明显过慢 |

同一张报告图片做 OCR：

| 模型 | 耗时 | 识别结果 |
| --- | ---: | --- |
| `gemini-3.1-flash-lite-preview` | 7.40s | 12 行字段，关键值命中 12/12 |
| `gemini-3.5-flash` | 5.68s | 12 行字段，关键值命中 12/12 |

本轮决策：
- 报告叙述暂不切：`gemini-3.1-flash-lite-preview` 只比当前 `gemini-2.5-pro-nothinking` 快约 0.15s，收益不足以抵消 preview 模型稳定性风险。
- 报告 OCR 暂不切：候选模型单图表现可用，但 OCR 是医疗报告链路的高风险环节，需要更多报告样本回归后再替换 `qwen3-vl-plus`。
