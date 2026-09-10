"""Design-time editing recovery and presence contract. No runtime implementation."""
from copy import deepcopy
from canvas_contract import ref, obj, enum, array, ID, POS, BOOL, HASH, TEXT

REV = {"type": "integer", "minimum": 0, "maximum": 9007199254740991}
TIME = {"type": "string", "format": "date-time"}


def extend_schemas(s):
    s["WorkMediaClip"] = deepcopy(s["MediaClip"])
    s["WorkSubtitleClip"] = deepcopy(s["SubtitleClip"])
    s["WorkSubtitleClip"]["properties"]["text"]["minLength"] = 0
    s["WorkSubtitleClip"]["properties"]["durationUs"] = REV
    s["WorkTrack"] = {"oneOf": [obj({
        "id": ID, "kind": enum(kind), "muted": BOOL,
        "items": array({"allOf": [ref(clip), {"properties": {"kind": {"const": kind}}}]}, 5000),
    }, ["id", "kind", "muted", "items"])
        for kind, clip in [("video", "WorkMediaClip"), ("audio", "WorkMediaClip"), ("subtitle", "WorkSubtitleClip")]]}
    s["WorkTimeline"] = deepcopy(s["Timeline"])
    s["WorkTimeline"]["properties"]["tracks"] = array(ref("WorkTrack"), 32)
    s["UnresolvedEdit"] = obj({
        "id": ID, "kind": enum("sound_placement", "subtitle_placement", "replacement", "dialogue_binding"),
        "clipIds": {**array(ID, 5000), "uniqueItems": True}, "note": TEXT,
    }, ["id", "kind", "clipIds", "note"])
    s["WorkTimingOrigin"] = obj({"clipId": ID, "normalizationId": ID}, ["clipId", "normalizationId"])
    s["CutWorkDocument"] = obj({
        "timeline": ref("WorkTimeline"), "dramaBindings": array(ref("DialogueBinding"), 5000),
        "unresolvedEdits": array(ref("UnresolvedEdit"), 500), "timingOrigins": array(ref("WorkTimingOrigin"), 5000),
    }, ["timeline", "dramaBindings", "unresolvedEdits", "timingOrigins"])
    s["EditingIssue"] = obj({
        "code": enum("MAIN_VIDEO_REQUIRED", "TIMELINE_GAP", "TIMELINE_OVERLAP", "SOURCE_RANGE_INVALID",
                     "EMPTY_CLIP", "SUBTITLE_OUT_OF_BOUNDS", "AUDIO_OUT_OF_BOUNDS", "BINDING_UNRESOLVED",
                     "UNRESOLVED_EDIT", "CUT_BASE_CHANGED", "MEDIA_UNAVAILABLE", "DUPLICATE_DIALOGUE_SOURCES"),
        "clipIds": {**array(ID, 5000), "uniqueItems": True}, "message": TEXT,
    }, ["code", "clipIds", "message"])
    s["SaveCutWorkDraft"] = obj({"baseCutRevision": POS, "document": ref("CutWorkDocument")},
                                 ["baseCutRevision", "document"])
    props = {"cutId": ID, "revision": REV, "baseCutRevision": POS, "currentCutRevision": POS,
             "document": ref("CutWorkDocument"), "documentHash": HASH, "updatedAt": TIME, "updatedBy": ID,
             "issues": array(ref("EditingIssue"), 10000), "baseChanged": BOOL, "hasUnappliedChanges": BOOL}
    s["CutWorkDraft"] = obj(props, [k for k in props if k not in {"updatedAt", "updatedBy"}])
    s["CutWorkDraft"]["allOf"] = [{
        "if": {"properties": {"revision": {"const": 0}}, "required": ["revision"]},
        "then": {"not": {"anyOf": [{"required": ["updatedAt"]}, {"required": ["updatedBy"]}]}},
        "else": {"required": ["updatedAt", "updatedBy"]},
    }]
    s["WorkDraftSource"] = obj({"revision": POS, "documentHash": HASH}, ["revision", "documentHash"])
    s["NormalizationInput"] = obj({"cutId": ID, "baseCutRevision": POS, "workDraftRevision": POS},
                                    ["cutId", "baseCutRevision", "workDraftRevision"])
    s["NormalizationResult"]["properties"]["workDraftSource"] = ref("WorkDraftSource")
    s["NormalizationResult"]["required"].append("workDraftSource")
    s["CutReplacementInput"]["properties"]["workDraftRevision"] = POS
    s["CutReplacementInput"]["required"].append("workDraftRevision")
    s["FreezeCut"]["properties"].update({"expectedWorkDraftRevision": REV, "excludeUnappliedWorkDraft": BOOL})
    s["FreezeCut"]["required"].append("expectedWorkDraftRevision")
    s["CutRevision"]["properties"].update({"observedWorkDraftRevision": REV, "excludedWorkDraftRevision": POS})
    s["CutRevision"]["allOf"].append({
        "if": {"properties": {"origin": {"const": "platform"}}, "required": ["origin"]},
        "then": {"required": ["observedWorkDraftRevision"]},
        "else": {"not": {"anyOf": [{"required": ["observedWorkDraftRevision"]}, {"required": ["excludedWorkDraftRevision"]}]}},
    })
    s["EditingHistoryEntry"] = obj({
        "revision": POS, "documentHash": HASH, "updatedAt": TIME, "updatedBy": ID,
        "retainedFor": {**array(enum("current", "previous", "recent", "checkpoint", "pinned"), 5, 1), "uniqueItems": True},
    }, ["revision", "documentHash", "updatedAt", "updatedBy", "retainedFor"])
    s["EditingHistoryPolicy"] = obj({
        "recentHours": POS, "recentMaxRevisions": POS, "checkpointMinutes": POS,
        "checkpointDays": POS, "dailyDays": POS, "uncompressedByteBudget": POS,
    }, ["recentHours", "recentMaxRevisions", "checkpointMinutes", "checkpointDays", "dailyDays", "uncompressedByteBudget"])
    s["EditingHistoryPage"] = obj({"items": array(ref("EditingHistoryEntry"), 100), "latestRevision": REV,
                                     "policy": ref("EditingHistoryPolicy"), "nextCursor": {"type": "string"}},
                                    ["items", "latestRevision", "policy"])
    s["EditingTarget"] = obj({"kind": enum("canvas", "cut_work_draft"), "objectId": ID}, ["kind", "objectId"])
    s["UpdateEditingPresence"] = obj({"target": ref("EditingTarget"), "clientSessionId": ID,
                                         "activity": enum("viewing", "editing")}, ["target", "clientSessionId", "activity"])
    s["EditingPresenceEntry"] = obj({"membershipId": ID, "clientSessionId": ID,
                                        "activity": enum("viewing", "editing"), "lastSeenAt": TIME, "expiresAt": TIME},
                                       ["membershipId", "clientSessionId", "activity", "lastSeenAt", "expiresAt"])
    s["EditingPresence"] = obj({"target": ref("EditingTarget"), "entries": array(ref("EditingPresenceEntry"), 500),
                                   "serverTime": TIME}, ["target", "entries", "serverTime"])
    s["UsageLocation"]["properties"]["kind"]["enum"] += ["cut_work_draft", "editing_history"]


