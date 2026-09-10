"""Validate design artifacts only. Never connect to a product, provider, or database."""
import hashlib
import importlib.metadata
import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote

from jsonschema import Draft202012Validator, FormatChecker
from openapi_spec_validator import validate as validate_openapi

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
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
expected_requirements = {f"PR-{n:02d}" for n in range(1, 16)}
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
check(set(re.findall(r"^\| (AT-\d{2}) \|", acceptance, re.M)) == {f"AT-{n:02d}" for n in range(1, 37)}, "Acceptance case inventory incomplete")
check(expected_requirements <= set(re.findall(r"^\| (PR-\d{2}) \|", acceptance, re.M)), "Traceability PR missing")
for line in acceptance.splitlines():
    if re.match(r"\| PR-\d{2} \|", line):
        names = line.split("|")[3].strip().split("、")
        for name in names:
            check(name in operations, f"Unknown traced operation: {name}")
checks.append("PR-01–15 均有接口与验收追踪；AT-01–36 清单完整，追踪表中的 operationId 均存在")

job_schema = spec["components"]["schemas"]["GenerationJob"]["properties"]["status"]["enum"]
state_doc = (ROOT / "04-state-execution-and-budget.md").read_text()
state_line = next(line for line in state_doc.splitlines() if line.startswith("| 生成作业 |"))
check(set(state_line.split("|")[2].strip().split(" / ")) == set(job_schema), "Job state names drift between contract and document")
checks.append("生成作业状态枚举与状态设计一致")

link_count = 0
files = sorted(ROOT.glob("*.md")) + sorted((ROOT.parent / "adr").glob("*.md"))
for file in files:
    if file.name == "validation-report.md":
        continue
    content = file.read_text()
    check(content.count("```") % 2 == 0, f"Unclosed code fence: {file.name}")
    plain = re.sub(r"```[\s\S]*?```", "", content)
    for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", plain):
        if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target) or target.startswith("#"):
            continue
        target = unquote(target.split("#", 1)[0].strip("<>"))
        check((file.parent / target).exists(), f"Broken file link: {file.name} -> {target}")
        link_count += 1
checks.append(f"本包与 ADR 的 {link_count} 个本地文件链接可解析，代码围栏成对；未对远端 URL 或 Markdown 锚点做自动可用性断言")

artifacts = [ROOT / "openapi.json", ROOT / "api-operations.md"]
before = [hashlib.sha256(p.read_bytes()).hexdigest() for p in artifacts]
subprocess.run([sys.executable, str(ROOT / "build_contract.py")], check=True, capture_output=True)
after = [hashlib.sha256(p.read_bytes()).hexdigest() for p in artifacts]
check(before == after, "Generated artifacts were stale or nondeterministic; run again after review")
checks.append("OpenAPI 与操作目录重新生成的 SHA-256 不变，未发现手改生成文件或不确定生成")

versions = {p: importlib.metadata.version(p) for p in ["openapi-spec-validator", "jsonschema"]}
report = ["# 设计包静态校验报告", "", "日期：2026-09-07。结果：PASS。此报告由 check_design.py 在所有检查通过后生成。", "", "## 已实际执行", ""]
report += [f"- {item}。" for item in checks]
report += ["", "## 验证环境与产物", "", f"- Python：{sys.version.split()[0]}。", *[f"- {p}：{v}。" for p,v in versions.items()], f"- openapi.json SHA-256：`{after[0]}`。", f"- api-operations.md SHA-256：`{after[1]}`。", "", "## 没有由本报告证明的事项", "", "数据库迁移、RLS／权限实际隔离、预算并发、SDK 实际重试、供应商效果与计费、媒体解码／渲染、浏览器交互、压测、备份恢复和用户试点均未运行。AT-01–36 与 MV-01–10 是待执行清单；本报告不把结构检查作为业务或生产验收。", "", "本地链接检查不验证章节锚点或所有外链在线状态；需求追踪检查确保编号与操作存在，不替代人工评审其语义。", ""]
(ROOT / "validation-report.md").write_text("\n".join(report))
print(json.dumps({"result":"PASS", "operations":len(operations), "paths":len(spec["paths"]), "schemas":len(spec["components"]["schemas"]), "examples":len(samples), "localLinks":link_count, "versions":versions}, ensure_ascii=False))
