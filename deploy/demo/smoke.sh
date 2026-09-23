#!/usr/bin/env bash
# Run one PAID measurement smoke on the demo box and bring the evidence back.
#
#   deploy/demo/smoke.sh <minimax|volcengine> <image|video> <name> [options]
#
#   options are scripts/verified-smoke.ts options: --ratio 9:16 --resolution 768P --duration 4
#   --image <local file> (repeatable) --role reference_image|first_frame|last_frame --model <id>
#   --prompt "<text>". Local --image files are uploaded to the box first.
#
# Uploads the checkout's remote.sh and scripts/verified-smoke.ts (the box mounts the latter over
# the image's copy, so no rebuild), asks for "yes", runs the task inside the operations image,
# then copies output/verified/<date>/<name>/ back here and prints the stream size with ffprobe.
# Evidence: record.json (redacted) plus result.mp4 / result.jpg. Needs the operator's own SSH access.
set -euo pipefail

HOST=${SCENEDESK_DEMO_HOST:-root@8.210.171.132}
REMOTE_HOME=${SCENEDESK_DEMO_HOME:-/opt/scenedesk}

vendor=${1:-}
kind=${2:-}
name=${3:-}
if [ -z "$vendor" ] || [ -z "$kind" ] || [ -z "$name" ]; then sed -n '2,13p' "$0"; exit 2; fi
case "$vendor" in minimax | volcengine) ;; *) echo "vendor must be minimax or volcengine" >&2; exit 2 ;; esac
case "$kind" in image | video) ;; *) echo "kind must be image or video" >&2; exit 2 ;; esac
[[ $name =~ ^[A-Za-z0-9._-]+$ ]] || { echo "name must be [A-Za-z0-9._-]" >&2; exit 2; }
shift 3

here=$(cd "$(dirname "$0")" && pwd)
cd "$(git -C "$here" rev-parse --show-toplevel)"
for tool in ssh scp rsync; do
  command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 2; }
done
step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
remote() { ssh -o BatchMode=yes -o ConnectTimeout=20 "$HOST" "$@"; }

# Rewrite --image <local> to the container path after uploading; everything else passes through.
uploads=()
args=()
while [ $# -gt 0 ]; do
  if [ "$1" = --image ]; then
    [ -f "${2:-}" ] || { echo "--image file not found: ${2:-}" >&2; exit 2; }
    base=$(basename "$2")
    [[ $base =~ ^[A-Za-z0-9._-]+$ ]] || { echo "image file name must be [A-Za-z0-9._-]: $base" >&2; exit 2; }
    uploads+=("$2")
    args+=(--image "/workspace/output/verified/inputs/$base")
    shift 2
  else
    args+=("$1")
    shift
  fi
done

step "check the box"
remote true || { echo "cannot reach $HOST over ssh" >&2; exit 1; }
remote "test -f $REMOTE_HOME/secrets/generation.json" || { echo "the box has no generation.json; run deploy/demo/enable-generation.sh first" >&2; exit 1; }
remote "mkdir -p $REMOTE_HOME/bin $REMOTE_HOME/output/verified/inputs && chown 1000:1000 $REMOTE_HOME/output/verified"
scp -q "$here/remote.sh" "$HOST:$REMOTE_HOME/bin/demo-remote.sh"
scp -q scripts/verified-smoke.ts "$HOST:$REMOTE_HOME/bin/verified-smoke.ts"
remote "chmod +x $REMOTE_HOME/bin/demo-remote.sh; chmod 0644 $REMOTE_HOME/bin/verified-smoke.ts"
if [ ${#uploads[@]} -gt 0 ]; then
  scp -q "${uploads[@]}" "$HOST:$REMOTE_HOME/output/verified/inputs/"
  remote "chmod 0644 $REMOTE_HOME/output/verified/inputs/*"
fi

date=$(date +%F)
out="$date/$name"
step "paid smoke: $vendor $kind -> output/verified/$out"
printf '  arguments:'; printf ' %q' ${args[@]+"${args[@]}"}; echo
printf 'This creates one real vendor task. Type yes to spend that now: '
read -r answer
[ "$answer" = yes ] || { echo "stopped, nothing was sent"; exit 0; }

quoted=""
for a in ${args[@]+"${args[@]}"}; do quoted="$quoted $(printf '%q' "$a")"; done
remote "$REMOTE_HOME/bin/demo-remote.sh smoke $vendor $kind $out$quoted"

step "copy the evidence to output/verified/$out"
mkdir -p "output/verified/$out"
rsync -az "$HOST:$REMOTE_HOME/output/verified/$out/" "output/verified/$out/"
ls -la "output/verified/$out/"
result="output/verified/$out/result.mp4"
[ -f "$result" ] || result="output/verified/$out/result.jpg"
if [ -f "$result" ] && command -v ffprobe >/dev/null; then
  ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate,duration -of default=noprint_wrappers=1 "$result"
fi
echo "record: output/verified/$out/record.json"
