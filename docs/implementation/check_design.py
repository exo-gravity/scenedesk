"""Validate design artifacts only. Never connect to a product, provider, or database."""
import argparse
import hashlib
import importlib.metadata
import json
import re
import subprocess
import sys
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import unquote

from jsonschema import Draft202012Validator, FormatChecker
from openapi_spec_validator import validate as validate_openapi

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
started_at = datetime.now(timezone.utc)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output-dir", type=Path, help="Fresh directory under repository output/; defaults to a UTC timestamped directory")
args = parser.parse_args()
output_dir = (args.output_dir or REPO / "output" / "documentation-checks" / started_at.strftime("%Y%m%dT%H%M%S.%fZ")).resolve()
if not output_dir.is_relative_to(REPO / "output") or output_dir.exists():
    parser.error("--output-dir must be a new directory under repository output/; historical reports are never overwritten")
spec = json.loads((ROOT / "openapi.json").read_text())
checks = []
def check(condition, message):
    if not condition:
        raise AssertionError(message)

def resolve(pointer):
    value = spec
    check(pointer.startswith("#/"), f"Unexpected external schema reference: {pointer}")
    for part in pointer[2:].split("/"):
        value = value[part.replace("~1", "/").replace("~0", "~")]
    return value

def walk(value):
    if isinstance(value, dict):
        yield value
        for item in value.values():
            yield from walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk(item)

validate_openapi(spec)
checks.append("OpenAPI 3.1 完整文档结构校验通过")
refs = [v["$ref"] for v in walk(spec) if "$ref" in v]
for pointer in refs:
    resolve(pointer)
for name, schema in spec["components"]["schemas"].items():
    Draft202012Validator.check_schema(schema)
checks.append(f"{len(refs)} 处内部引用可解析；{len(spec['components']['schemas'])} 个 Schema 定义有效")

operations = {}
requirements = set()
cas_count = 0
for path, methods in spec["paths"].items():
    for method, operation in methods.items():
        op_id = operation["operationId"]
        check(op_id not in operations, f"Duplicate operationId: {op_id}")
        operations[op_id] = operation
        requirements.add(operation["x-requirement"])
        check(bool(operation["x-permission"]), f"No permission: {op_id}")
        params = [resolve(p["$ref"]) if "$ref" in p else p for p in operation["parameters"]]
        check(len({(p["name"], p["in"]) for p in params}) == len(params), f"Repeated parameter: {op_id}")
        actual = {p["name"] for p in params if p["in"] == "path" and p.get("required")}
        check(actual == set(re.findall(r"\{([^}]+)\}", path)), f"Path mismatch: {path}")
        headers = {p["name"] for p in params if p["in"] == "header" and p.get("required")}
        if method in {"post", "put", "patch", "delete"} and operation.get("security") != []:
            check("X-CSRF-Token" in headers, f"Missing CSRF: {op_id}")
            if method == "post":
                check("Idempotency-Key" in headers, f"Missing key: {op_id}")
        if "If-Match" in headers:
            cas_count += 1
        check(any(c.startswith("2") or c == "302" for c in operation["responses"]), f"No success response: {op_id}")
expected_requirements = {f"PR-{n:02d}" for n in range(1, 18)}
check(requirements == expected_requirements, "PR requirements missing from contract")
checks.append(f"{len(operations)} 个唯一操作、{len(spec['paths'])} 条路径；授权标识、写请求头、路径参数和 {cas_count} 个 CAS 操作检查通过")

samples = json.loads((ROOT / "sample-payloads.json").read_text())["samples"]
for sample in samples:
    name = sample["schema"]
    schema = {**spec["components"]["schemas"][name], "components": spec["components"]}
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors = list(validator.iter_errors(sample["value"]))
    check(bool(errors) != sample["valid"], f"Sample {sample['name']}: {[e.message for e in errors]}")
    if "requestOperationId" in sample:
        op = operations[sample["requestOperationId"]]
        req = op["requestBody"]["content"]["application/json"]["schema"]
        check(req["$ref"].endswith("/" + name), f"Sample bound to wrong request: {sample['name']}")