def register_routes(route, paths):
    base = "/projects/{projectId}"
    work = base + "/cuts/{cutId}/work-draft"
    route("get", work, "getCutWorkDraft", "PR-10", "读取共享编辑工作稿，无记录返回虚拟revision0", "CutWorkDraft")
    route("put", work, "saveCutWorkDraft", "PR-12", "保存未完成编辑，不归一、不更新可渲染Cut", "CutWorkDraft", "SaveCutWorkDraft", cas=True)
    route("get", work + "/revisions", "listCutWorkDraftHistory", "PR-12", "列出实际保留的工作稿恢复点", "EditingHistoryPage", listing=True)
    route("get", work + "/revisions/{revisionNumber}", "getCutWorkDraftRevision", "PR-12", "读取仍保留的工作稿修订", "CutWorkDraft")
    route("get", base + "/canvases/{canvasId}/revisions", "listCanvasHistory", "PR-17", "列出实际保留的画布恢复点", "EditingHistoryPage", listing=True)
    route("get", base + "/editing-presence", "getEditingPresence", "PR-17", "读取目标的编辑者提示，不构成锁", "EditingPresence")
    route("put", base + "/editing-presence", "updateEditingPresence", "PR-17", "更新本人客户端活动提示，不修改内容版本", "EditingPresence", "UpdateEditingPresence")
    for methods in paths.values():
        for op in methods.values():
            name = op["operationId"]
            if name == "saveCutWorkDraft":
                op["parameters"] = [p for p in op["parameters"] if p.get("$ref") != "#/components/parameters/IfMatch"]
                op["parameters"].append({"name": "If-Match", "in": "header", "required": True,
                                         "schema": {"type": "string", "pattern": '^"(0|[1-9][0-9]*)"$'},
                                         "description": "工作稿自己的版本；首次创建为0，不是Cut版本。"})
            if name == "getCutWorkDraftRevision":
                next(p for p in op["parameters"] if p.get("name") == "revisionNumber")["schema"] = POS
            if name in {"listCutWorkDraftHistory", "listCanvasHistory"}:
                op["parameters"] = [p for p in op["parameters"] if not (p.get("in") == "query" and p.get("name") in {"q", "projectId"})]
            if name == "getEditingPresence":
                op["parameters"] += [{"name": "kind", "in": "query", "required": True, "schema": enum("canvas", "cut_work_draft")},
                                     {"name": "objectId", "in": "query", "required": True, "schema": ID}]
            if name in {"getCanvasRevision", "getCutWorkDraftRevision", "getCutNormalization"}:
                op["responses"]["410"] = {"$ref": "#/components/responses/Problem"}
            if name in {"getCutWorkDraft", "saveCutWorkDraft", "getCutWorkDraftRevision"}:
                op["responses"]["200"]["headers"] = {"ETag": {"schema": {"type": "string"}, "description": "工作稿revision，仅用于写CAS；读取诊断重新计算。"}}
            if name == "saveCutWorkDraft":
                op["responses"]["413"] = {"$ref": "#/components/responses/Problem"}
            if name in {"normalizeCutDraft", "previewCutReplacement", "saveCutDraft", "freezeCut", "saveCutWorkDraft"}:
                op["description"] += " 工作稿来源、双版本检查及恢复按21-technical-baseline-closure.md执行。"
