const healthProfileSeed = {
  source: {
    title: "养生的起点",
    imported_at: "2026-07-04",
    source_type: "user_markdown_health_archive",
    review_date: "2026-06-17",
    baseline_dates: {
      ogtt: "2026-01-21",
      lipid_liver: "2026-01-22",
      hba1c_thyroid: "2026-02-21",
    },
  },
  summary: {
    label: "我的健康变化",
    phase: "复查后继续观察",
    status: "核心指标较基线改善，仍需随访确认稳定性。",
    mechanism: "餐后血糖比基线回落更快，整体节律更平稳。",
    boundary: "档案用于健康教育、趋势观察和生活方式支持，不替代医生诊断和治疗。",
  },
  bodyComposition: [
    { label: "身高", value: "160", unit: "cm", note: "来自已上传档案" },
    { label: "体重", value: "53.8", unit: "kg", note: "来自已上传档案" },
    { label: "BMI", value: "21.0", unit: "", note: "正常体重，但需关注体成分" },
    { label: "体脂率", value: "28.0", unit: "%", note: "作为长期趋势观察" },
    { label: "内脏脂肪", value: "7", unit: "级", note: "近期重点观察" },
  ],
  keyMetrics: [
    {
      key: "ogtt_2h_glucose",
      label: "餐后 2h 血糖",
      unit: "mmol/L",
      baseline: 9.42,
      latest: 6.36,
      change: "回落 3.06",
      status: "回到常用正常区间",
    },
    {
      key: "homa_ir",
      label: "HOMA-IR",
      unit: "",
      baseline: 1.89,
      latest: 1.44,
      change: "下降 0.45",
      status: "接近 <1.5 目标",
    },
    {
      key: "hba1c",
      label: "HbA1c",
      unit: "%",
      baseline: 5.8,
      latest: 5.7,
      change: "下降 0.1",
      status: "仍需复查确认",
    },
    {
      key: "insulin_peak",
      label: "胰岛素峰值",
      unit: "pmol/L",
      baseline: 560.67,
      latest: 341.36,
      change: "下降约 39%",
      status: "身体负担下降",
    },
  ],
  ogtt: {
    times: ["空腹", "30 min", "1h", "2h", "3h"],
    glucose: {
      unit: "mmol/L",
      baseline: [4.72, 6.37, 8.19, 9.42, 6.37],
      latest: [4.72, 7.36, 8.05, 6.36, 4.8],
    },
    cPeptide: {
      unit: "nmol/L",
      baseline: [0.43, 1.02, 1.51, 2.48, 1.82],
      latest: [0.47, 1.75, 1.97, 2.31, 1.77],
    },
    insulin: {
      unit: "pmol/L",
      baseline: [54.2, 181.96, 289.5, 560.67, 268.9],
      latest: [41.3, 340.14, 328.1, 341.36, 233.0],
    },
    shape: [
      "首次检查时血糖高点出现在 2h，最近复查时高点提前到 1h。",
      "最近复查 2h 血糖回落到 6.36，3h 继续回落到 4.8。",
      "1h 血糖 8.05 只是观察信号，不能单独作为糖前期判断。",
    ],
  },
  derivedIndices: [
    { label: "Matsuda 指数", baseline: "约 4.7", latest: "约 5.7", change: "+21%", note: "全身胰岛素敏感性趋势" },
    { label: "IGI 早相分泌", baseline: "约 0.72", latest: "约 1.05", change: "+46%", note: "早相反应速度" },
    { label: "早相 C 肽指数", baseline: "约 0.36", latest: "约 0.49", change: "+35%", note: "C 肽验证早相分泌" },
    { label: "DI 处置指数", baseline: "约 3.4", latest: "约 6.0", change: "+77%", note: "估算 β 细胞功能趋势" },
    { label: "葡萄糖 AUC / iAUC", baseline: "913 / 347", latest: "845 / 279", change: "下降", note: "餐后血糖总暴露" },
    { label: "胰岛素 AUC", baseline: "36100", latest: "35800", change: "基本持平", note: "分泌分布更靠前" },
  ],
  labGroups: [
    {
      title: "糖化血红蛋白",
      items: [
        { label: "HbA1c", baseline: "5.8%", latest: "5.7%", note: "接近 <5.7 目标；HbF 偏高时需结合 OGTT" },
        { label: "A1", baseline: "7.0%", latest: "6.9%", note: "略降" },
        { label: "HbF", baseline: "1.7%", latest: "1.8%", note: "仍轻度偏高" },
        { label: "eAG", baseline: "6.6 mmol/L", latest: "6.5 mmol/L", note: "略降" },
      ],
    },
    {
      title: "甲状腺功能",
      items: [
        { label: "TSH", baseline: "2.27", latest: "1.95", note: "下降，需长期随访" },
        { label: "FT4", baseline: "13.07", latest: "12.19", note: "正常" },
        { label: "FT3", baseline: "3.66", latest: "3.56", note: "正常，贴近下限" },
        { label: "ATGAb", baseline: "14.14↑", latest: "14.53↑", note: "持续轻度阳性，基本稳定" },
        { label: "TPOAb", baseline: "0.84", latest: "<0.01", note: "阴性" },
      ],
    },
    {
      title: "血脂 / 肝酶",
      items: [
        { label: "TG", baseline: "0.85", latest: "0.62", note: "下降" },
        { label: "TC", baseline: "5.52", latest: "5.43", note: "略降" },
        { label: "HDL", baseline: "1.61", latest: "1.84", note: "升高" },
        { label: "LDL", baseline: "2.94", latest: "2.71", note: "下降" },
        { label: "ALT / AST / GGT", baseline: "21 / 21 / 17", latest: "18 / 22 / 12", note: "均在参考范围内" },
      ],
    },
    {
      title: "胰岛相关抗体",
      items: [
        { label: "GAD-Ab", baseline: "<3.00", latest: "阴性", note: "原始基线" },
        { label: "IA2", baseline: "<2.00", latest: "阴性", note: "原始基线" },
        { label: "IAA", baseline: "<2.00", latest: "阴性", note: "原始基线" },
        { label: "ICA", baseline: "<2.00", latest: "阴性", note: "原始基线" },
      ],
    },
  ],
  watchPriorities: [
    { rank: "1", title: "腰围 / 内脏脂肪", detail: "腰围、体脂率、内脏脂肪等级优先于单看体重。" },
    { rank: "2", title: "肌肉量", detail: "每周抗阻训练和体成分趋势用于观察敏感性基础。" },
    { rank: "3", title: "餐后 1h/2h + HOMA-IR", detail: "比 HbA1c 更早反映餐后节律变化。" },
    { rank: "4", title: "甲状腺指标", detail: "TSH、FT3 等指标建议按医生意见 6-12 个月随访一次。" },
  ],
  timeline: [
    { date: "2026-01-21", title: "首次 OGTT", detail: "2h 血糖 9.42 mmol/L，进入重点观察。" },
    { date: "2026-02-21", title: "医生沟通记录", detail: "HbA1c 5.8%，甲状腺抗体需随访，胰岛抗体阴性。" },
    { date: "2026-02 下旬", title: "启动 90 天计划", detail: "饮食结构、餐后运动、记录节奏。" },
    { date: "2026-06-17", title: "复查验证", detail: "2h 血糖 6.36，HOMA-IR 1.44，HbA1c 5.7。" },
  ],
  monitoringTargets: [
    { label: "空腹", value: "4.4-7.0 mmol/L" },
    { label: "餐后 2h", value: "<10.0 mmol/L" },
    { label: "餐后 3h", value: "低于 2h 且 <7.8" },
    { label: "餐后 4-5h", value: ">3.9 mmol/L" },
    { label: "睡前", value: "5.6-7.8 mmol/L" },
    { label: "餐前后差值", value: "<2.2 mmol/L" },
    { label: "日内峰谷差", value: "<4.4 mmol/L" },
  ],
  followUps: [
    { time: "1 个月", detail: "复诊，评估饮食、运动执行和血糖记录。" },
    { time: "3 个月", detail: "复查 OGTT 或空腹 + 餐后血糖、HbA1c、肝肾功能。" },
    { time: "每 6 个月", detail: "眼底、尿微量白蛋白、颈动脉超声等由医生判断。" },
    { time: "每年", detail: "C 肽释放试验或医生建议的胰岛功能评估。" },
  ],
  actionChecklist: [
    "进餐顺序：蔬菜、蛋白质、主食。",
    "主食约一个拳头，按餐后反应调整。",
    "餐后 30-60 分钟轻松步行 20 分钟。",
    "每周 3 次抗阻训练，避免空腹做高强度训练。",
    "重点记录餐后 3h、睡前和食物日志。",
  ],
  fixedMetricSchema: [
    "糖耐量检查：葡萄糖、胰岛素、C 肽",
    "糖化血红蛋白：HbA1c、A1、HbF、eAG",
    "胰岛素敏感性：HOMA-IR、Matsuda、IGI、DI、AUC",
    "甲状腺：TSH、FT3、FT4、TT3、TT4、ATGAb、TPOAb",
    "血脂和肝酶：TG、TC、HDL、LDL、ALT、AST、GGT",
    "胰岛相关抗体：GAD-Ab、IA2、IAA、ICA",
    "身体成分：身高、体重、BMI、体脂率、内脏脂肪、腰围",
  ],
};