valid = sum(s["valid"] for s in samples)
checks.append(f"{valid} 个有效样例被接受、{len(samples)-valid} 个故意无效样例被拒绝；样例对应操作的请求类型一致")

acceptance = (ROOT / "08-verification-and-delivery-plan.md").read_text()
check(set(re.findall(r"^\| (AT-\d{2}) \|", acceptance, re.M)) == {f"AT-{n:02d}" for n in range(1, 76)}, "Acceptance case inventory incomplete")
check(expected_requirements <= set(re.findall(r"^\| (PR-\d{2}) \|", acceptance, re.M)), "Traceability PR missing")
for line in acceptance.splitlines():
    if re.match(r"\| PR-\d{2} \|", line):
        names = line.split("|")[3].strip().split("、")
        for name in names:
            check(name in operations, f"Unknown traced operation: {name}")
checks.append("PR-01–17 均有接口与验收追踪；AT-01–75 清单完整，追踪表中的 operationId 均存在")

job_schema = spec["components"]["schemas"]["GenerationJob"]["properties"]["status"]["enum"]
state_doc = (ROOT / "04-state-execution-and-budget.md").read_text()
state_line = next(line for line in state_doc.splitlines() if line.startswith("| 生成作业 |"))
check(set(state_line.split("|")[2].strip().split(" / ")) == set(job_schema), "Job state names drift between contract and document")
checks.append("生成作业状态枚举与状态设计一致")
revision_operation = next(op for methods in spec["paths"].values() for op in methods.values() if op["operationId"] == "getAssistanceRevision")
revision_param = next(p for p in revision_operation["parameters"] if p.get("name") == "revisionNumber")
check(revision_param["schema"]["type"] == "integer" and revision_param["schema"]["minimum"] == 1, "Assistance revision must be addressable by its saved number")
check("creativeBasisRevisionIds" in spec["components"]["schemas"]["CutRevision"]["properties"], "Frozen cut must expose immutable creative basis references")
checks.append("新增建议版本按正整数可定位；固定稿暴露不可变创作依据关系，确认用途的正反样例通过（事务行为仍待实现）")

canvas_schemas = spec["components"]["schemas"]
check(canvas_schemas["Canvas"]["properties"]["revision"]["minimum"] == 1, "Saved canvas revision must be positive")
check(canvas_schemas["SceneWorkspacePreference"]["properties"]["revision"]["minimum"] == 0, "Uncreated preference must allow virtual revision zero")
preference_header = next(p for p in operations["saveSceneWorkspacePreference"]["parameters"] if p.get("name") == "If-Match")
check(re.fullmatch(preference_header["schema"]["pattern"], '"0"'), "First preference save must accept If-Match zero")
canvas_revision_param = next(p for p in operations["getCanvasRevision"]["parameters"] if p.get("name") == "revisionNumber")
check(canvas_revision_param["schema"]["type"] == "integer" and canvas_revision_param["schema"]["minimum"] == 1, "Canvas historical revision must be an integer")
check(set(canvas_schemas["SaveCanvas"]["properties"]) == {"schemaVersion", "document"}, "Canvas document write must not accept production facts")
check("canvas_draft" in canvas_schemas["SourceDependency"]["properties"]["kind"]["enum"], "Canvas plan source is missing")
check(canvas_schemas["MaterializeCanvasResults"]["properties"]["mediaIds"]["uniqueItems"], "Results must reject repeated media IDs")
check(set(canvas_schemas["CanvasDraftContent"]["properties"]) == {"type", "prompt", "connectionId", "capabilityId", "output"}, "Draft must not own execution state")
checks.append("画布写入与制作事实分离、历史修订、偏好初始版本0、来源依赖及结果ID去重均有契约约束；跨字段关系、授权和事务仍待运行验收")

