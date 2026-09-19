#!/usr/bin/env bash
# scenedesk 推送前本地门禁 —— 用本地时间换 GitHub Actions 额度。
#
# 用法(在 scenedesk 仓库根目录执行):
#   bash scenedesk-preflight.sh              # 等价于 ci.yml + deployment.yml 的检查,不跑 docker/e2e
#   bash scenedesk-preflight.sh --heavy      # 追加 docker build(三个 target)+ smoke
#   bash scenedesk-preflight.sh --e2e        # 追加重型 Playwright e2e
#   bash scenedesk-preflight.sh --all        # 全部
#   bash scenedesk-preflight.sh --skip-heavy # 只跑最便宜的一层
#
# 只改动 docs/**、*.md 时自动跳过重型检查(这类改动在 CI 上也不该跑 docker)。
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

HEAVY=ask
E2E=0
for arg in "$@"; do
  case "$arg" in
    --heavy) HEAVY=1 ;;
    --skip-heavy) HEAVY=0 ;;
    --e2e) E2E=1 ;;
    --all) HEAVY=1; E2E=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

BASE="${BASE:-origin/main}"
git rev-parse --verify "$BASE" >/dev/null 2>&1 || { echo "缺少 $BASE,先执行: git fetch origin" >&2; exit 2; }

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[33m    ! %s\033[0m\n' "$1"; }

# ---- 本次分支相对 base 改了什么 ----
CHANGED="$(git diff --name-only "$BASE"...HEAD 2>/dev/null || git diff --name-only "$BASE")"
DOCS_ONLY=1
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    docs/*|*.md) ;;
    *) DOCS_ONLY=0 ;;
  esac
done <<<"$CHANGED"

step "改动范围(vs $BASE)"
printf '%s\n' "$CHANGED" | sed 's/^/    /' | head -40
printf '    共 %s 个文件; 纯文档改动=%s\n' "$(printf '%s\n' "$CHANGED" | grep -c . || true)" "$DOCS_ONLY"

# ---- 便宜层:等价 ci.yml 的 verify job ----
step "1/3 静态与单测(npm ci -> check -> db -> worker -> media)"
npm ci
# 校验依赖装在仓库的 .venv 里(见 AGENTS.md「契约与文档检查」)。
# 不往系统 Python 装:Homebrew 的 PEP 668 会直接拒绝,而 `pip`/`python` 在只装了
# python3 的机器上并不存在。缺失时给出补救命令并停下，而不是静默失败。
PYTHON="${PYTHON:-.venv/bin/python}"
if [ ! -x "$PYTHON" ]; then
  echo "缺少校验用 Python 环境。先执行:" >&2
  echo "  python3 -m venv .venv && .venv/bin/pip install -r docs/implementation/validation-requirements.txt" >&2
  exit 2
fi
"$PYTHON" -m pip install -q -r docs/implementation/validation-requirements.txt
"$PYTHON" docs/implementation/check_design.py
npm run check
npm run db:migrate
npm run test:db
npm run worker:check
npm run test:media:prepare
npm run test:media

if [ "$DOCS_ONLY" = 1 ] && [ "$HEAVY" = ask ]; then
  warn "本轮只改文档,自动跳过 docker/smoke/e2e(要强制请加 --heavy 或 --all)"
  HEAVY=0
fi
[ "$HEAVY" = ask ] && HEAVY=1

# ---- 中间层:等价 deployment.yml 的 verify-deployment ----
if [ "$HEAVY" = 1 ]; then
  step "2/3 部署包验证(deploy/check.sh -> integration -> 三个镜像 -> smoke)"
  sh deploy/check.sh
  PROVIDER_MODE=mock DATABASE_URL="${DATABASE_URL:-}" \
    node --import tsx --test --test-concurrency=1 deploy/integration/*.test.ts
  docker build -f deploy/Dockerfile --target api          -t scenedesk-private-api:local .
  docker build -f deploy/Dockerfile --target web          -t scenedesk-private-web:local .
  docker build -f deploy/Dockerfile --target media-worker -t scenedesk-private-worker:local .
  SCENEDESK_IMAGE_TAG=local bash deploy/smoke/run.sh
  warn "smoke 失败时保留现场: SCENEDESK_SMOKE_KEEP_ON_FAILURE=1 bash deploy/smoke/run.sh"
else
  step "2/3 部署包验证(已跳过:--skip-heavy 或纯文档改动)"
fi

# ---- 重型层:等价 workspace-e2e.yml ----
if [ "$E2E" = 1 ]; then
  step "3/3 创意工作台 E2E(npm run test:e2e)"
  npm run test:e2e
  step "3/3 设计预览规则检查(npm run check:design-preview)"
  npm run check:design-preview
else
  step "3/3 创意工作台 E2E 与设计预览规则检查(已跳过:加 --e2e 运行)"
fi

# ---- 推送前提醒:该压掉的轮次 ----
step "推送前检查"
echo "    本分支领先 $BASE 的提交:"
git log --oneline "$BASE"..HEAD | sed 's/^/      /' | head -30
RECORDS="$(git log --format=%s "$BASE"..HEAD | grep -ciE '^docs.*(record|refresh|preserve|track|note)' || true)"
MERGES="$(git log --format=%s "$BASE"..HEAD | grep -cE "^Merge (remote-tracking )?branch 'origin/main'" || true)"
echo
echo "    记录型提交: $RECORDS 个   合并 origin/main 的提交: $MERGES 个"
if [ "$RECORDS" != 0 ] || [ "$MERGES" != 0 ]; then
  warn "这两类提交每一个都会在 CI 上独立触发一整轮(3 个 workflow + 3 次 docker build + 9 容器 smoke)"
  warn "推送前先合并它们,一次推送代替多次:"
  warn "  git rebase -i $BASE     # 记录型提交改成 fixup;删掉 'Merge ... origin/main' 行(改用 rebase)"
  warn "  git push --force-with-lease origin \$(git branch --show-current)"
fi
echo
echo "    本地全绿后,一次推送即可(避免同一分支连续多次 push)。"
