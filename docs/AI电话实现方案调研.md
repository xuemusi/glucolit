# AI 电话实现方案调研

## 1. 结论

GLUCOLIT 黑客松 MVP 可以做出类似“豆包语音电话”的效果，但不要做真正拨打手机号码。

推荐方案：

**H5 内模拟来电 UI + 实时语音对话能力 + 预置语音兜底。**

这样现场看起来像一次 AI 电话，但技术上是浏览器内的实时语音 Agent，不依赖真实运营商电话、号码采购、SIP、外呼合规和复杂链路。

## 2. 三档实现方案

### 方案 A：演示级“AI 来电”模拟

适合：黑客松当天最稳交付。

实现内容：

- 来电页面：头像、来电铃声、接听/挂断按钮。
- 通话页面：计时器、波形动画、字幕、AI 语音播放。
- 用户交互：预设回答按钮，或简单录音转文字。
- AI 内容：基于当前风险状态和今日行动生成电话脚本。
- 兜底：网络失败时播放预置音频。

优点：

- 半天内能做完。
- 现场稳定。
- 视觉效果接近“豆包电话”。
- 能服务 Demo 主线：提醒、安抚、确认今日行动。

缺点：

- 不是真正自由对话。
- 技术含量需要靠“可切换实时语音模式”补足。

建议：

**必须做。即使后续接入实时语音，也保留它作为兜底。**

### 方案 B：H5 内实时语音 Agent

适合：本次 MVP 的最佳技术方案。

实现内容：

- 用户点击“接听”后，浏览器请求麦克风权限。
- 前端把音频流接入实时语音模型。
- AI 能听、能说、可被打断。
- 通话上下文包含：今日风险、报告摘要、餐盘建议、今日行动。
- 通话结束后，把确认的行动写回打卡状态。

推荐技术：

1. OpenAI Realtime API + WebRTC。
2. 豆包端到端实时语音 API + WebSocket。
3. LiveKit Agents 或 Pipecat 作为更完整的 voice agent 框架。

优点：

- 体验接近真实 AI 电话。
- 不需要真实手机号。
- 技术展示足够强。
- 能与 H5 主流程打通。

缺点：

- 需要 API Key、HTTPS 或 localhost、麦克风权限。
- 现场网络和浏览器权限可能翻车。
- 中文语音效果取决于所选模型和 TTS。

建议：

**作为冲奖版本实现。Demo 时必须准备预置音频兜底。**

### 方案 C：真正手机电话/PSTN 呼入呼出

适合：完整产品或后续技术验证，不适合 1 天黑客松主线。

实现内容：

- 用户接到真实手机号来电，或拨打一个号码。
- Twilio/LiveKit SIP/腾讯 TRTC/火山 RTC 连接语音链路。
- 后端桥接 ASR、LLM、TTS 或实时语音模型。

优点：

- “真的电话”记忆点很强。
- 适合未来做自动随访、健康管理提醒、客服式陪伴。

缺点：

- 需要号码、SIP、回调地址、外呼权限、通话计费。
- 国内外呼合规复杂，医疗健康场景更敏感。
- 调试变量多，不适合 1 天稳定演示。

建议：

**本次不做。宣讲中可以说未来支持“AI 电话提醒”，MVP 用 H5 内通话模拟。**

## 3. 开源项目与可复用方案

### OpenAI Realtime API

适合 H5 内实时语音 Agent。

官方文档给出的浏览器方案是 WebRTC：前端获取麦克风音频，用 WebRTC 连接实时模型；后端负责创建 session 或下发 ephemeral key。OpenAI 文档明确建议浏览器/移动端语音应用优先用 WebRTC，而不是 WebSocket，以获得更稳定的实时性能。

可做效果：

- 低延迟语音对话。
- 语音输入和语音输出。
- 打断。
- 工具调用。
- 会话上下文注入。

适合 GLUCOLIT 的用法：

- 后端 `/session` 创建实时会话。
- 前端电话 UI 接通后建立 WebRTC。
- session instructions 写入“你是糖前期行动陪伴电话，不诊断、不治疗，只做行动提醒和情绪支持”。
- data channel 或工具调用把“用户同意今日行动”写回前端状态。

### Pipecat

适合做更完整的实时语音/多模态 Agent。

Pipecat 是开源 Python 框架，定位是构建实时语音和多模态对话 Agent，支持不同传输层和 AI 服务，适合把 STT、LLM、TTS、WebRTC/WebSocket、工具调用编排成 pipeline。