work_header = next(p for p in operations["saveCutWorkDraft"]["parameters"] if p.get("name") == "If-Match")
check(re.fullmatch(work_header["schema"]["pattern"], '"0"'), "First work draft save must accept revision zero")
check(set(canvas_schemas["NormalizationInput"]["properties"]) == {"cutId", "baseCutRevision", "workDraftRevision"}, "Normalization must read a saved work draft rather than a second timeline")
check("workDraftSource" in canvas_schemas["NormalizationResult"]["required"], "Normalization must expose its fixed work draft source")
check("expectedWorkDraftRevision" in canvas_schemas["FreezeCut"]["required"], "Freeze must observe the working draft")
for name in ["getCanvasRevision", "getCutWorkDraftRevision", "getCutNormalization"]:
    check("410" in operations[name]["responses"], f"Expired recovery content must have an explicit response: {name}")
check("timingOrigins" in canvas_schemas["CutWorkDocument"]["required"], "Work draft must carry explicit precision provenance")
checks.append("工作稿首次CAS0、归一固定来源、冻结观察版本、精确时间来源及历史过期410有结构约束；双版本事务、真实清理和权限仍待AT运行验证")

link_count = 0
frozen_root = ROOT.parent / "reviews" / "2026-09-07" / "baseline"
files = sorted(p for p in ROOT.parent.rglob("*.md") if not p.is_relative_to(frozen_root))
files += [REPO / "README.md", REPO / "CONTEXT.md", REPO / "apps" / "web" / "AGENTS.md"]
for file in files:
    if file.name == "validation-report.md":
        continue
    content = file.read_text()
    check(content.count("```") % 2 == 0, f"Unclosed code fence: {file.name}")
    plain = re.sub(r"```[\s\S]*?```", "", content)
    for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", plain):
        if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target) or target.startswith("#"):
            continue
        target = re.sub(r":\d+$", "", unquote(target.split("#", 1)[0].strip("<>")))
        check((file.parent / target).exists(), f"Broken file link: {file.name} -> {target}")
        link_count += 1
checks.append(f"现行与历史文档（冻结副本另验哈希）的 {link_count} 个本地文件链接可解析，代码围栏成对；未对远端 URL 或 Markdown 锚点做自动可用性断言")

# Preserve independent evidence and verify every first-round finding is adjudicated.
review_root = ROOT.parent / "reviews" / "2026-09-07"
baseline = json.loads((review_root / "baseline-manifest.json").read_text())
for entry in baseline["files"]:
    actual = hashlib.sha256((review_root / "baseline" / entry["path"]).read_bytes()).hexdigest()
    check(actual == entry["sha256"], f"Frozen baseline modified: {entry['path']}")
checks.append(f"独立评审冻结基线的 {len(baseline['files'])} 个文件 SHA-256 未改变")
first_ids = set()
for file in ["technical-review.md", "product-review.md", "drama-review.md"]:
    first_ids.update(re.findall(r"^\| ((?:TECH|PROD|DRAMA)-\d{2}) \|", (review_root/file).read_text(), re.M))
decisions = json.loads((review_root / "decision-log.json").read_text())["decisions"]
check(len(decisions) == len(first_ids) == 29, "Review finding count mismatch")
check({d["id"] for d in decisions} == first_ids, "Review decisions missing")
for decision in decisions:
    check(decision["designStatus"] == "closed" and decision["executionStatus"] == "pending", "Review closure conflates design and execution")
    for doc in decision["documents"]:
        check((REPO/doc).is_file(), f"Missing review change target: {doc}")
    check(set(decision["acceptance"]) <= {f"AT-{n:02d}" for n in range(1,47)}, "Unknown review AT")
check([sum(d["severity"]==sev for d in decisions) for sev in ["P0","P1","P2"]] == [8,20,1], "Review severity totals changed")
checks.append("首轮29项评审全部有裁决、修改文档与待执行验收；8项P0／20项P1／1项P2分布一致（状态为设计关闭、运行待验收）")

# Templates must remain usable as CSV rather than malformed examples.
import csv
csv_files = sorted((ROOT / "templates").glob("*.csv"))
for file in csv_files:
    with file.open(newline="") as handle:
        rows = list(csv.reader(handle))
    check(len(rows) >= 1 and len(rows[0]) == len(set(rows[0])), f"Invalid CSV header: {file.name}")
    check(all(len(row) == len(rows[0]) for row in rows), f"CSV width drift: {file.name}")
with (ROOT/"templates"/"shot-list-import.csv").open(newline="") as handle:
    fixture = list(csv.DictReader(handle))
