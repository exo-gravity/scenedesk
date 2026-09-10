# 媒体存储与受限解码基础

2026-09-11。E03 的真实存储与处理边界，位于 `packages/media`。此批先验证不可变字节和受限解码；业务迁移、上传页面、可信 Worker 上下文与重试恢复随后接入，不代表媒体导入业务已交付。

## 固定内容与权限

使用 S3 协议和固定的 AWS SDK 3.1129.0，依赖及摘要进入 package-lock。启动检查要求 bucket versioning 为 Enabled；读取及签名都使用明确 VersionId，拒绝空值和 `null` 版本。依据为 [S3 对象版本](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)及 [S3 预签名访问](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)。

上传凭证最长 15 分钟，POST policy 固定随机 staging key、MIME 和精确字节数。Worker HEAD 固定 staging 版本，再按该版本下载，流式限制大小并计算 SHA-256；声明不是验收依据。验证后的本地字节上传到新的服务端独占 key，使用条件写入、显式 SHA-256 校验并 HEAD 固定版本确认存储摘要。业务层最终以 CAS 记录所接受的版本；上传方没有 originals 或 derivatives 写权限。旧凭证再次上传只改变 staging 的后继版本，不改变已记录原片。

API 的存储身份仅可写 staging、签发 originals／derivatives 的版本读取；Worker 可读取 staging 当前元信息及固定版本，读取原片／派生固定版本并写入新的服务端对象。两者均没有删除、列举全桶、关闭版本或管理账号权限。临时上传不提供媒体访问 URL。业务调用者仍须在签发前检查资源范围、成员及变体状态；本包不接受任意外部 URL，也不替业务 ID 授权。

媒体 URL 有效 5 分钟，固定版本、Content-Type、Content-Disposition 和 private/no-store。安全文件名移除路径、控制及双向控制字符。文本／字幕只允许下载的业务规则将在 API 强制；不能把存储签名器直接暴露为任意 key 签名接口。

## 受限解码与预览

锁定 `mwader/static-ffmpeg:9.0.1` 对应多架构 manifest `sha256:54e55b0cb8f672870fc38ceb2e6c411855cb3b39c505f5f3b2505ee01ed5f2b7`，实际执行确认 FFprobe 9.0.1。构建为静态 PIE，带 GPL／version3 编码器，默认不含 libfdk-aac；镜像构建脚本与二进制许可应分别看待。[维护者源码与构建说明](https://github.com/wader/static-ffmpeg)。运行时只使用固定 digest，禁止自动拉取浮动版本。

每个处理容器 UID/GID 65532、无网络、只读根、全部 capabilities 移除、no-new-privileges、2 CPU、768 MiB 内存及相同 swap 上限、64 进程、64 文件描述符、无 core dump、16 MiB 临时目录。只挂载单个只读输入，不挂载宿主目录、凭据或 Docker socket。输出通过管道写入 Worker 独占文件，逐块限额；容器日志不落盘，stderr 有大小上限且不返回用户。单命令最长 180 秒；超时／取消会显式删除命名容器，不能仅终止 Docker CLI。

初期文件上限 256 MiB，时长两小时，单边 8192、总像素 4096²，视频帧率不超过 240，音频 8–192 kHz／1–8 声道；处理资源不足可以明确失败，不承诺所有上限组合都能完成。允许静态 PNG／JPEG／WebP、MP4／MOV／WebM、WAV／MP3／M4A／FLAC／Ogg；最多一个画面轨及一个混合音轨，多轨应先整理。文本及 SRT 限 2 MiB／UTF-8，字幕作为原始文档保存，尚未实施完整字幕轨导入。

文件签名、轨道、尺寸、时长和完整严格解码共同决定验收，不以扩展名或 MIME 单独验收。保留有理帧率、time base、start PTS 及音轨信息；不能仅因平均帧率有效就声明 CFR，当前明确返回 frameRateMode=unknown。制作副本与逐帧源映射仍属于 E05。

静态图片产生 poster；视频产生 poster 和 proxy；音频产生 proxy；文档没有自动预览。每个输出再次完整解码和计算摘要，原文件字节不变。proxy 使用 H.264／AAC、最大 1280×720（保持比例）、48 kHz 双声道；禁用 B 帧重排并使用 delayed moov 的分片 MP4，保存探测实际值，不覆盖为预期值。样片加入了起点和时长误差检查；这不等于完整编辑渲染的逐帧／采样验收。[FFmpeg 容器参数](https://ffmpeg.org/ffmpeg-formats.html#mov_002c-mp4_002c-ismv)。派生失败可以独立恢复，不把原片改成失败，也不以原片静默替代代理。

## 复现与证据

```sh
npm run test:media:prepare
npm run test:media
```

需要 Docker。准备脚本拉取固定的 FFmpeg、对象存储测试服务及权限配置客户端。存储测试使用随机账号、随机端口、独立内存文件系统，只监听 loopback；结束清除自身容器。MinIO 的历史镜像仅用于 S3 兼容性夹具，仓库已在 2026-04-25 归档且声明停止维护，不能作为生产部署选型；后续部署须在真实目标存储上重跑。[MinIO 维护状态](https://github.com/MinIO/minio)。

存储测试验证：精确上传 policy、变更 key／类型／大小被拒绝、旧凭证覆盖后固定版本可读、摘要不符拒绝、匿名访问拒绝、原文件写权限隔离、本地既有文件不覆盖、源版本丢失及关闭 versioning 时拒绝验收。媒体测试验证：三种真实信号文件、独立 poster／proxy、损坏及伪装文件、尺寸限额、UTF-8 文档、外部播放列表无法访问网络、实际容器资源配置、超时／取消后无残留、输出超额后删除半成品。

已发现并处理的验收问题：流式 WAV 夹具带未知数据长度，被严格解码正确拒绝，改用明确长度的已知 PCM 信号；预览初始 empty moov 与 B 帧重排造成时间信息偏移，改用 delayed moov／无 B 帧后，样片起点为 0、时长差小于一帧。没有通过降低解码严格程度让损坏输入通过。

本地 `test:media` **15 项通过**（7 项存储、8 项解码与隔离，含父测试）；`npm run check` 通过生成契约、类型、构建、14 项单元测试、37 文件 UI 规则和 20 项对比度检查。此批新增依赖安装时审计为 0 项漏洞。CI 已加入固定镜像准备和同一媒体测试，远端结果以 PR 检查为准。

剩余 E03：受限业务 Worker 的真实根解析／CAS、业务与队列原子提交、处理状态及修复扫描、上传完成与权限撤销竞态、浏览器直传／进度／恢复、资产固定版本和共享。完整 S3 产品兼容性、生产存储授权及浏览器媒体播放另做实际环境验收。