优点：

- 开源。
- 适合自定义语音链路。
- 适合后续做生产级 voice agent。

缺点：

- 对黑客松 1 天来说偏重。
- 需要理解 pipeline、transport、部署。

建议：

**不作为本次首选，但可放入后续技术路线。**

### LiveKit Agents

适合做实时语音 Agent 和电话/SIP 集成。

LiveKit Agents 是用于构建实时、可编程语音/多模态 Agent 的框架，支持 WebRTC 客户端、STT/LLM/TTS/Realtime API 混搭，也支持电话集成。LiveKit 官方和示例仓库都有通过 Twilio SIP 接电话的样例。

优点：

- WebRTC 能力成熟。
- 后续能扩展到真实电话/SIP。
- 适合多人房间、通话、状态同步。

缺点：

- 对本次单人 H5 Demo 来说链路偏长。
- 需要 LiveKit 服务或云账号。

建议：

**如果团队已有 LiveKit 经验可用，否则本次不作为主线。**

### Twilio + OpenAI Realtime

适合做真正电话呼入/呼出。

Twilio 官方样例展示了用 Twilio Voice、Media Streams 和 OpenAI Realtime API 打通实时 AI 语音助手。链路是 Twilio 接收电话音频，通过 WebSocket 代理给 OpenAI Realtime，再把 AI 音频返回给电话侧。

优点：

- 真实电话号码。
- 官方样例完整。
- 适合英文或国际化电话场景。

缺点：

- 国内参赛环境、号码、计费、外呼合规都不稳定。
- Outbound calling 还需要额外处理。
- 不是本次 H5 核心体验必需。

建议：

**本次不做，只作为长期“真实电话外呼”技术备选。**

### 火山引擎/豆包实时语音

适合追求“豆包电话”相近体验，尤其中文语音。

火山引擎文档显示豆包端到端实时语音大模型 RealtimeAPI 支持低延迟、多模式交互，可用于构建语音到语音的对话工具，目前以 WebSocket 协议连接。火山引擎也有“语音实时通话 - 青青”示例，展示了基于豆包语音识别、豆包大模型和豆包语音合成实现模拟通话。

优点：

- 中文体验和音色可能更接近豆包。
- 国内网络和账号体系更适合国内现场。
- 有示例项目可参考。

缺点：

- 部分能力可能需要开通、邀测或控制台配置。
- WebSocket 音频流接入比 OpenAI WebRTC 更需要工程处理。

建议：

**如果团队已有火山账号和 API 权限，优先尝试；否则用 OpenAI Realtime 或模拟方案更稳。**

### 腾讯云 TRTC AI 实时对话

适合后续做国内生产级实时通话。

腾讯云 TRTC AI 实时对话方案支持接入多家大模型服务，实现 AI 与用户的实时音视频互动；官方文档提到语音对话延迟低至 1 秒，并支持无代码快速跑通。TRTC 的 StartAIConversation 接口也说明可让 AI 通道机器人进入 TRTC 房间，与指定成员进行 AI 对话，内置语音转文本，并可指定第三方 LLM 和 TTS。

优点：

- 国内云服务，RTC 能力成熟。
- 可快速验证 AI 实时对话。
- 未来更适合国内 APP。

缺点：

- 控制台配置和计费项较多。
- 黑客松 1 天内接入成本仍高于 H5 直连实时模型。

建议：

**放长期产品技术路线，不作为本次 MVP 主线。**

## 4. 自己实现难不难

取决于“自己实现”的定义。

### 不难：做 H5 电话壳 + 实时模型

需要实现：

- 电话 UI。
- 麦克风权限。
- WebRTC/WebSocket 连接。
- 远端音频播放。
- 通话脚本 prompt。
- 挂断和状态回写。

难度：中低。

预计时间：

- 模拟电话：2-4 小时。
- OpenAI Realtime WebRTC：0.5-1 天。
- 豆包 WebSocket：0.5-1.5 天，取决于权限和音频格式处理。

### 有难度：完全手搓 ASR + LLM + TTS 链路

需要实现：

- 前端录音分片。
- 语音活动检测 VAD。
- 流式 ASR。
- LLM 流式输出。
- TTS 流式合成。
- 音频播放队列。
- 打断处理。
- 回声消除、噪声、延迟优化。