check(all(all(row[key].strip() for key in ["episode","scene","shot_label","intent"]) for row in fixture), "Fixture mandatory fields empty")
check(sum(float(row["duration_seconds"]) for row in fixture) == 46, "F0 CSV duration drift")
checks.append(f"{len(csv_files)}份CSV模板列宽一致，F0六镜导入的必填内容与46秒总规划时长一致；不代表媒体已制作")

artifacts = [ROOT / "openapi.json", ROOT / "api-operations.md"]
before = [hashlib.sha256(p.read_bytes()).hexdigest() for p in artifacts]
subprocess.run([sys.executable, str(ROOT / "build_contract.py")], check=True, capture_output=True)
after = [hashlib.sha256(p.read_bytes()).hexdigest() for p in artifacts]
check(before == after, "Generated artifacts were stale or nondeterministic; run again after review")
checks.append("OpenAPI 与操作目录重新生成的 SHA-256 不变，未发现手改生成文件或不确定生成")

versions = {p: importlib.metadata.version(p) for p in ["openapi-spec-validator", "jsonschema"]}
generated_at = datetime.now(timezone.utc).isoformat()
report = ["# 设计包静态校验报告", "", f"执行时间（UTC）：{generated_at}。结果：PASS。此报告由 check_design.py 在所有检查通过后生成，旧交付快照不回写。", "", "## 已实际执行", ""]
report += [f"- {item}。" for item in checks]
report += ["", "## 验证环境与产物", "", f"- Python：{sys.version.split()[0]}。", *[f"- {p}：{v}。" for p,v in versions.items()], f"- openapi.json SHA-256：`{after[0]}`。", f"- api-operations.md SHA-256：`{after[1]}`。", "", "## 没有由本报告证明的事项", "", "本脚本不验证数据库迁移、RLS／权限实际隔离、预算并发、SDK 实际重试、供应商效果与计费、媒体解码／渲染、浏览器交互、压测、备份恢复和用户试点。S0 有限运行检查另见 15；其通过不代表这些业务验收完成。AT-01–75 与 MV-01–10 是待执行清单；本报告不把结构检查作为业务或生产验收。", "", "本地链接检查不验证章节锚点或所有外链在线状态；需求追踪检查确保编号与操作存在，不替代人工评审其语义。", ""]
output_dir.mkdir(parents=True, exist_ok=False)
report_path = output_dir / "validation-report.md"
report_path.write_text("\n".join(report))
# Export the exact final handoff file set; exclude the manifest itself to avoid recursion.
release_files = set(files) | {report_path, ROOT/"build_contract.py", ROOT/"canvas_contract.py", ROOT/"editing_contract.py", ROOT/"check_design.py", ROOT/"openapi.json", ROOT/"api-operations.md", ROOT/"sample-payloads.json", ROOT/"validation-requirements.txt", review_root/"baseline-manifest.json", review_root/"decision-log.json"} | set(csv_files)
release_files.add(REPO / "packages" / "contracts" / "src" / "generated.ts")
release_manifest = {"date":generated_at[:10], "generatedAt":generated_at, "productDesignVersion":"1.3", "implementationDesignVersion":"1.3", "scope":"Static documentation and contract validation snapshot. Includes current and historical documents; inclusion is not approval or execution authority. No business, visual, provider or production acceptance is implied.", "baselineSnapshot":"docs/reviews/2026-09-07/baseline/", "files":[{"path":str(path.relative_to(REPO)),"bytes":path.stat().st_size,"sha256":hashlib.sha256(path.read_bytes()).hexdigest()} for path in sorted(release_files)]}
manifest_path = output_dir / "documentation-manifest.json"
manifest_path.write_text(json.dumps(release_manifest,ensure_ascii=False,indent=2)+"\n")

print(json.dumps({"result":"PASS", "operations":len(operations), "paths":len(spec["paths"]), "schemas":len(spec["components"]["schemas"]), "examples":len(samples), "localLinks":link_count, "versions":versions, "report":str(report_path.relative_to(REPO)), "manifest":str(manifest_path.relative_to(REPO))}, ensure_ascii=False))