export function buildHealthProfile(recentAnalysis = []) {
  const profile = JSON.parse(JSON.stringify(healthProfileSeed));
  const latestReport = recentAnalysis.find((analysis) => analysis.type === "report" && analysis.result?.ogtt);
  profile.latestReportExtraction = latestReport ? extractLatestReportMetrics(latestReport) : null;
  return profile;
}

function extractLatestReportMetrics(analysis) {
  const ogtt = analysis.result.ogtt;
  const homa = ogtt.derived?.homa_ir;
  const metrics = [
    metricFromValue("空腹血糖", ogtt.glucose?.fasting, "mmol/L", ogtt.flags?.fasting_glucose),
    metricFromValue("1h 血糖", ogtt.glucose?.h1, "mmol/L", ogtt.flags?.one_hour_glucose),
    metricFromValue("2h 血糖", ogtt.glucose?.h2, "mmol/L", ogtt.flags?.two_hour_ogtt),
    metricFromValue("3h 血糖", ogtt.glucose?.h3, "mmol/L", ""),
    metricFromValue("HbA1c", ogtt.hba1c, "%", ogtt.flags?.hba1c),
    homa
      ? {
          label: "HOMA-IR",
          value: homa.low === homa.high ? String(homa.value) : `${homa.low}-${homa.high}`,
          unit: "",
          flag: ogtt.flags?.homa_ir || "",
          note: "来自最新报告识别，待用户校对。",
        }
      : null,
  ].filter(Boolean);

  return {
    analysis_id: analysis.id,
    title: analysis.title,
    created_at: analysis.created_at,
    summary: analysis.summary,
    metrics,
  };
}

function metricFromValue(label, value, unit, flag) {
  if (!Number.isFinite(value)) return null;
  return {
    label,
    value: String(value),
    unit,
    flag: flag || "",
    note: "来自最新报告识别，待用户校对。",
  };
}
