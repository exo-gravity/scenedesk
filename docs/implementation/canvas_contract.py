"""Design-time canvas schemas/routes; no runtime storage or provider execution."""

def ref(name):
    return {"$ref": f"#/components/schemas/{name}"}

def obj(properties, required=()):
    return {"type": "object", "properties": properties, "required": list(required), "additionalProperties": False}

def enum(*values):
    return {"type": "string", "enum": list(values)}

def array(items, maximum, minimum=0):
    return {"type": "array", "items": items, "minItems": minimum, "maxItems": maximum}

ID = {"type": "string", "format": "uuid"}
POS = {"type": "integer", "minimum": 1, "maximum": 9007199254740991}
TEXT = {"type": "string", "maxLength": 20000}
NAME = {"type": "string", "minLength": 1, "maxLength": 160}
COORD = {"type": "number", "minimum": -1000000, "maximum": 1000000}
# Screen translation scales node coordinates; it is not a CanvasPoint.
VIEWPORT_COORD = {"type": "number", "minimum": -8000000, "maximum": 8000000}
BOOL = {"type": "boolean"}
HASH = {"type": "string", "pattern": "^[0-9a-f]{64}$"}

def schemas():
    s = {}
    s["CanvasPoint"] = obj({"x": COORD, "y": COORD}, ["x", "y"])
    s["CanvasUploadTarget"] = obj({"canvasId": ID, "clientRequestId": ID, "position": ref("CanvasPoint")}, ["canvasId", "clientRequestId", "position"])
    s["CanvasUpload"] = obj({"canvasId": ID, "nodeId": ID, "clientRequestId": ID, "createdBy": ID, "position": ref("CanvasPoint"), "declaration": ref("UploadInput"), "upload": ref("UploadIntent"), "placed": BOOL, "dismissed": BOOL}, ["canvasId", "nodeId", "clientRequestId", "createdBy", "position", "declaration", "upload", "placed", "dismissed"])
    s["CanvasUploadPage"] = obj({"items": array(ref("CanvasUpload"), 100)}, ["items"])
    s["CanvasTextContent"] = obj({"type": enum("text"), "text": TEXT}, ["type", "text"])
    s["CanvasMediaContent"] = obj({"type": enum("media"), "mediaId": ID, "assetRevisionId": ID}, ["type", "mediaId"])
    s["CanvasDraftContent"] = obj({"type": enum("draft"), "prompt": TEXT, "connectionId": ID, "capabilityId": ID, "output": ref("OutputOptions")}, ["type", "prompt", "output"])
    common = {"id": ID, "title": NAME, "position": ref("CanvasPoint"), "width": {"type": "number", "minimum": 120, "maximum": 1600}, "groupId": ID}
    s["CanvasNode"] = {"oneOf": [
        obj({**common, "kind": enum("text"), "content": ref("CanvasTextContent")}, ["id", "title", "position", "width", "kind", "content"]),
        obj({**common, "kind": enum("image", "video", "audio"), "content": {"oneOf": [ref("CanvasMediaContent"), ref("CanvasDraftContent")]}}, ["id", "title", "position", "width", "kind", "content"]),
    ]}
    s["CanvasReferenceEdge"] = obj({"id": ID, "sourceNodeId": ID, "targetNodeId": ID, "enabled": BOOL, "position": {"type": "integer", "minimum": 0, "maximum": 4999}, "purpose": enum("prompt", "identity", "look", "location", "action", "composition", "style", "voice", "start_frame", "end_frame", "prop"), "subjectAssetId": ID, "note": TEXT}, ["id", "sourceNodeId", "targetNodeId", "enabled", "position", "purpose"])
    s["CanvasGroup"] = obj({"id": ID, "title": NAME}, ["id", "title"])
    s["CanvasDocument"] = obj({"nodes": array(ref("CanvasNode"), 2000), "edges": array(ref("CanvasReferenceEdge"), 5000), "groups": array(ref("CanvasGroup"), 200)}, ["nodes", "edges", "groups"])
    s["SaveCanvas"] = obj({"schemaVersion": {"const": 1}, "document": ref("CanvasDocument")}, ["schemaVersion", "document"])
    s["Canvas"] = obj({"id": ID, "projectId": ID, "revision": POS, "schemaVersion": {"const": 1}, "document": ref("CanvasDocument"), "documentHash": HASH, "updatedAt": {"type": "string", "format": "date-time"}}, ["id", "projectId", "revision", "schemaVersion", "document", "documentHash", "updatedAt"])
    binding = {"id": ID, "nodeId": ID, "shotId": ID, "shotRevisionId": ID, "role": enum("reference", "candidate"), "takeId": ID, "nodeActive": BOOL}
    s["CanvasShotBinding"] = obj(binding, ["id", "nodeId", "shotId", "shotRevisionId", "role", "nodeActive"])
    s["CanvasShotBinding"]["allOf"] = [{"if": {"properties": {"role": {"const": "candidate"}}}, "then": {"required": ["takeId"]}, "else": {"not": {"required": ["takeId"]}}}]
    s["SceneCanvas"] = obj({"sceneId": ID, "canvas": ref("Canvas"), "bindings": array(ref("CanvasShotBinding"), 10000)}, ["sceneId", "canvas", "bindings"])
    s["BindCanvasNode"] = {"oneOf": [
        obj({"role": enum("reference"), "shotId": ID, "shotRevisionId": ID}, ["role", "shotId", "shotRevisionId"]),
        obj({"role": enum("candidate"), "shotId": ID, "shotRevisionId": ID, "range": ref("Range"), "sourceTakeId": ID}, ["role", "shotId", "shotRevisionId", "range"]),
    ]}
    s["PrepareCanvasGeneration"] = obj({"nodeId": ID, "shotSources": array(ref("ShotSource"), 100), "referenceOverrides": array(ref("ReferenceOverride"), 100), "promptPolicy": enum("append", "replace")}, ["nodeId", "shotSources", "referenceOverrides", "promptPolicy"])
    s["CanvasPlanOrigin"] = obj({"canvasId": ID, "nodeId": ID, "canvasRevision": POS, "inputFingerprint": HASH, "sourceNodeIds": array(ID, 2000)}, ["canvasId", "nodeId", "canvasRevision", "inputFingerprint", "sourceNodeIds"])
    s["CanvasPlanEntry"] = obj({"plan": ref("GenerationPlan"), "origin": ref("CanvasPlanOrigin"), "jobId": ID}, ["plan", "origin"])
    s["CanvasPlanEntryPage"] = obj({"items": array(ref("CanvasPlanEntry"), 100), "nextCursor": {"type": "string"}}, ["items"])
    s["MaterializeCanvasResults"] = obj({"jobId": ID, "mediaIds": {**array(ID, 100, 1), "uniqueItems": True}, "position": ref("CanvasPoint")}, ["jobId", "mediaIds", "position"])
    s["CanvasResultPlacement"] = obj({"canvas": ref("Canvas"), "placements": array(obj({"mediaId": ID, "nodeId": ID}, ["mediaId", "nodeId"]), 100, 1)}, ["canvas", "placements"])
    s["CanvasViewport"] = obj({"x": VIEWPORT_COORD, "y": VIEWPORT_COORD, "zoom": {"type": "number", "minimum": 0.00001, "maximum": 4}}, ["x", "y", "zoom"])
    preference = {"mode": enum("storyboard", "canvas"), "selectedShotId": {"anyOf": [ID, {"type": "null"}]}, "selectedNodeIds": {**array(ID, 2000), "uniqueItems": True}, "viewport": ref("CanvasViewport"), "assetPanelOpen": BOOL, "assistantOpen": BOOL}
    s["SaveSceneWorkspacePreference"] = obj(preference, list(preference))
    s["SceneWorkspacePreference"] = obj({"sceneId": ID, "revision": {"type": "integer", "minimum": 0, "maximum": 9007199254740991}, **preference}, ["sceneId", "revision", *preference])
    return s

