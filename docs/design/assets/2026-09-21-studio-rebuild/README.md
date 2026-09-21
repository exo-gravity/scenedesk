# 创作区重建：分片并排图

每片一张：左为 `docs/research/assets/2026-09-21-canvas-cards/` 里的 LibTV 现场截图，右为新页面在同尺寸（1920 宽）浅色下的生产构建截图，由 `tests/e2e/studio-*.spec.ts` 实际运行捕获。这些是评审证据，不是像素基线。

| 文件 | 片 | 左 | 右 |
|---|---|---|---|
| `phase-0-shell.png` | 0 准备 | `libtv-image-selected.png` | ST-00：新入口的空创作台 |
| `slice-1-image-selected.png` | ① 页面壳与卡片 | `libtv-image-selected.png` | ST-01：文字卡旁选中的空图片卡，端口可见 |
| `slice-1-text-edit.png` | ① 页面壳与卡片 | `libtv-text-edit.png` | ST-01：文字卡就地编辑 |
| `slice-1-shortcuts.png` | ① 页面壳与卡片 | `libtv-shortcuts.png` | ST-01：快捷键总览，只列已实现的 |
| `slice-2-references.png` | ② 端口与连线 | `libtv-video-composer.png` | ST-02：文字卡的 ⊕、两条连线、用途角标与重复引用的提示 |
| `slice-3-composer.png` | ③ 输入面板 | `libtv-video-composer.png` | ST-03：图片草稿下的输入面板，已填提示词与模型 |
| `slice-3-model-picker.png` | ③ 输入面板 | `libtv-model-picker.png` | ST-03：模型列表（受控夹具模型） |
| `slice-3-spec-picker.png` | ③ 输入面板 | `libtv-spec-picker.png` | ST-03：规格浮层（该模型只允许 1:1 与 32x32） |
| `slice-4-result.png` | ④ 卡内结果 | `libtv-image-selected.png` | ST-04：视频草稿卡内的结果与面板任务行（合成媒体无海报） |
| `slice-5-assets.png` | ⑤ 资产侧面板 | `libtv-text-edit.png`（左下空面板） | ST-05：资产面板打开，列出项目资产与素材 |
