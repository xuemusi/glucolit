# 原站社区内容录入记录

日期：2026-07-03  
来源：`https://glucolit.vercel.app/zh`  
录入位置：`functions/_lib/demo-data.js`

## 目标

把原站社区/科普内容先录入到当前 Cloudflare Pages MVP，避免“科普”页只有少量占位文章。当前版本优先完成内容清单与阅读入口，不在本项目内复刻完整长文章详情页。

## 原站内容清单

### 指南专题

| 路径 | 标题 | 录入状态 |
| --- | --- | --- |
| `/guide/prediabetes` | 糖前基础 | 已录入 |
| `/guide/cgm` | CGM 监测 | 已录入 |
| `/guide/diet` | 饮食干预 | 已录入 |
| `/guide/exercise-sleep` | 运动睡眠 | 已录入 |
| `/guide/stress-emotion` | 情绪管理 | 已录入 |
| `/guide/metabolic-health` | 代谢健康 | 已录入 |

### 研究解读

| 日期 | 标题 | 路径 | 录入状态 |
| --- | --- | --- | --- |
| 2026-06-27 | 睡眠呼吸暂停与前糖尿病：CPAP 治疗的新视角 | `/articles/prediabetes-and-obstructive-sleep-apnea-a-review-of-the-pathophysiologic-efb885b1` | 已录入 |
| 2026-06-24 | 菲律宾中年和老年人中孤立性收缩期高血压的普遍性及风险因素 | `/articles/prevalence-and-factors-associated-with-isolated-systolic-hypertension-am-3bcce78c` | 已录入 |
| 2026-06-20 | 糖尿病前期与神经病变风险：哈萨克斯坦十年纵向研究启示 | `/articles/longitudinal-assessment-of-metabolic-and-neurological-decline-in-periphe-d300e663` | 已录入 |
| 2026-06-17 | 遗传与环境因素如何共同影响青少年血糖平衡轨迹 | `/articles/nature-vs-nurture-of-glucose-homeostasis-trajectories-in-children-from-t-cf7e60fe` | 已录入 |
| 2026-06-16 | 社会经济地位与糖尿病前期进展风险的关联研究 | `/articles/association-of-socioeconomic-status-and-lifestyle-factors-with-incident-8821957b` | 已录入 |
| 2026-06-15 | 肌肉与内脏脂肪比例对糖尿病前期风险的影响 | `/articles/higher-appendicular-skeletal-muscle-mass-to-visceral-fat-area-ratio-asso-cf57bdc8` | 已录入 |
| 2026-06-15 | 糖尿病前期成人改变生活方式可降低多重共病风险 | `/articles/lifestyle-and-metformin-interventions-and-risk-of-multimorbidity-in-adul-40d69bf0` | 已录入 |
| 2026-06-09 | 糖尿病前期与心血管健康：生活方式干预的新视角 | `/articles/glycemic-control-and-cardiovascular-health-in-prediabetes-untiring-explo-b96eac3d` | 已录入 |
| 2026-06-02 | 国家糖尿病预防计划对糖尿病前期成人的影响 | `/articles/progression-to-diabetes-by-adults-with-prediabetes-who-use-the-national-36132a68` | 已录入 |

## 调整决策

- 新增 `content.guides`，用于展示 6 个原站 Topic clusters。
- 扩展 `content.articles`，从 3 篇占位文章改成 9 篇原站研究解读。
- 每条内容保留 `originPath` 和 `url`，前端提供 H5 内详情视图，并保留原站完整内容入口。
- 原站个别 SEO 关键词含较强结果暗示，录入到产品页时改为更稳妥的“改善/管理/观察”表达。
- API `/api/content` 和 `/api/app-state` 继续返回静态内容，不引入数据库迁移。

## 后续可选

- 如果要完全迁移原站长文，可新增本地文章详情路由或 `/api/content/:slug`。
- 如果后续要做真实社区，需要新增文章、评论、收藏、点赞表，不建议混在当前 D1 演示状态表里。
