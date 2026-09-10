# 制作实验与交接模板

这些模板用于 [10 制作夹具](../10-production-fixture.md) 和 [13 质量与交接规范](../13-production-quality-and-handoff.md)，不是已执行记录。分镜导入 CSV 已填写 F0 六镜的虚构内容，其他记录模板为空。复制到每次实验自己的证据目录后使用，不在模板原件中混入真实客户资料。

| 文件 | 一行／一份表示什么 |
|---|---|
| [shot-list-import.csv](shot-list-import.csv) | F0 第一集六镜的约定格式导入样例；episode、scene、shot_label、intent 必需，dialogue、duration_seconds、notes 可选 |
| [experiment-plan-and-result.md](experiment-plan-and-result.md) | 一轮工程验证或一条真实试点制作路径，执行前填写计划，执行后补结果 |
| [continuity-sheet.csv](continuity-sheet.csv) | 一版镜头的入口、出口与实际制作依据；出口预期和画面观察分开 |
| [shot-handoff.csv](shot-handoff.csv) | 一次采用／剪辑区间使用；同一媒体可多行，包内原文件仍去重 |
| [dialogue-sound-subtitle.csv](dialogue-sound-subtitle.csv) | 一段实际声音／字幕使用及其已知台词关系；混合轨不得冒充独立对白 |
| [quality-and-rework.csv](quality-and-rework.csv) | 一条问题、目标、保留项、修复路径和复查结论 |
| [labor-log.csv](labor-log.csv) | 一个人的一段主动工作或独立等待记录，避免同人同时间重复计算 |
| [job-cost-register.csv](job-cost-register.csv) | 当前汇总中一个作业的费用净额与未决占用；按作业唯一 |
| [non-job-costs.csv](non-job-costs.csv) | 一笔没有在作业费用中计算的真实外部／基础设施支出 |
| [handoff-receipt.md](handoff-receipt.md) | 一次原素材包／剪辑工作包接收与外部回传验证 |

CSV 采用 UTF-8，带逗号、引号或换行的文本遵循 CSV 引号规则。空金额表示未知／尚未填写，必须同时填状态；真实确认无支出时才填 0。不存在的时间线区间留空并写原因，不用 0 代表未知。货币分别统计，费用证据保存稳定引用而不是带密钥的链接。

业务标签便于阅读；对象／文件版本身份和校验值来自实际系统。人可读表不能替代固定 JSON manifest，也不能制造不存在的审片、时间线或工程映射。任何生成出来的样本文件都应说明构造／导入／真实供应商来源。
