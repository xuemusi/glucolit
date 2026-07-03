export const metrics = {
  glucoseTrend: [
    { time: "08:00", value: 5.8 },
    { time: "12:30", value: 8.6 },
    { time: "15:00", value: 6.5 },
    { time: "20:40", value: 7.9 },
  ],
  sleepHours: 5.8,
  steps: 4200,
  heartRate: 78,
  missedCheckinDays: 3,
  dataSource: "模拟设备数据",
};

export const reasons = [
  "晚餐后波动偏高",
  "昨晚睡眠不足",
  "连续 3 天未完成饭后步行",
];

export const defaultActions = [
  {
    category: "diet",
    title: "饮食",
    detail: "晚餐主食减少约 1/3，先吃蔬菜和蛋白，再吃主食。",
  },
  {
    category: "sleep",
    title: "睡眠",
    detail: "今晚 23:30 前上床，睡前 30 分钟不再刷短视频。",
  },
  {
    category: "exercise",
    title: "运动",
    detail: "饭后约 30 分钟开始散步，体力不足时先走 15-20 分钟。",
  },
  {
    category: "stress",
    title: "压力",
    detail: "做 3 分钟呼吸练习，把压力状态记录为“紧绷/平稳”。",
  },
  {
    category: "energy",
    title: "精力",
    detail: "下午避免含糖饮料，用无糖茶或温水替代。",
  },
];

export const analysisSamples = {
  report: {
    title: "体检/OGTT 报告解读",
    summary: "这份样例报告里，餐后 2 小时血糖和 HbA1c 值得重点关注。",
    risk_level: "orange",
    confidence: "medium",
    result: {
      fields: [
        { label: "HbA1c", value: "6.1%", note: "接近糖前期常见关注区间，建议结合医生意见复查。" },
        { label: "空腹血糖", value: "5.8 mmol/L", note: "略高，需结合近期睡眠和饮食观察。" },
        { label: "餐后 2 小时血糖", value: "8.6 mmol/L", note: "餐后波动偏高，适合记录餐食和餐后反应。" },
        { label: "甘油三酯", value: "1.9 mmol/L", note: "可作为代谢风险辅助观察指标。" },
      ],
      focus: ["餐后波动偏高", "睡眠不足可能影响胰岛素敏感性", "建议复查并咨询医生确认"],
      suggestions: {
        diet: "晚餐主食减少约 1/3，先吃蔬菜和蛋白，再吃主食。",
        sleep: "今晚 23:30 前上床，睡前 30 分钟不再刷短视频。",
        exercise: "饭后约 30 分钟开始散步，体力不足时先走 15-20 分钟。",
        stress: "做 3 分钟呼吸练习，把压力状态记录为“紧绷/平稳”。",
        energy: "下午避免含糖饮料，用无糖茶或温水替代。",
      },
      medical_boundary: "本结果用于健康教育与生活方式行为支持，不替代医生诊断和治疗。",
    },
  },
  meal: {
    title: "餐盘分析",
    summary: "这份午餐主食比例偏高，蔬菜略少，建议做低门槛替换。",
    risk_level: "yellow",
    confidence: "medium",
    result: {
      plate: {
        staple: "白米饭约一碗",
        protein: "鸡蛋和少量鸡肉",
        vegetables: "绿叶菜偏少",
        drink: "无明显含糖饮品",
        cooking: "家常炒制",
      },
      carbRisk: "中",
      observations: ["精制主食占比偏高", "蔬菜量不足", "蛋白质可以保留"],
      swaps: ["米饭减少约 1/3", "增加一份绿叶菜", "饭后约 30 分钟开始轻松步行"],
      medical_boundary: "餐盘分析是估计结果，用于行为建议，不提供诊断或治疗结论。",
    },
  },
  label: {
    title: "配料表分析",
    summary: "这款食品添加糖位置靠前，更适合偶尔少量，不建议作为每日加餐。",
    risk_level: "yellow",
    confidence: "medium",
    result: {
      purchaseAdvice: "需控制",
      reasons: ["添加糖相关词靠前", "膳食纤维偏低", "蛋白质含量不突出"],
      alternatives: ["优先选择无糖酸奶", "选择原味坚果并控制份量", "选择高蛋白低糖加餐"],
      boundary: "偶尔少量可以，尽量不要作为每日固定加餐。",
      medical_boundary: "配料表建议用于消费选择参考，不替代医生或营养师建议。",
    },
  },
};

export const content = {
  articles: [
    {
      title: "糖前期为什么不是等确诊再说",
      source: "循证科普",
      summary: "早期关注餐后波动、睡眠和体重管理，可以帮助用户更早建立行动习惯。",
    },
    {
      title: "HbA1c、空腹血糖、餐后血糖分别怎么看",
      source: "临床指标入门",
      summary: "三个指标反映的时间窗口不同，应结合医生意见和生活方式记录一起理解。",
    },
    {
      title: "进餐顺序如何影响餐后波动",
      source: "饮食行为",
      summary: "先吃蔬菜和蛋白，再吃主食，是更容易执行的低风险尝试。",
    },
  ],
  cases: [
    "连续三天只完成饭后 15 分钟步行，用户重新找回记录节奏。",
    "把含糖饮料替换成无糖茶后，用户开始关注下午精力变化。",
  ],
  event: {
    title: "7 天餐后行动挑战",
    summary: "用一周时间记录晚餐、餐后步行和第二天空腹状态。",
  },
};