def register_routes(route, paths):
    base = "/projects/{projectId}"
    scene = base + "/scenes/{sceneId}"
    canvas = base + "/canvases/{canvasId}"
    route("post", scene + "/canvas", "ensureSceneCanvas", "PR-16", "显式创建或取得本场唯一画布", "SceneCanvas", code=200)
    route("get", scene + "/canvas", "getSceneCanvas", "PR-16", "读取本场画布和镜头关联", "SceneCanvas")
    route("get", canvas, "getCanvas", "PR-16", "读取通用画布当前文档", "Canvas")
    route("get", canvas + "/revisions/{revisionNumber}", "getCanvasRevision", "PR-17", "按保存修订读取只读画布", "Canvas")
    route("put", canvas, "saveCanvas", "PR-17", "按版本保存画布，不改制作事实", "Canvas", "SaveCanvas", cas=True)
    route("get", canvas + "/uploads", "listCanvasUploads", "PR-16", "读取画布未放入且未移除的上传及固定落点", "CanvasUploadPage")
    route("get", canvas + "/uploads/{uploadId}", "getCanvasUpload", "PR-16", "核对上传与唯一呈现身份，移除后仍可查询", "CanvasUpload")
    route("get", canvas + "/uploads/by-request/{clientRequestId}", "getCanvasUploadRequest", "PR-16", "按本人固定请求身份找回已提交上传，不重建导入", "CanvasUpload")
    route("post", canvas + "/uploads/{uploadId}/dismiss", "dismissCanvasUpload", "PR-16", "移除待处理上传呈现，保留文件与导入事实", "CanvasUpload", code=200)
    route("post", scene + "/canvas/nodes/{nodeId}/shot-bindings", "bindSceneCanvasNode", "PR-16", "明确关联镜头参考或视频候选", "SceneCanvas", "BindCanvasNode", cas=True)
    route("delete", scene + "/canvas/nodes/{nodeId}/shot-bindings/{bindingId}", "unbindSceneCanvasNode", "PR-16", "移除关联，保留候选及采用", "SceneCanvas", cas=True)
    route("post", scene + "/canvas/generation-plans", "prepareCanvasGeneration", "PR-16", "固定画布草稿与明确镜头输入，只准备不执行", "CanvasPlanEntry", "PrepareCanvasGeneration", cas=True)
    route("get", canvas + "/generation-plans", "listCanvasPlans", "PR-16", "查询画布来源的计划与任务身份", "CanvasPlanEntryPage", listing=True)
    route("post", canvas + "/results", "materializeCanvasResults", "PR-16", "将已归档结果添加或恢复到画布", "CanvasResultPlacement", "MaterializeCanvasResults", cas=True)
    route("get", scene + "/workspace-preference", "getSceneWorkspacePreference", "PR-17", "读取本人偏好，无记录返回revision0默认值", "SceneWorkspacePreference")
    route("put", scene + "/workspace-preference", "saveSceneWorkspacePreference", "PR-17", "保存本人模式与视口，不改共同画布", "SceneWorkspacePreference", "SaveSceneWorkspacePreference", cas=True)
    names = {"getCanvas", "getCanvasRevision", "saveCanvas", "materializeCanvasResults", "ensureSceneCanvas", "getSceneCanvas", "bindSceneCanvasNode", "unbindSceneCanvasNode", "prepareCanvasGeneration", "listCanvasPlans", "getSceneWorkspacePreference", "saveSceneWorkspacePreference", "listCanvasUploads", "getCanvasUpload", "getCanvasUploadRequest", "dismissCanvasUpload"}
    for methods in paths.values():
        for operation in methods.values():
            name = operation["operationId"]
            if name not in names:
                continue
            if name == "getCanvasRevision":
                next(p for p in operation["parameters"] if p.get("name") == "revisionNumber")["schema"] = POS
            if name == "listCanvasPlans":
                operation["parameters"].append({"name": "nodeId", "in": "query", "schema": ID})
                operation["parameters"] = [p for p in operation["parameters"] if not (p.get("in") == "query" and p.get("name") == "projectId")]
            if name == "saveSceneWorkspacePreference":
                operation["parameters"] = [p for p in operation["parameters"] if p.get("$ref") != "#/components/parameters/IfMatch"]
                operation["parameters"].append({"name": "If-Match", "in": "header", "required": True, "schema": {"type": "string", "pattern": '^"(0|[1-9][0-9]*)"$'}, "description": "用户场次偏好版本，首次创建使用0；不使用canvas版本。"})
            operation["responses"]["413"] = {"$ref": "#/components/responses/Problem"}
            if name in {"getCanvas", "getCanvasRevision", "saveCanvas", "getSceneWorkspacePreference", "saveSceneWorkspacePreference"}:
                operation["responses"]["200"]["headers"] = {"ETag": {"schema": {"type": "string"}, "description": "当前返回对象revision的带引号字符串。"}}