难点：

- 低延迟。
- 用户打断。
- 端点检测。
- 音频格式转换。
- 多浏览器兼容。

结论：

**不建议本次手搓完整语音 pipeline。要么用 Realtime 端到端模型，要么做模拟电话。**

### 很难：真正电话外呼

难点：

- 号码和电话服务商配置。
- SIP/Media Stream。
- 本地服务公网回调。
- 通话合规和用户授权。
- 现场网络和计费风险。

结论：

**本次不做。**

## 5. GLUCOLIT 推荐实现路径

### 黑客松当天必做

1. 做手机来电 UI。
2. 接听后播放一段预置 AI 语音。
3. 屏幕同步展示字幕。
4. 用户点“愿意，设为今日行动”。
5. 电话结束后今日行动卡变成“已确认/已完成”。

电话脚本示例：

“我看到你连续 3 天没有记录了。今天不用重启完整计划，我们先做一件小事：晚饭后走 15 分钟。你愿意把它设为今天的行动吗？”

### 冲奖版

在模拟电话基础上接入实时语音：

- 首选：OpenAI Realtime API + WebRTC。
- 备选：豆包端到端实时语音 API + WebSocket。

通话上下文：

```json
{
  "role": "GLUCOLIT 行动陪伴电话",
  "user_state": {
    "missed_checkin_days": 3,
    "sleep_hours": 5.8,
    "meal_risk": "晚餐碳水偏高",
    "report_summary": "HbA1c 边缘异常，建议复查并咨询医生"
  },
  "allowed_behavior": [
    "情绪支持",
    "提醒今日行动",
    "解释健康教育信息",
    "鼓励复查和咨询医生"
  ],
  "forbidden_behavior": [
    "诊断",
    "治疗建议",
    "承诺逆转",
    "禁止某类食物",
    "替代医生判断"
  ]
}
```

### 后续完整产品

- APP 内实时语音陪伴。
- 用户授权后的定时来电提醒。
- 与设备数据/打卡数据/报告数据联动。
- 高风险表达触发真人或专业机构分流。
- 真实电话/PSTN 作为可选能力，而不是唯一交互入口。

## 6. 关键风险

- 浏览器麦克风权限：必须用 HTTPS 或 localhost。
- iOS Safari 自动播放限制：音频播放最好由用户点击“接听”触发。
- 现场网络：必须准备预置音频和字幕兜底。
- 医疗合规：电话只做行动提醒和情绪支持，不做诊断治疗。
- 隐私：不要在电话里读出过多敏感指标；演示数据应明确是样例数据。
- 延迟：超过 2 秒会明显不像电话，实时模式要提前压测。

## 7. 最终建议

本次 MVP 的最佳方案是：

**做一个“看起来是电话、技术上是 H5 实时语音 Agent、失败时可降级为预置语音”的 AI 陪伴电话。**

开发优先级：

1. 先做电话 UI 和预置语音兜底。
2. 再接实时语音模型。
3. 最后做状态回写和通话总结。

不要把真实电话外呼作为本次目标。评委需要看到的是“AI 如何在用户最容易放弃的时候，把他拉回今天的一小步”，不是看到一个真的手机号。

## 8. 参考资料

- OpenAI Realtime API WebRTC 文档：https://developers.openai.com/api/docs/guides/realtime-webrtc
- OpenAI Voice Agents 文档：https://developers.openai.com/api/docs/guides/voice-agents
- Pipecat GitHub：https://github.com/pipecat-ai/pipecat
- LiveKit Agents GitHub：https://github.com/livekit/agents
- Twilio + OpenAI Realtime Python 示例：https://github.com/twilio-samples/speech-assistant-openai-realtime-api-python
- Twilio Code Exchange 示例：https://www.twilio.com/code-exchange/ai-voice-assistant-openai-realtime-api
- 火山引擎豆包实时语音 API 文档：https://www.volcengine.com/docs/6561/1594356
- 火山引擎语音实时通话示例：https://github.com/volcengine/ai-app-lab/blob/main/demohouse/live_voice_call/README.md
- 火山引擎 RTC AIGC Demo：https://github.com/volcengine/rtc-aigc-demo
- 腾讯云 TRTC AI 实时对话功能介绍：https://cloud.tencent.com/document/product/647/110584
- 腾讯云 StartAIConversation 接口：https://cloud.tencent.com/document/product/647/108514
