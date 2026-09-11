# 固定镜头来源：数据库与公共 API 证据

基线：`7a1296dc541bf214205cab8f2b15ee071daa56aa`。产品修复：`52e53d8`，仅追加 `0095_fixed_shot_snapshot_projection.sql`；首次实际应用后保持冻结，SHA-256 为 `dca5c7e21dcca243cd7cd81b2ad03db531026150ec78f53ca03a31162efec4ae`。

## 修复前后

- `before-0095.log`：实际受限 runtime 角色插入原快照成功；追加未选镜头、替换镜头 ID、替换修订 ID、伪造入口或出口状态这五种写入，执行所有 deferred constraints 后仍成功，五个拒绝断言因此失败。每次事务均回滚。统计为 1 pass、6 fail（含父测试），这是缺陷的 red 证据。
- `after-0095-expanded.log`：20/20 通过，0 fail/cancel/skip，244.995 秒。包括原样 SQL control 和 9 个负例、音频画布的固定对白及声音来源、图片画布空源/多源顺序/历史修订/引用继承/跨项目拒绝/归档时序/结果历史与显式取回。
- 完成上述一轮后，只对 SQL 测试增加“两个相同 spec 的不同镜头不能交换 resolved 身份顺序”，并将 SQL control 改为两镜头输入。`final-sql-order.log` 在最终文件上单独运行该组：12/12 通过，0 fail/cancel/skip，74.848 秒。没有将重叠测试相加宣称更多独立覆盖；其余已通过的 API 场景未再次重跑。
- `typecheck.log`：最终文件 `npm run typecheck` exit 0；`git diff --check` 通过。

首次修复后的 API 测试在最后一个状态核对中误用尚未实现的单镜头 GET（501）；改用已实现的 content tree 读取后，上述 20 项完整通过。该次中间失败不计为通过，原日志保留在本工作树 `.runtime/canvas-fixed-shot-sources-first-check.log`。

## 行为边界

请求只沿现有 `prepareCanvasGeneration`、固定镜头修订查询、GenerationPlan/Job、画布计划历史和显式结果取回 API。`[B 的旧修订, A]` 的输入顺序、完整 spec、entry/exit state、引用和来源版本保持固定；反序产生不同 origin fingerprint。允许同项目跨场选择，不允许跨项目、错配 ID 或重复镜头。

prepare/execute 前归档所选镜头、场次或单集，会拒绝新任务。execute 后归档这些文本来源根并删除草稿节点，不改变原任务固定输入；独立结果仍能按原计划找回并显式放回画布，不自动创建 Take。没有新增 dispatch 的统一 active 门禁，也没有修改异步执行生命周期。

音频画布非空镜头输入覆盖：对白显式声音、入口状态显式声音、出口角色固定修订的默认声音。后来声音/镜头新修订不会替换 Worker 收到的固定定义。

数据库夹具使用独立 schema、受限 API/Worker 角色、现有公共 API 与真实持久事务；结束已清理。媒体归档部分只提交明确的关系数据库测试回执，不是实际字节解码证明。没有启动用户业务任务、调用真实模型或产生供应商费用。没有重跑旧媒体/完整数据库套件；主线程负责精确整合后的 CI 与浏览器验收。

## 运行方式

使用项目锁定运行时及 `node --env-file=<已有安全环境文件> --import tsx --test tests/integration/canvas-fixed-shot-sources.test.ts`。最终 SQL 补充使用相同命令并加 `--test-name-pattern='restricted runtime'`。日志未包含连接串、密码、会话令牌或签名 URL。
