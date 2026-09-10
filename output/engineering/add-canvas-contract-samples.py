"""Add deterministic structural samples; does not exercise database invariants."""
import copy
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
path = root / "docs/implementation/sample-payloads.json"
payload = json.loads(path.read_text())
payload["samples"] = [s for s in payload["samples"] if not s["name"].startswith("画布契约：")]

def uid(n):
    return f"00000000-0000-4000-8000-{n:012d}"

def add(name, schema, value, valid=True, operation=None):
    sample = {"name": "画布契约：" + name, "schema": schema, "valid": valid, "value": copy.deepcopy(value)}
    if operation:
        sample["requestOperationId"] = operation
    payload["samples"].append(sample)

def node(n, kind, content):
    return {"id": uid(n), "title": f"素材 {n}", "kind": kind, "position": {"x": n * 40, "y": 0}, "width": 280, "content": content}

text = node(1, "text", {"type": "text", "text": "保持同一人物与钥匙。"})
reference = node(2, "image", {"type": "media", "mediaId": uid(102), "assetRevisionId": uid(202)})
video = node(3, "video", {"type": "media", "mediaId": uid(103)})
audio = node(4, "audio", {"type": "media", "mediaId": uid(104)})
draft = node(5, "video", {"type": "draft", "prompt": "人物缓慢拿起钥匙", "connectionId": uid(301), "capabilityId": uid(302), "output": {"aspectRatio": "9:16", "durationSeconds": 7, "withAudio": True}})
edge = {"id": uid(401), "sourceNodeId": text["id"], "targetNodeId": draft["id"], "enabled": True, "position": 0, "purpose": "prompt"}
document = {"nodes": [text, reference, video, audio, draft], "edges": [edge], "groups": []}
save = {"schemaVersion": 1, "document": document}
add("四种节点与独立草稿", "SaveCanvas", save, operation="saveCanvas")
add("空画布", "SaveCanvas", {"schemaVersion": 1, "document": {"nodes": [], "edges": [], "groups": []}}, operation="saveCanvas")
add("不接收任务事实", "SaveCanvas", {**save, "jobs": []}, False, "saveCanvas")
add("不接收镜头绑定写入", "SaveCanvas", {**save, "bindings": []}, False, "saveCanvas")
add("文字不能伪装媒体", "CanvasNode", {**text, "content": video["content"]}, False)
add("视频不能含文字正文", "CanvasNode", {**video, "content": text["content"]}, False)
add("媒体身份不能混有提示词", "CanvasNode", {**video, "content": {**video["content"], "prompt": "覆盖"}}, False)
add("草稿不接收完成状态", "CanvasNode", {**draft, "content": {**draft["content"], "status": "succeeded"}}, False)
add("草稿可未选模型", "CanvasNode", node(6, "image", {"type": "draft", "prompt": "", "output": {}}))
add("节点宽度必须可用", "CanvasNode", {**video, "width": 0}, False)
add("分组数超过容量", "CanvasDocument", {"nodes": [], "edges": [], "groups": [{"id": uid(9000 + i), "title": "组"} for i in range(201)]}, False)
add("引用用途不能作为执行指令", "CanvasReferenceEdge", {**edge, "purpose": "execute"}, False)
add("画布不能携带任意脚本", "CanvasDocument", {**document, "script": "executeAll()"}, False)

canvas = {"id": uid(501), "projectId": uid(502), "revision": 1, "schemaVersion": 1, "document": document, "documentHash": "a" * 64, "updatedAt": "2026-09-09T10:00:00Z"}
add("保存文档封套", "Canvas", canvas)
add("正式文档没有零版本", "Canvas", {**canvas, "revision": 0}, False)
add("哈希必须完整", "Canvas", {**canvas, "documentHash": "abc"}, False)

shot = {"shotId": uid(601), "shotRevisionId": uid(602)}
add("参考绑定", "BindCanvasNode", {"role": "reference", **shot}, operation="bindSceneCanvasNode")
# Reuse the base contract's exact time schema rather than inventing a second representation.
existing_range = next(s["value"]["range"] for s in payload["samples"] if s["schema"] == "TakeInput" and s["valid"])
add("视频候选显式区间", "BindCanvasNode", {"role": "candidate", **shot, "range": existing_range}, operation="bindSceneCanvasNode")
add("候选缺区间拒绝", "BindCanvasNode", {"role": "candidate", **shot}, False, "bindSceneCanvasNode")
add("参考不能暗中创建候选", "BindCanvasNode", {"role": "reference", **shot, "range": existing_range}, False, "bindSceneCanvasNode")
binding = {"id": uid(610), "nodeId": uid(3), **shot, "role": "candidate", "takeId": uid(611), "nodeActive": False}
add("移除呈现仍保留候选", "CanvasShotBinding", binding)
add("候选响应必须有Take", "CanvasShotBinding", {k: v for k, v in binding.items() if k != "takeId"}, False)
add("参考响应不能有Take", "CanvasShotBinding", {**binding, "role": "reference"}, False)

prepare = {"nodeId": draft["id"], "shotSources": [], "referenceOverrides": [], "promptPolicy": "append"}
add("无镜头自由生成准备", "PrepareCanvasGeneration", prepare, operation="prepareCanvasGeneration")
add("明确关联多个镜头", "PrepareCanvasGeneration", {**prepare, "shotSources": [shot, {"shotId": uid(603), "shotRevisionId": uid(604)}]}, operation="prepareCanvasGeneration")
add("不能隐含选择上次镜头", "PrepareCanvasGeneration", {k: v for k, v in prepare.items() if k != "shotSources"}, False, "prepareCanvasGeneration")
add("准备接口不执行", "PrepareCanvasGeneration", {**prepare, "execute": True}, False, "prepareCanvasGeneration")

result = {"jobId": uid(701), "mediaIds": [uid(702)], "position": {"x": 900, "y": 0}}
add("取回归档结果", "MaterializeCanvasResults", result, operation="materializeCanvasResults")
add("结果ID不能重复", "MaterializeCanvasResults", {**result, "mediaIds": [uid(702), uid(702)]}, False, "materializeCanvasResults")
add("不能伪造呈现身份", "MaterializeCanvasResults", {**result, "nodeId": uid(1)}, False, "materializeCanvasResults")
add("必须选实际结果", "MaterializeCanvasResults", {**result, "mediaIds": []}, False, "materializeCanvasResults")

preference = {"mode": "canvas", "selectedShotId": None, "selectedNodeIds": [], "viewport": {"x": 0, "y": 0, "zoom": 0.45}, "assetPanelOpen": False, "assistantOpen": False}
add("个人视口独立保存", "SaveSceneWorkspacePreference", preference, operation="saveSceneWorkspacePreference")
add("首次偏好虚拟版本零", "SceneWorkspacePreference", {"sceneId": uid(801), "revision": 0, **preference})
add("视口缩放不可为零", "SaveSceneWorkspacePreference", {**preference, "viewport": {"x": 0, "y": 0, "zoom": 0}}, False, "saveSceneWorkspacePreference")
add("不是第三种业务模式", "SaveSceneWorkspacePreference", {**preference, "mode": "overview"}, False, "saveSceneWorkspacePreference")
add("模式切换不写采用", "SaveSceneWorkspacePreference", {**preference, "adoptedTakeId": uid(611)}, False, "saveSceneWorkspacePreference")

path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"total": len(payload["samples"]), "canvasSamples": sum(s["name"].startswith("画布契约：") for s in payload["samples"])}))
