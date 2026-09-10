# 新增场次画布设计：独立复核与处理

日期：2026-09-09。范围：新增画布设计、跨模块事务和源契约。审查由独立运行的技术研究 Agent `execution_readiness` 完成，主 Agent 综合裁决并修改；不是外部真人专家签字，也没有执行供应商、数据库或生产操作。原 09-07 冻结评审不改写。

首轮发现 4 项 P1、无 P0。修正后的 18／11／canvas_contract.py 经同一独立视角只读复核，确认四项在设计层闭合，未发现新增 P0/P1。

| ID | 原问题及影响 | 采用的修正 | 证据与运行验收 |
|---|---|---|---|
| CAN-01／P1 | 同一 nodeId 替换媒体后，历史候选可能指向 A，节点却展示 B | 节点 kind/content.type 固定，媒体节点 mediaId/assetRevisionId 固定；换媒体创建新节点，墓碑恢复核对身份 | [18 §3](../../implementation/18-canvas-workspace-contract.md#3-逻辑存储与不变量)，AT-62 |
| CAN-02／P1 | 画布与连接／预算的锁顺序冲突，输入检查可能先于实际执行事务 | 统一 connection→canvas→预算→plan 的适用锁顺序；相关输入检查、消费、预占及 job 建立同事务；已提交任务不依赖当前画布草稿 | [18 §7](../../implementation/18-canvas-workspace-contract.md#7-接口清单与事务)、[11 §2](../../implementation/11-transaction-and-implementation-blueprint.md#2-事务执行约定)，AT-57 |
| CAN-03／P1 | 结果取回没有持久唯一映射，移除后可能生成重复节点 | 新增 canvas_result_nodes 的永久唯一键；移除呈现保留映射，明确取回恢复相同身份并同事务保存 | [18 §3／§6](../../implementation/18-canvas-workspace-contract.md#3-逻辑存储与不变量)，AT-58 |
| CAN-04／P1 | 既有归档媒体可能让整张画布无法保存布局 | 锁定基线区分旧／新增引用；仍有权限的既有归档引用可保留和移动，新引入须 ready，撤权不享旧引用例外 | [18 §3](../../implementation/18-canvas-workspace-contract.md#3-逻辑存储与不变量)，AT-56／62 |

复核同时检查新 DTO／路由：个人偏好归短剧场次资源；GET 无记录返回虚拟 revision=0，首次 PUT 使用 If-Match: "0"；正式画布 revision 从 1 开始。此时独立审查只读取源契约，指出机器 OpenAPI 尚待生成；主 Agent 随后统一生成 OpenAPI 1.2.0 及 TypeScript，结果见[静态校验报告](../../implementation/validation-report.md)。

本记录关闭设计问题，不能关闭运行验收。后续实现需实际覆盖并发屏障、越权与撤权、超时重送、删除后取回、媒体身份与数据库永久唯一约束。结构样例不能验证这些关系。
