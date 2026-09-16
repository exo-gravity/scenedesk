# 创作工作台自动回归执行记录（2026-09-16）

基线为 `origin/main` 的 `5c09065`。本次只修复测试定位、操作顺序与合成媒体服务器，未修改产品服务、播放器、数据库迁移或执行超时。测试代码提交为 `3e29350`、`4219236`，对应 PR #52。

## 实际执行及修复

已有 25 条 Playwright 测试首次完整执行：**20 通过、5 失败，3.1 分钟**。修复后针对这 5 条再次实际执行：**5 通过，56.8 秒**。这两次记录不能写成“一轮 25/25 通过”；最终与连续创作、批量交付变更合并后还要统一回归。

测试采用生产 Web 构建、实际业务 API、独立 `drama_e2e_regression_finish` 数据库、每个 fixture 的随机 schema 和受限运行角色。使用本机 PostgreSQL 16.13、合成身份及明确标识的外部服务 fixture，不代表真实飞书授权、真实模型、容器部署或生产验收。Chromium 为仓库锁定的 Playwright 版本提供的浏览器。

修复的失败边界：

- 模型选择改按 `combobox` 角色定位；原标签同时匹配了隐藏的 `listbox`。
- 原文全选使用 `ControlOrMeta+A`；原 Home/End 组合键在 macOS 没有产生选区。保留 emoji、固定字符区间、并发 CAS 和断响应后只读恢复断言。
- 下一稿导航、刷新后，明确验证本机草稿提示，恢复并保存后再检查公共 API。导航保留内容不等于自动提交服务器。
- 合成原片 HTTP 服务器补齐 `Accept-Ranges`、单范围 206、无效范围 416 和 HEAD。原来所有范围请求都返回 200，候选入点 seek 无法前进。修复后真实播放器推进并在片段末端暂停，随后下载的原片 SHA 与固定选用一致。
- 该合成 store 的文件下载只接受 fixture 的固定版本、长度和 SHA，以排他方式写入测试目标文件，供批量交付回归复用。

运行入口仍为仓库 `tests/e2e/playwright.config.ts`，没有生成成功业务响应，也没有把 `--list` 或人工页面检查当作自动执行。原全量和定向记录分别在本次工作树的 `output/verification/2026-09-16-regression-01/e2e-native-01.log`、`e2e-targeted-01.log`；失败截图位于独立的 `output/playwright/<run-id>/`。

## 媒体诊断和证据边界

原 `audio-production` 故障复现命令为：

```sh
node --import tsx --test --test-name-pattern='actual audio production' tests/media/audio-production.test.ts
```

该次执行 10 个测试（含父测试），3 通过、7 失败。原先报告失败的 delayed embedded audio **未经修改通过，113.8 秒**；单声道样本和 44.1 kHz 重采样也通过。失败发生位置不同，其中一项在 15.75 秒报 `MEDIA_TIMEOUT`，而媒体处理限额为 180 秒、Docker 生命周期限额为 15 秒。

判别证据：宿主机 16 GiB 内存，17:27 的 swap 已使用 16.83 GiB、可用页约 58 MiB、负载 117.19；17:29 负载达到 143.64。隔离 Docker tmpfs PostgreSQL 仍出现 120 秒 fixture 初始化超时，而同样迁移和权限的本机 PostgreSQL 下，浏览器业务用例恢复至数秒。没有因此提高测试或产品时限。

暂停并行重测试后，无输入 `ffprobe -version` 探针 3 次通过：Docker create 0.138–0.746 秒，start 1.13–2.05 秒。随后使用原时限串行运行全媒体目录，实际通过：

- `audio-generation` 整组（3 个子测试及父测试），370.9 秒：原音频验收、错误时长拒绝、归档重试和预览失败时保留可用原件。
- PCM WAV 制作样本断言，133.2 秒。

之后再次出现随机生命周期超时。仅记录操作名、容器名、时长和退出状态的临时诊断准确捕获：`docker create` 在 **15,014 毫秒被 SIGKILL**。这是既有限额终止容器创建，不能归因于延迟音轨解码。按照本轮验证优先级停止后续全量，保留原失败证据；**未完成的媒体套件不得标为通过**。

本次全量尝试记录的 28 个媒体容器中，27 个有正常删除完成记录，停止时尚在创建的最后 1 个按确切名称单独清理。专属 tmpfs PostgreSQL 容器已清理。未重启 Docker、未全局 prune、未停止用户工作台或其他人的服务。本机原生 PostgreSQL 暂留给本轮其他隔离测试，最后由协调任务清理。

详细证据在本次工作树的 `output/verification/2026-09-16-regression-01/`：`audio-baseline.log`、`media-full-01.log`、`media-docker.jsonl`、`docker-lifecycle.jsonl` 和 `diagnosis.md`。临时诊断代码位于忽略的 `.runtime`，未进入产品。延期的后期 normalization/audio-production 不作为首版创作工作台交付前提；相关原件、存储及图视频生成归档仍需按各自验证边界记录。

## GitHub 状态

PR #52 的四项 GitHub Actions 检查没有启动，annotation 明确为账户支付/额度限制；不能把其 2–3 秒 failure 当作产品测试失败或通过。依照已授权的手动合并规则，由协调任务检查最终 diff、合并后的本地验证和剩余边界，再普通合并。没有改仓库可见性或保护规则。
