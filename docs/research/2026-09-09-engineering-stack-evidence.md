# S0 工程栈版本与兼容证据

核实日期：**2026-09-09**。范围：Node、npm、React/Vite、Fastify、TypeScript、PostgreSQL 及直接受影响的配套依赖。

本研究只读取官方文档、官方项目仓库以及发布方写入 npm 官方 Registry 的精确版本元数据。没有安装包、修改运行环境、连接数据库或运行容器。任务提供的主机版本为 Node `22.22.2`、npm `10.9.7`、Docker `28.5.1`、psql `16.13`、FFmpeg `8.1`；本研究没有再次探测主机。**以下是工程选型依据，不是实际组合测试通过、数据库服务就绪或模型服务商账户已验证的证明。**

## 1. 可执行建议

建议 S0 保持现有主线、更新维护版本，明确锁定以下组合。这里的“锁定”指可复现构建，不代表以后拒绝安全更新。

| 组件 | 建议锁定 | 判断及证据 |
|---|---|---|
| Node.js | `22.23.2` | 沿用本机 22 主线；该版本是官方安全发布。现有 `22.22.2` 满足 Vite/Fastify 最低运行条件，但不是当前维护基准。[官方发布](https://nodejs.org/en/blog/release/v22.23.2) |
| npm | `10.9.8` | 与 Node 22 当前发行线配套；包声明支持 Node `^18.17.0 || >=20.5.0`。[Node 22 归档](https://nodejs.org/en/download/archive/v22)、[精确包元数据](https://registry.npmjs.org/npm/10.9.8) |
| React / React DOM | **都用 `19.2.8`** | 官方文档当前主线为 19.2；对应 DOM 包要求 React `^19.2.8`，应用直接依赖同补丁锁定。[React 版本](https://react.dev/versions)、[React](https://registry.npmjs.org/react/19.2.8)、[React DOM](https://registry.npmjs.org/react-dom/19.2.8) |
| Vite | `7.3.6` | 7.3 仍获得重要修复与安全修复；不在 S0 同时引入 Vite 8 的打包器变更。[支持政策](https://vite.dev/releases)、[精确包元数据](https://registry.npmjs.org/vite/7.3.6) |
| React Vite 插件 | `@vitejs/plugin-react@5.2.0` | peer 范围包括 Vite 7；不要与插件 6 的最新版本混装。[精确包元数据](https://registry.npmjs.org/@vitejs%2Fplugin-react/5.2.0) |
| Fastify | `5.12.3` | 使用受维护的 5 主线与当前稳定补丁；6 尚为预发布路线，4 已结束官方 LTS。[LTS](https://fastify.dev/docs/latest/Reference/LTS/)、[精确包元数据](https://registry.npmjs.org/fastify/5.12.3) |
| TypeScript | `6.0.3` | 6 是保留 JS 编译器及 5.9 API 兼容的稳定过渡线；无需为 S0 追 7 主线。包要求 Node `>=14.17`。[官方说明](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/)、[精确包元数据](https://registry.npmjs.org/typescript/6.0.3) |
| PostgreSQL 服务端 | `16.15` | 沿用 16 主线，支持到 **2028-11-09**；官方建议始终运行本主线当前维护版。[维护政策](https://www.postgresql.org/support/versioning/)、[16.15 发布说明](https://www.postgresql.org/docs/release/16.15/) |
| Node PostgreSQL 驱动 | `pg@8.23.0` | 包最低 Node 16；维护方声明支持当前/LTS Node 与 PostgreSQL 16 所在支持范围。[驱动文档](https://node-postgres.com/)、[精确包元数据](https://registry.npmjs.org/pg/8.23.0) |

**这套组合是静态兼容候选。** 没有执行依赖解析、构建、类型检查或数据库测试，因此不能称为已经验证的锁文件。已有主机可以继续不依赖外部服务的准备工作；后续实际安装和测试日志应注明真实使用版本，不能把本建议版本写成已经安装。

## 2. Node、Vite 与 Fastify 的兼容交集

Vite 7.3.6 与 React 插件 5.2.0 的 `engines.node` 均为：

```text
^20.19.0 || >=22.12.0
```

这是比 Fastify 5 的 **Node 20+** 更高的具体最低条件。Node `22.22.2` 和建议的 `22.23.2` 都满足；“Node 22”本身不够精确，22.0—22.11 不满足 Vite 7 的声明。[Vite 元数据](https://registry.npmjs.org/vite/7.3.6)、[插件元数据](https://registry.npmjs.org/@vitejs%2Fplugin-react/5.2.0)、[Fastify 5 迁移说明](https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/)

最低引擎条件与维护承诺要分开：Node 20 已于 **2026-04-30** 结束维护，不能因为 Vite/Fastify 的最低条件含 20，就据此选择它作为新的生产基准。Node 22 当前处于 Maintenance LTS，结束日期 **2027-04-30**；Node 24 仍为 LTS，结束日期 **2028-04-30**。[Node 官方维护日程](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json)

Fastify LTS 政策承诺跟随受支持 Node 主线，但只保证各主线的最新发行版；其版本表仍仅列 20、22，不能因此断言 24 不兼容，也不能把旧 Node 22 补丁称为全部官方支持条件已满足。Fastify 5 的结束维护日期仍是 TBD，不能擅自补一个长期年份。[Fastify LTS](https://fastify.dev/docs/latest/Reference/LTS/)

**工程判断：** S0 使用 Node 22 当前补丁可以减少环境变化；应在 Node 22 EOL 前安排到 Node 24 的专项验证。如果团队希望新工程第一次统一环境就覆盖到 2028 年，可直接选 Node 24 LTS 当前维护版；这属于合理的 LTS 选择，仍应重跑原生依赖与部署镜像检查。本研究的主要建议维持 22 主线，未要求主机立即安装另一大版本。

## 3. 配套依赖必须成组锁定

以下是本次读取到的精确版本和声明。它们是需要该功能时的候选，不表示 S0 应一次装齐所有包。

| 配套组件 | 建议候选 | 关键兼容关系 |
|---|---|---|
| Node 类型 | `@types/node@22.20.1` | 类型最低 TS 5.6，跟随运行时 22 主线；不能使用无约束的最新 `@types/node@26`。[元数据](https://registry.npmjs.org/@types%2Fnode/22.20.1) |
| React 类型 | `@types/react@19.2.18` + `@types/react-dom@19.2.7` | 两者最低 TS 5.6；DOM 类型 peer 为 `@types/react ^19.2.0`。类型包补丁号不要求与 React 运行时相同。[React 类型](https://registry.npmjs.org/@types%2Freact/19.2.18)、[DOM 类型](https://registry.npmjs.org/@types%2Freact-dom/19.2.7) |
| pg 类型 | `@types/pg@8.23.1` | 其 Node 类型依赖含通配范围，根项目仍需显式确定 Node 类型主线。[元数据](https://registry.npmjs.org/@types%2Fpg/8.23.1) |
| TypeScript ESLint | `typescript-eslint@8.70.0` + `eslint@9.39.5` | 前者 peer 支持 TS `>=4.8.4 <6.1.0` 与 ESLint 9；本次读取的 TS 7 不在此范围内。[元数据](https://registry.npmjs.org/typescript-eslint/8.70.0)、[ESLint 元数据](https://registry.npmjs.org/eslint/9.39.5) |
| CORS | `@fastify/cors@11.3.0` | 官方表确认插件 11 主线适配 Fastify 5。[兼容表](https://github.com/fastify/fastify-cors#compatibility)、[包](https://registry.npmjs.org/@fastify%2Fcors/11.3.0) |
| OpenAPI 文档插件 | `@fastify/swagger@9.8.1` | 官方表确认 9 主线适配 Fastify 5。[兼容表](https://github.com/fastify/fastify-swagger#compatibility)、[包](https://registry.npmjs.org/@fastify%2Fswagger/9.8.1) |
| 文档 UI（如需要） | `@fastify/swagger-ui@5.2.6` | 当前官方兼容表明确的是 UI 5 + Fastify 5 + swagger 9；本次 Registry 的 latest 已是 UI 6，不能仅跟随 latest 推断兼容。[兼容表](https://github.com/fastify/fastify-swagger-ui#compatibility)、[包](https://registry.npmjs.org/@fastify%2Fswagger-ui/5.2.6) |

**Vite 配对陷阱：** `@vitejs/plugin-react@6.1.1` 的 Vite peer 仅为 `^8.0.0`，不适用于本文的 Vite 7 组合。未来升级时应将 Vite、React 插件、相关测试/构建插件及锁文件作为一组处理。[插件 6 元数据](https://registry.npmjs.org/@vitejs%2Fplugin-react/6.1.1)

**传递依赖：** Vite 7.3.6 的发布包使用 Rollup 与 esbuild 依赖；React 插件 5.2.0 使用 Babel 路线。Fastify 5.12.3 则包含 Ajv compiler、fast-json-stringify、Pino 等依赖。根包版本准确不代表这些传递依赖已经固定，必须由实际解析后的锁文件及其完整性信息保证。[Vite](https://registry.npmjs.org/vite/7.3.6)、[React 插件](https://registry.npmjs.org/@vitejs%2Fplugin-react/5.2.0)、[Fastify](https://registry.npmjs.org/fastify/5.12.3)

## 4. TypeScript 与接口契约的实现影响

TypeScript 6 的配置默认值和旧配置弃用发生变化。新工程应显式写明 `strict`、`target`、`module`、`moduleResolution`、`types`、`rootDir` 和输出目录，不依赖脚手架的浮动默认值。尤其 Node 工程应明确 `types: ["node"]`；浏览器应用与 Vite 配置文件应分开定义运行环境，不能把所有 Node 全局类型混入前端。[TypeScript 6 官方说明](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/)

建议前端采用 bundler 模块解析、`jsx: "react-jsx"` 及 `vite/client` 类型；服务端采用明确的 Node ESM 配置，并以实际编译后入口测试相对路径。以上是项目配置建议，不是完整可复制的 tsconfig。**Vite 负责转译，不做完整类型检查**，所以 S0 验收必须同时包含独立 `tsc --noEmit`／项目构建检查与 `vite build`，不能拿后者替代前者。[Vite 7 TypeScript 文档](https://v7.vite.dev/guide/features#typescript)

Fastify 5 路由校验应采用完整 JSON Schema，包含必要 `type`；自定义 logger 的接入方式、type provider 接口也与 v4 不同，不能沿用 v4 示例。[Fastify 5 迁移说明](https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/)

当前项目已有 OpenAPI 3.1 合约。**文档能打开、TypeScript 类型能生成和运行时请求／响应校验一致，是三项不同检查。** Fastify 官方校验说明使用 Draft 7 示例，并将 Ajv 校验与响应序列化分别处理；不能据此认为已有 3.1 合约可以未经适配直接作为所有默认路由 schema。S0 应以现有正反例核对所选编译器的引用、联合类型、格式、额外字段及强制转换行为，再确定契约接入办法。[Fastify 校验与序列化](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)

## 5. PostgreSQL 与现有工具的边界

PostgreSQL 16 的五年维护周期仍充足，不需要因为当前已有 18 就在 S0 升级主版本。16.15 是 2026-08-13 发布的维护版；16.x 内升级通常不要求 dump/restore，但官方发行说明仍列有配置与索引方面的后续动作，不能把“维护版”理解为任何现有实例都可无检查替换。[维护政策](https://www.postgresql.org/support/versioning/)、[16.15 发行说明](https://www.postgresql.org/docs/release/16.15/)

任务提供的 `psql 16.13` 仅说明客户端版本。`psql` 是连接 PostgreSQL 的交互式终端，不代表本机已有同版本运行中的服务端。[psql 官方说明](https://www.postgresql.org/docs/16/app-psql.html) 后续需要分别记录服务端版本、数据库角色、扩展、迁移执行及事务行为测试；这些本轮都未执行。

Docker `28.5.1` 和 FFmpeg `8.1` 是任务提供的工具清单。本研究未核实 Docker daemon/Compose 是否可用、目标 Postgres 镜像是否可拉取、FFmpeg 编译参数及编解码器是否满足媒体规范；不要在 S0 台账中将工具版本自动等同于对应验收通过。

## 6. 锁定与升级策略

以下为工程建议：

1. 直接依赖填精确版本，提交一份统一锁文件；CI 使用 `npm ci`。此命令要求 package manifest 与锁文件匹配，不会自行重写锁文件；安装仍可能执行生命周期脚本，因此本研究没有运行它。[npm ci 官方文档](https://docs.npmjs.com/cli/v10/commands/npm-ci/)
2. Node、npm、数据库和媒体运行环境分别固定；镜像具体平台与 digest 在实际取得并校验后记录，不能编造 digest。
3. 引擎兼容范围、项目实际验证版本分别记录。首次构建后将“文档兼容候选”升级为“此环境已验证”，保留构建和测试证据。
4. 维护更新走可审查的依赖更新和必要回归，不长期冻结旧安全版本。Fastify 官方明确安全修复偶尔会进入 minor 并包含行为变化，因此不能只允许 patch 而永久忽略 minor。[Fastify LTS](https://fastify.dev/docs/latest/Reference/LTS/)
5. Node 24、Vite 8、TypeScript 7 各自设独立迁移检查；S0 不同时改变所有主线。上述选择并不意味这些新版本不稳定，只是本阶段没有必须同时采用的需求。

## 7. 研究方法与未完成项

版本存在性通过 npm 官方 Registry 的包索引与精确版本端点读取确认；本轮检索排除了 prerelease，并检查所列候选的发布时间不晚于 2026-09-09。类型包的最低 TypeScript 版本与 peer/engine 关系来自其发布元数据。维护周期、行为与兼容政策来自对应项目官方文档，文内就近给出原始 URL。

尚未完成：锁文件解析、安装审计、原生依赖加载、Linux/ARM64 构建、Fastify 插件注册、实际数据库连接、迁移与 RLS、媒体工具能力，以及任何服务商鉴权、配额、费用或生成验证。**本文件的交付结果是一套有证据的 S0 版本候选及检查边界。**
