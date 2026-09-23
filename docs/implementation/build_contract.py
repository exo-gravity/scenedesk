"""Build the design-time OpenAPI contract and operation catalog. No service calls."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
S = {}
def ref(name): return {"$ref": f"#/components/schemas/{name}"}
def string(**kw): return {"type": "string", **kw}
def enum(*values): return string(enum=list(values))
def arr(items, **kw): return {"type": "array", "items": items, **kw}
def obj(properties, required=(), **kw):
    return {"type": "object", "properties": properties, "required": list(required), "additionalProperties": False, **kw}
def schema(name, properties, required=()):
    S[name] = obj(properties, required)
    return ref(name)
ID = string(format="uuid")
TEXT = string(maxLength=20000)
NAME = string(minLength=1, maxLength=160)
INT = {"type": "integer", "minimum": 0, "maximum": 9007199254740991}
POS = {"type": "integer", "minimum": 1, "maximum": 9007199254740991}
BOOL = {"type": "boolean"}
TIME = string(format="date-time")
US = INT
def entity(name, properties, required=()):
    return schema(name, {"id": ID, "revision": POS, "createdAt": TIME, "updatedAt": TIME, **properties}, ["id", "revision", *required])
def page(name):
    key = name + "Page"
    if key not in S: schema(key, {"items": arr(ref(name)), "nextCursor": string()}, ["items"])
    return key

schema("Error", {"code": string(), "message": string(), "requestId": string(), "details": {"type": "object", "additionalProperties": True}}, ["code", "message", "requestId"])
schema("Money", {"currency": string(pattern="^[A-Z]{3}$"), "amountMicros": string(pattern="^-?[0-9]+$")}, ["currency", "amountMicros"])
schema("Range", {"inUs": US, "outUs": US}, ["inUs", "outUs"])
schema("Spec", {"width": POS, "height": POS, "fpsNum": POS, "fpsDen": POS, "language": string(), "qualityReferenceMediaIds": arr(ID), "deliveryNotes": TEXT}, ["width", "height", "fpsNum", "fpsDen", "language"])
schema("Reference", {"mediaId": ID, "assetRevisionId": ID, "purpose": enum("identity", "look", "location", "action", "composition", "style", "voice", "start_frame", "end_frame"), "note": TEXT}, ["mediaId", "purpose"])
schema("Dialogue", {"id": ID, "characterAssetId": ID, "text": TEXT, "performance": TEXT}, ["id", "text"])
schema("SceneState", {"characterAssetId": ID, "lookId": ID, "lookAssetRevisionId": ID, "emotion": TEXT, "propAssetIds": arr(ID), "note": TEXT}, ["characterAssetId"])
schema("ShotSpec", {"intent": TEXT, "action": TEXT, "dialogue": arr(ref("Dialogue")), "plannedDurationUs": US, "camera": TEXT, "references": arr(ref("Reference")), "notes": TEXT}, ["intent", "references"])
entity("Session", {"userId": ID, "email": string(format="email"), "displayName": NAME, "csrfToken": string()}, ["userId", "email", "csrfToken"])
entity("Tenant", {"name": NAME, "ownerUserId": ID, "currency": string(pattern="^[A-Z]{3}$"), "status": enum("active", "suspended")}, ["name", "ownerUserId", "currency", "status"])
schema("CreateTenant", {"name": NAME, "currency": string(pattern="^[A-Z]{3}$")}, ["name", "currency"])
schema("Rename", {"name": NAME}, ["name"])
entity("Membership", {"userId": ID, "email": string(format="email"), "role": enum("owner", "admin", "member"), "status": enum("active", "suspended")}, ["userId", "role", "status"])
schema("MembershipChange", {"role": enum("admin", "member"), "status": enum("active", "suspended")}, ["role", "status"])
schema("OwnerTransfer", {"membershipId": ID}, ["membershipId"])
entity("Invitation", {"email": string(format="email"), "role": enum("admin", "member"), "status": enum("pending", "accepted", "revoked", "expired"), "expiresAt": TIME, "invitationUrl": string(format="uri")}, ["email", "role", "status", "expiresAt"])
schema("Invite", {"email": string(format="email"), "role": enum("admin", "member")}, ["email", "role"])
schema("AcceptInvite", {"token": string(minLength=20, maxLength=512)}, ["token"])
entity("Project", {"tenantId": ID, "name": NAME, "kind": enum("drama"), "leadMembershipId": ID, "status": enum("active", "archived"), "spec": ref("Spec")}, ["tenantId", "name", "kind", "leadMembershipId", "status", "spec"])
schema("CreateProject", {"name": NAME, "leadMembershipId": ID, "spec": ref("Spec"), "creationRequestId": {**ID, "description": "可选的持久创建身份。新客户端发送固定 UUID；同租户及原用户以相同正文恢复时返回同一项目的当前表示，不受通用 HTTP 回执过期影响。"}}, ["name", "leadMembershipId", "spec"])
schema("ProjectChange", {"name": NAME, "spec": ref("Spec")}, ["name", "spec"])
schema("LeadChange", {"membershipId": ID}, ["membershipId"])
schema("ProjectMemberChange", {"membershipId": ID}, ["membershipId"])
entity("ProjectMember", {"membershipId": ID, "role": enum("lead", "collaborator")}, ["membershipId", "role"])
entity("Production", {"projectId": ID, "title": NAME, "brief": TEXT, "defaultAssetRevisionIds": arr(ID)}, ["projectId", "title", "brief", "defaultAssetRevisionIds"])
schema("ProductionChange", {"title": NAME, "brief": TEXT, "defaultAssetRevisionIds": arr(ID)}, ["title", "brief", "defaultAssetRevisionIds"])
entity("ScriptRevision", {"projectId": ID, "number": POS, "text": string(maxLength=500000), "parentRevisionId": ID}, ["projectId", "number", "text"])
schema("ScriptDocumentBlock", {"kind": enum("paragraph", "heading", "table", "image"), "text": string(maxLength=500000), "level": {"type":"integer", "minimum":1, "maximum":6}, "rows": arr(arr(string(maxLength=500000))), "imageData": string(maxLength=1400000), "alt": string(maxLength=1000)}, ["kind", "text"])
schema("ScriptDocument", {"format": enum("docx_v1"), "blocks": arr(ref("ScriptDocumentBlock"), maxItems=10000), "warnings": arr(string(maxLength=500), maxItems=100)}, ["format", "blocks", "warnings"])
schema("ScriptDocumentFile", {"fileName": string(minLength=1, maxLength=160), "data": string(minLength=4, maxLength=5592408, pattern="^[A-Za-z0-9+/]+={0,2}$")}, ["fileName", "data"])
schema("ScriptDocumentPreview", {"fileName": NAME, "sha256": string(pattern="^[0-9a-f]{64}$"), "bytes": POS, "text": string(maxLength=500000), "document": ref("ScriptDocument")}, ["fileName", "sha256", "bytes", "text", "document"])
schema("ScriptDocumentImport", {"fileName": NAME, "data": S["ScriptDocumentFile"]["properties"]["data"], "previewSha256": string(pattern="^[0-9a-f]{64}$"), "importRequestId": ID}, ["fileName", "data", "previewSha256", "importRequestId"])
schema("ScriptImportReceipt", {"found": BOOL, "baseVersion": POS, "script": ref("ScriptRevision")}, ["found"])
schema("ScriptDocumentOriginal", {"fileName": NAME, "data": string(), "sha256": string()}, ["fileName", "data", "sha256"])
S["ScriptRevision"]["properties"].update({"sourceFormat": enum("plain_text", "docx"), "fileName": NAME, "sha256": string(), "document": ref("ScriptDocument")})
schema("FeishuScriptSource", {"provider":enum("feishu"), "previewId":ID, "sourceUrl":string(maxLength=2048), "sourceKind":enum("docx","wiki"), "documentId":string(maxLength=128), "title":string(maxLength=1024), "observedRevision":POS, "fetchedAt":{"type":"string","format":"date-time"}, "permissionCheckedAt":{"type":"string","format":"date-time"}, "accessMode":enum("team_application")}, ["provider","previewId","sourceUrl","sourceKind","documentId","title","observedRevision","fetchedAt","permissionCheckedAt","accessMode"])
S["ScriptRevision"]["properties"]["source"] = ref("FeishuScriptSource")
schema("FeishuImportAvailability", {"configured":BOOL,"projectBound":BOOL,"message":string(maxLength=500)}, ["configured","projectBound","message"])
schema("FeishuImportCreate", {"requestId":ID,"sourceUrl":string(minLength=1,maxLength=2048)}, ["requestId","sourceUrl"])
schema("FeishuImportState", {"id":ID,"state":enum("pending","creating","exporting","ready","failed","unknown","expired"),"sourceUrl":string(maxLength=2048),"createdAt":{"type":"string","format":"date-time"},"expiresAt":{"type":"string","format":"date-time"},"nextPollAt":{"type":"string","format":"date-time"},"errorCode":string(maxLength=100),"errorMessage":string(maxLength=500),"preview":ref("ScriptDocumentPreview"),"title":string(maxLength=1024),"fetchedAt":{"type":"string","format":"date-time"},"observedRevision":POS}, ["id","state","sourceUrl","createdAt","expiresAt","nextPollAt"])
schema("FeishuImportAdvance", {}, [])
schema("FeishuImportConfirm", {"importRequestId":ID,"previewSha256":string(pattern="^[0-9a-f]{64}$")}, ["importRequestId","previewSha256"])
schema("ScriptInput", {"text": string(minLength=1, maxLength=500000), "parentRevisionId": ID}, ["text"])
entity("Episode", {"projectId": ID, "title": NAME, "position": INT, "status": enum("active", "archived")}, ["projectId", "title", "position", "status"])
schema("EpisodeInput", {"title": NAME, "position": INT, "status": enum("active", "archived")}, ["title", "position", "status"])
entity("Scene", {"projectId": ID, "episodeId": ID, "title": NAME, "position": INT, "timeLabel": NAME, "locationLabel": NAME, "summary": TEXT, "state": arr(ref("SceneState")), "defaultAssetRevisionIds": arr(ID), "status": enum("active", "archived")}, ["projectId", "episodeId", "title", "position", "summary", "state", "status"])
schema("SceneInput", {"episodeId": ID, "title": NAME, "position": INT, "timeLabel": NAME, "locationLabel": NAME, "summary": TEXT, "state": arr(ref("SceneState")), "defaultAssetRevisionIds": arr(ID), "status": enum("active", "archived")}, ["episodeId", "title", "position", "summary", "state", "status"])
entity("Shot", {"projectId": ID, "sceneId": ID, "label": NAME, "position": INT, "specRevisionId": ID, "spec": ref("ShotSpec"), "status": enum("active", "archived"), "currentTakeId": ID}, ["projectId", "sceneId", "label", "position", "specRevisionId", "spec", "status"])
entity("ShotRevision", {"projectId": ID, "shotId": ID, "number": POS, "spec": ref("ShotSpec"), "sourceScriptRevisionId": ID}, ["projectId", "shotId", "number", "spec"])
schema("ShotInput", {"sceneId": ID, "label": NAME, "position": INT, "spec": ref("ShotSpec"), "status": enum("active", "archived")}, ["sceneId", "label", "position", "spec", "status"])
schema("Reorder", {"kind": enum("episode", "scene", "shot"), "parentId": ID, "orderedIds": arr(ID, minItems=1, uniqueItems=True)}, ["kind", "parentId", "orderedIds"])
entity("ContentTree", {"projectId": ID, "currentScriptRevisionId": ID, "episodes": arr(ref("Episode")), "scenes": arr(ref("Scene")), "shots": arr(ref("Shot"))}, ["projectId", "episodes", "scenes", "shots"])
schema("ProposalOperation", {"opId": ID, "action": enum("create", "update", "archive"), "kind": enum("episode", "scene", "shot", "asset_suggestion"), "existingId": ID, "temporaryId": ID, "summary": TEXT, "proposed": {"oneOf": [ref("EpisodeInput"), ref("SceneInput"), ref("ShotInput"), ref("AssetInput")]}}, ["opId", "action", "kind", "summary"])
entity("Proposal", {"projectId": ID, "sourceScriptRevisionId": ID, "baseContentRevision": POS, "status": enum("proposed", "applied", "rejected"), "operations": arr(ref("ProposalOperation"))}, ["projectId", "sourceScriptRevisionId", "baseContentRevision", "status", "operations"])
schema("ApplyProposal", {"selectedOperationIds": arr(ID, minItems=1, uniqueItems=True)}, ["selectedOperationIds"])

SCOPE = enum("project", "shared")
scope_fields = {"scope": SCOPE, "projectId": ID}
entity("Asset", {**scope_fields, "kind": enum("character", "location", "prop", "voice", "style"), "name": NAME, "description": TEXT, "tags": arr(NAME), "status": enum("active", "archived"), "currentRevisionId": ID}, ["scope", "kind", "name", "status"])
schema("AssetInput", {**scope_fields, "kind": enum("character", "location", "prop", "voice", "style"), "name": NAME, "description": TEXT, "tags": arr(NAME)}, ["scope", "kind", "name"])
schema("AssetMetadataChange", {"name": NAME, "description": TEXT, "tags": arr(NAME)}, ["name", "description", "tags"])
schema("CharacterLookDefinition", {"id": ID, "revision": POS, "label": NAME, "references": arr(ref("Reference")), "voiceAssetRevisionId": ID}, ["id", "revision", "label", "references"])
schema("AssetDefinition", {"description": TEXT, "looks": arr(ref("CharacterLookDefinition")), "voiceDescription": TEXT, "references": arr(ref("Reference"))}, ["description", "references"])
entity("AssetRevision", {"assetId": ID, "number": POS, "definition": ref("AssetDefinition"), "status": enum("draft", "confirmed"), "parentRevisionId": ID}, ["assetId", "number", "definition", "status"])
schema("AssetRevisionInput", {"definition": ref("AssetDefinition"), "parentRevisionId": ID}, ["definition"])
schema("PublishAsset", {"assetRevisionId": ID, "name": NAME}, ["assetRevisionId", "name"])
schema("SharedImportInput", {"assetRevisionId": ID}, ["assetRevisionId"])
entity("SharedImport", {"projectId": ID, "assetRevisionId": ID}, ["projectId", "assetRevisionId"])
schema("UsageLocation", {"kind": enum("production", "scene", "shot_revision", "plan", "cut_draft", "cut_revision", "asset_revision"), "objectId": ID, "projectId": ID, "shotId": ID, "sceneId": ID, "label": NAME}, ["kind", "objectId", "label"])
entity("Media", {**scope_fields, "kind": enum("image", "video", "audio", "document"), "status": enum("processing", "ready", "rejected", "archived"), "sha256": string(pattern="^[0-9a-f]{64}$"), "bytes": INT, "mime": string(), "durationUs": US, "width": POS, "height": POS, "fpsNum": POS, "fpsDen": POS, "hasAudio": BOOL, "sourceJobId": ID, "sourceUploadId": ID, "sourceRenderTaskId": ID}, ["scope", "kind", "status", "mime"])
schema("UploadInput", {**scope_fields, "fileName": NAME, "bytes": POS, "mime": string(), "sha256": string(pattern="^[0-9a-f]{64}$")}, ["scope", "fileName", "bytes", "mime", "sha256"])
entity("UploadIntent", {"status": enum("pending", "uploaded", "verifying", "accepted", "rejected", "expired"), "expiresAt": TIME, "uploadUrl": string(format="uri"), "method": enum("PUT", "POST"), "headers": {"type": "object", "additionalProperties": string()}, "formFields": {"type": "object", "additionalProperties": string()}, "mediaId": ID}, ["status", "expiresAt"])
schema("UploadComplete", {"sha256": string(pattern="^[0-9a-f]{64}$"), "bytes": POS}, ["sha256", "bytes"])
schema("AccessRequest", {"disposition": enum("inline", "attachment")}, ["disposition"])
schema("AccessGrant", {"url": string(format="uri"), "expiresAt": TIME}, ["url", "expiresAt"])
entity("Connection", {"name": NAME, "provider": NAME, "region": NAME, "status": enum("draft", "enabled", "disabled"), "currency": string(pattern="^[A-Z]{3}$"), "capabilityRevision": POS}, ["name", "provider", "region", "status", "currency", "capabilityRevision"])
schema("ConnectionInput", {"name": NAME, "provider": NAME, "region": NAME, "credential": string(minLength=1, writeOnly=True), "currency": string(pattern="^[A-Z]{3}$")}, ["name", "provider", "region", "credential", "currency"])
schema("ConnectionChange", {"name": NAME, "status": enum("draft", "enabled", "disabled"), "credential": string(minLength=1, writeOnly=True)}, ["name", "status"])
schema("CapabilityInputRule", {"kind": enum("image", "video", "audio"), "purposes": arr(string()), "minCount": INT, "maxCount": INT, "maxBytes": POS, "mimeTypes": arr(string()), "maxDurationUs": US, "minWidth": POS, "maxWidth": POS, "minHeight": POS, "maxHeight": POS}, ["kind", "purposes", "minCount", "maxCount", "maxBytes", "mimeTypes"])
entity("Capability", {"connectionId": ID, "purpose": enum("video", "image", "audio", "script_analysis"), "modelVersion": NAME, "mode": NAME, "enabled": BOOL, "verifiedAt": TIME, "inputRules": arr(ref("CapabilityInputRule")), "supportedPurposes": arr(enum("identity", "look", "location", "action", "composition", "style", "voice", "start_frame", "end_frame")), "allowedAspectRatios": arr(string()), "allowedResolutions": arr(string()), "minDurationSeconds": INT, "maxDurationSeconds": INT, "maxReferences": INT, "audioOutput": BOOL, "cancelSupported": BOOL, "recoverySupported": BOOL, "notes": TEXT}, ["connectionId", "purpose", "modelVersion", "mode", "enabled", "supportedPurposes"])
schema("OutputOptions", {"aspectRatio": string(), "durationSeconds": POS, "resolution": string(), "withAudio": BOOL, "seed": INT}, [])
schema("ShotSource", {"shotId": ID, "shotRevisionId": ID}, ["shotId", "shotRevisionId"])
schema("PlanInput", {**scope_fields, "connectionId": ID, "capabilityId": ID, "purpose": enum("video", "image", "audio", "script_analysis"), "prompt": TEXT, "references": arr(ref("Reference")), "shotSources": arr(ref("ShotSource")), "sourceScriptRevisionId": ID, "output": ref("OutputOptions")}, ["scope", "connectionId", "capabilityId", "purpose", "prompt", "references", "output"])
entity("GenerationPlan", {"input": ref("PlanInput"), "capabilityRevision": POS, "inputHash": string(), "estimate": ref("Money"), "expiresAt": TIME, "status": enum("ready", "blocked", "consumed", "expired"), "blockingReasons": arr(string()), "resolvedPrompt": TEXT}, ["input", "capabilityRevision", "inputHash", "expiresAt", "status", "blockingReasons", "resolvedPrompt"])
schema("ExecutePlan", {"planId": ID}, ["planId"])
JOB_STATES = ["queued", "dispatching", "submission_unknown", "provider_pending", "provider_running", "archiving", "archive_failed", "succeeded", "failed", "cancel_requested", "cancelled", "reconciliation_required"]
entity("GenerationJob", {**scope_fields, "planId": ID, "status": enum(*JOB_STATES), "providerJobId": string(), "mediaIds": arr(ID), "proposalId": ID, "errorCode": string(), "reservationStatus": enum("held", "settled", "released"), "estimatedCost": ref("Money"), "actualCost": ref("Money"), "inputOutdated": BOOL}, ["scope", "planId", "status", "mediaIds", "reservationStatus", "inputOutdated"])
entity("Take", {"projectId": ID, "shotId": ID, "shotRevisionId": ID, "mediaId": ID, "range": ref("Range"), "sourceTakeId": ID, "note": TEXT, "createdBy": ID}, ["projectId", "shotId", "shotRevisionId", "mediaId", "range", "createdBy"])
schema("TakeInput", {"shotId": ID, "shotRevisionId": ID, "mediaId": ID, "range": ref("Range"), "sourceTakeId": ID, "note": TEXT}, ["shotId", "shotRevisionId", "mediaId", "range"])
schema("SelectionInput", {"takeId": ID, "reason": TEXT}, ["takeId"])
entity("Selection", {"projectId": ID, "shotId": ID, "number": POS, "takeId": ID, "selectedBy": ID, "reason": TEXT, "supersedesSelectionId": ID, "affectedCutIds": arr(ID)}, ["projectId", "shotId", "number", "selectedBy", "affectedCutIds"])
schema("SelectionState", {"shotId": ID, "revision": POS, "currentSelection": ref("Selection")}, ["shotId", "revision"])

schema("MediaClip", {"id": ID, "kind": enum("video", "audio"), "mediaId": ID, "takeId": ID, "selectionId": ID, "timelineStartUs": US, "range": ref("Range"), "gainDb": {"type": "number", "minimum": -96, "maximum": 12}, "muted": BOOL, "fit": enum("contain", "cover")}, ["id", "kind", "mediaId", "timelineStartUs", "range", "gainDb", "muted"])
schema("SubtitleClip", {"id": ID, "kind": enum("subtitle"), "timelineStartUs": US, "durationUs": POS, "text": string(minLength=1, maxLength=2000)}, ["id", "kind", "timelineStartUs", "durationUs", "text"])
schema("Track", {"id": ID, "kind": enum("video", "audio", "subtitle"), "items": arr({"oneOf": [ref("MediaClip"), ref("SubtitleClip")]}), "muted": BOOL}, ["id", "kind", "items", "muted"])
schema("Timeline", {"schemaVersion": enum("1"), "spec": ref("Spec"), "tracks": arr(ref("Track"), minItems=1), "burnSubtitles": BOOL}, ["schemaVersion", "spec", "tracks", "burnSubtitles"])
entity("Cut", {"projectId": ID, "episodeId": ID, "sceneId": ID, "name": NAME, "timeline": ref("Timeline"), "status": enum("active", "archived")}, ["projectId", "name", "timeline", "status"])
schema("CutInput", {"name": NAME, "episodeId": ID, "sceneId": ID, "timeline": ref("Timeline")}, ["name", "timeline"])
schema("CutDraftInput", {"timeline": ref("Timeline")}, ["timeline"])
schema("FreezeCut", {"label": NAME}, ["label"])
entity("CutRevision", {"projectId": ID, "cutId": ID, "number": POS, "label": NAME, "origin": enum("platform", "external"), "status": enum("frozen", "rendering", "ready", "render_failed"), "timeline": ref("Timeline"), "mediaId": ID, "handoffDeliveryId": ID}, ["projectId", "cutId", "number", "origin", "status", "label"])
schema("ExternalCutInput", {"name": NAME, "episodeId": ID, "mediaId": ID, "handoffDeliveryId": ID}, ["name", "episodeId", "mediaId"])
S["ReviewSubject"] = obj({"takeId": ID, "cutRevisionId": ID}, oneOf=[{"required": ["takeId"]}, {"required": ["cutRevisionId"]}])
schema("ReviewInput", {"subject": ref("ReviewSubject")}, ["subject"])
entity("Review", {"projectId": ID, "subject": ref("ReviewSubject"), "number": POS, "status": enum("open", "approved", "changes_requested"), "decisionNote": TEXT, "decidedBy": ID, "decidedAt": TIME}, ["projectId", "subject", "number", "status"])
schema("CommentInput", {"body": string(minLength=1, maxLength=5000), "startUs": US, "endUs": US, "parentCommentId": ID}, ["body"])
entity("Comment", {"reviewId": ID, "authorId": ID, "body": TEXT, "startUs": US, "endUs": US, "parentCommentId": ID, "resolved": BOOL}, ["reviewId", "authorId", "body", "resolved"])
schema("CommentChange", {"body": string(minLength=1, maxLength=5000), "resolved": BOOL}, [])
S["CommentChange"]["minProperties"] = 1
schema("DecisionInput", {"decision": enum("approved", "changes_requested"), "note": TEXT}, ["decision"])
schema("DeliveryInput", {"cutRevisionId": ID, "reviewId": ID, "kind": enum("working", "final"), "includeMedia": BOOL, "includeSrt": BOOL}, ["cutRevisionId", "kind", "includeMedia", "includeSrt"])
schema("ManifestFile", {"mediaId": ID, "fileName": NAME, "sha256": string(pattern="^[0-9a-f]{64}$"), "bytes": INT, "role": enum("final", "source", "subtitle")}, ["fileName", "sha256", "bytes", "role"])
schema("DeliveryManifest", {"schemaVersion": enum("1"), "projectId": ID, "cutRevisionId": ID, "reviewId": ID, "origin": enum("platform", "external"), "files": arr(ref("ManifestFile")), "externalTimelineKnown": BOOL, "outputSpec": ref("Spec"), "timeline": ref("Timeline"), "approvedBy": ID, "approvedAt": TIME}, ["schemaVersion", "projectId", "cutRevisionId", "origin", "files", "externalTimelineKnown", "outputSpec"])
entity("Delivery", {"projectId": ID, "cutRevisionId": ID, "kind": enum("working", "final"), "status": enum("preparing", "ready", "failed"), "manifest": ref("DeliveryManifest"), "packageSha256": string(pattern="^[0-9a-f]{64}$"), "packageBytes": POS}, ["projectId", "cutRevisionId", "kind", "status"])
entity("Task", {"projectId": ID, "title": NAME, "assigneeMembershipId": ID, "shotId": ID, "stage": enum("planning", "assets", "generation", "editing", "review", "delivery"), "status": enum("open", "in_progress", "blocked", "done"), "dueAt": TIME, "note": TEXT}, ["projectId", "title", "stage", "status"])
schema("TaskInput", {"title": NAME, "assigneeMembershipId": ID, "shotId": ID, "stage": enum("planning", "assets", "generation", "editing", "review", "delivery"), "status": enum("open", "in_progress", "blocked", "done"), "dueAt": TIME, "note": TEXT}, ["title", "stage", "status"])
entity("Budget", {"projectId": ID, "periodStart": TIME, "periodEnd": TIME, "limit": ref("Money"), "reserved": ref("Money"), "spent": ref("Money")}, ["periodStart", "periodEnd", "limit", "reserved", "spent"])
schema("BudgetInput", {"projectId": ID, "periodStart": TIME, "periodEnd": TIME, "limit": ref("Money")}, ["periodStart", "periodEnd", "limit"])
entity("UsageEntry", {"projectId": ID, "jobId": ID, "kind": enum("charge", "adjustment"), "amount": ref("Money"), "confirmedAt": TIME}, ["jobId", "kind", "amount", "confirmedAt"])
schema("Event", {"seq": string(pattern="^[0-9]+$"), "type": enum("resource_changed", "reset", "access_revoked"), "resourceKind": string(), "resourceId": ID, "resourceRevision": POS}, ["seq", "type"])

# Reviewed implementation baseline: explicit production inputs and media facts.
def extend(name, properties, required=()):
    S[name]["properties"].update(properties)
    S[name]["required"] = list(dict.fromkeys([*S[name]["required"], *required]))
def remove(name, *properties):
    for prop in properties:
        S[name]["properties"].pop(prop, None)
        if prop in S[name]["required"]: S[name]["required"].remove(prop)

def require_when(name, condition, rule):
    S[name].setdefault("allOf", []).append({"if": condition, "then": rule})

S["CharacterState"] = S.pop("SceneState")
extend("CharacterState", {"position": TEXT, "gaze": TEXT, "knowledge": TEXT, "bodyNotes": TEXT, "voiceAssetRevisionId": ID})
schema("PropState", {"propAssetId": ID, "propAssetRevisionId": ID, "holderCharacterAssetId": {"anyOf": [ID, {"type":"null"}]}, "hand": enum("left", "right", "both", "none"), "location": TEXT, "condition": TEXT}, ["propAssetId"])
schema("ContinuityState", {"characters": arr(ref("CharacterState")), "props": arr(ref("PropState")), "spatialNotes": TEXT})
for name in ["Scene", "SceneInput"]: S[name]["properties"]["state"] = ref("ContinuityState")
schema("TextRange", {"startOffset": INT, "endOffset": POS}, ["startOffset", "endOffset"])
schema("ScriptExcerpt", {"scriptRevisionId": ID, "range": ref("TextRange"), "quote": TEXT}, ["scriptRevisionId", "range", "quote"])
extend("Dialogue", {"voiceAssetRevisionId": ID, "sourceExcerpt": ref("ScriptExcerpt"), "sourceDialogueId": ID})
extend("ShotSpec", {"entryState": ref("ContinuityState"), "exitState": ref("ContinuityState"), "sourceExcerpts": arr(ref("ScriptExcerpt")), "sourceShotIds": arr(ID)})
extend("Reference", {"subjectAssetId": ID})
S["Reference"]["properties"]["purpose"]["enum"].append("prop")
S["Capability"]["properties"]["supportedPurposes"]["items"]["enum"].append("prop")
schema("CapabilityOutput", {"resolution": string(), "aspectRatio": string(), "quality": string()}, ["resolution", "aspectRatio", "quality"])
extend("Capability", {"displayName": NAME, "outputs": arr(ref("CapabilityOutput"))})
remove("CharacterLookDefinition", "voiceAssetRevisionId")
extend("AssetDefinition", {"defaultVoiceAssetRevisionId": ID})

# Initial AI decomposition creates proposals; complex automated rewriting is deferred.
S["ProposalOperation"]["properties"]["action"] = enum("create")
remove("ProposalOperation", "existingId")
extend("ProposalOperation", {"sourceExcerpts": arr(ref("ScriptExcerpt"))}, ["temporaryId", "proposed"])
extend("Proposal", {"sourceKind": enum("ai_analysis", "csv_import"), "sourceRange": ref("TextRange")}, ["sourceKind"])
schema("ImportShotList", {"csvText": string(minLength=1,maxLength=500000)}, ["csvText"])

schema("ReferenceOverride", {"subjectAssetId": ID, "shotId": ID, "purpose": S["Reference"]["properties"]["purpose"], "action": enum("replace", "append", "exclude"), "references": arr(ref("Reference"))}, ["purpose", "action", "references"])
schema("SourceDependency", {"kind": enum("production", "scene", "shot_revision", "asset_revision", "script_revision"), "objectId": ID, "revision": POS, "tracking": enum("fixed", "current"), "contentHash": string(pattern="^[0-9a-f]{64}$")}, ["kind", "objectId", "revision", "tracking", "contentHash"])
schema("ResolvedShotInput", {"shotId": ID, "shotRevisionId": ID, "spec": ref("ShotSpec"), "entryState": ref("ContinuityState"), "exitState": ref("ContinuityState")}, ["shotId", "shotRevisionId", "spec", "entryState", "exitState"])
schema("ResolvedReference", {"reference": ref("Reference"), "sourceLevel": enum("production", "scene", "shot", "attempt"), "sourceObjectId": ID, "shotId": ID}, ["reference", "sourceLevel"])
schema("ResolvedInput", {"resolverVersion": NAME, "prompt": TEXT, "references": arr(ref("ResolvedReference")), "shots": arr(ref("ResolvedShotInput")), "dependencies": arr(ref("SourceDependency")), "sourceExcerpt": ref("ScriptExcerpt")}, ["resolverVersion", "prompt", "references", "shots", "dependencies"])
schema("EstimateLine", {"metric": NAME, "quantity": string(pattern="^[0-9]+(\\.[0-9]+)?$"), "unit": NAME, "estimatedCost": ref("Money")}, ["metric", "quantity", "unit", "estimatedCost"])
schema("CostEstimate", {"pricingRevision": NAME, "lines": arr(ref("EstimateLine")), "baseCost": ref("Money"), "holdMargin": ref("Money"), "totalReservation": ref("Money"), "basisNote": TEXT}, ["pricingRevision", "lines", "baseCost", "holdMargin", "totalReservation", "basisNote"])
remove("PlanInput", "references")
extend("PlanInput", {"additionalReferences": arr(ref("Reference")), "referenceOverrides": arr(ref("ReferenceOverride")), "promptPolicy": enum("append", "replace"), "scriptRange": ref("TextRange")}, ["additionalReferences", "referenceOverrides", "promptPolicy"])
remove("GenerationPlan", "resolvedPrompt", "estimate")
extend("GenerationPlan", {"resolvedInput": ref("ResolvedInput"), "costEstimate": ref("CostEstimate"), "connectionVersionId": ID}, ["resolvedInput", "connectionVersionId"])
require_when("PlanInput", {"properties":{"purpose":{"const":"script_analysis"}},"required":["purpose"]}, {"required":["sourceScriptRevisionId","scriptRange"], "properties":{"scope":{"const":"project"},"additionalReferences":{"maxItems":0},"referenceOverrides":{"maxItems":0},"shotSources":{"maxItems":0},"output":{"maxProperties":0}}})
require_when("GenerationPlan", {"properties":{"status":{"const":"ready"}},"required":["status"]}, {"required":["costEstimate"]})

extend("ConnectionInput", {"providerAccountIdentity": NAME}, ["providerAccountIdentity"])
extend("Connection", {"currentVersionId": ID, "accountIdentityLabel": NAME}, ["currentVersionId", "accountIdentityLabel"])
entity("ConnectionVersion", {"connectionId": ID, "provider": NAME, "region": NAME, "accountIdentityLabel": NAME, "verificationStatus": enum("pending", "verified", "rejected"), "verifiedAt": TIME}, ["connectionId", "provider", "region", "accountIdentityLabel", "verificationStatus"])
remove("GenerationJob", "actualCost")
extend("GenerationJob", {"connectionVersionId": ID, "costStatus": enum("pending", "partial", "final", "unavailable"), "confirmedCost": ref("Money"), "reservationRemaining": ref("Money"), "controlHold": ref("Money"), "finalCost": ref("Money"), "recoveryEpoch": POS}, ["connectionVersionId", "costStatus", "confirmedCost", "reservationRemaining", "recoveryEpoch"])
require_when("GenerationJob", {"properties":{"costStatus":{"const":"final"}},"required":["costStatus"]}, {"required":["finalCost"]})

schema("ProvenanceInput", {"sourceNote": TEXT, "sourceUrl": string(format="uri"), "usageNote": TEXT, "evidenceMediaIds": arr(ID), "shareable": BOOL}, ["sourceNote", "usageNote", "shareable"])
schema("MediaProvenance", {"record": ref("ProvenanceInput"), "recordedBy": ID, "recordedAt": TIME, "status": enum("unknown", "recorded")}, ["status"])
schema("MediaDerivative", {"id": ID, "kind": enum("poster", "proxy"), "status": enum("queued", "processing", "ready", "failed"), "profileRevision": POS, "mime": string(), "durationUs": US, "width": POS, "height": POS}, ["id", "kind", "status", "profileRevision"])
schema("MediaProcessingIssue", {"code": NAME, "message": TEXT, "retryable": BOOL}, ["code", "message", "retryable"])
for media_resource in ["UploadIntent", "Media", "MediaDerivative"]:
    extend(media_resource, {"issue": ref("MediaProcessingIssue")})
schema("ProbeTiming", {"frameRateMode": enum("cfr", "vfr", "unknown"), "timeBaseNum": POS, "timeBaseDen": POS, "startPts": string(pattern="^-?[0-9]+$"), "audioSampleRate": POS, "audioChannels": POS}, ["frameRateMode", "timeBaseNum", "timeBaseDen", "startPts"])
extend("Media", {"displayName": NAME, "originalFileName": NAME, "tags": arr(NAME), "createdBy": ID, "provenance": ref("MediaProvenance"), "derivatives": arr(ref("MediaDerivative")), "timing": ref("ProbeTiming")}, ["displayName", "tags", "provenance", "derivatives"])
extend("UploadInput", {"displayName": NAME, "tags": arr(NAME), "provenance": ref("ProvenanceInput")})
extend("UploadInput", {"canvasTarget": ref("CanvasUploadTarget")})
schema("MediaMetadataChange", {"displayName": NAME, "tags": arr(NAME), "provenance": ref("ProvenanceInput")}, ["displayName", "tags"])
extend("AccessRequest", {"variant": enum("original", "proxy", "poster"), "derivativeId": ID}, ["variant"])
schema("RecoverDerivative", {"variant": enum("proxy", "poster")}, ["variant"])

# Generic timeline holds media; drama-specific dialogue bindings live alongside it.
schema("DialogueBinding", {"id": ID, "shotRevisionId": ID, "dialogueId": ID, "clipId": ID, "usage": enum("native_mixed", "dialogue", "subtitle"), "sourceRange": ref("Range"), "voiceAssetRevisionId": ID, "note": TEXT}, ["id", "shotRevisionId", "dialogueId", "clipId", "usage"])
extend("MediaClip", {"streamSelection": enum("default", "embedded_audio")}, ["streamSelection"])
schema("NormalizationChange", {"id": ID, "clipId": ID, "kind": enum("frame_snap", "sample_snap", "timeline_shift", "binding_review"), "message": TEXT, "requiresAcknowledgement": BOOL}, ["id", "kind", "message", "requiresAcknowledgement"])
schema("NormalizedItem", {"clipId": ID, "kind": enum("video", "audio", "subtitle"), "timelineStartFrame": INT, "timelineEndFrame": POS, "sourceMediaId": ID, "sourceMapId": ID, "sourceSha256": string(pattern="^[0-9a-f]{64}$"), "productionCopyId": ID, "tailAdjustmentSamples": {"type":"integer","minimum":-1,"maximum":1}, "sourceInFrame": INT, "sourceOutFrame": POS, "timelineStartSample": INT, "timelineEndSample": POS, "sourceInSample": INT, "sourceOutSample": POS}, ["clipId", "kind"])
schema("RenderProfile", {"id": NAME, "revision": POS, "spec": ref("Spec"), "audioSampleRate": POS, "audioChannels": POS, "videoCodec": NAME, "pixelFormat": NAME, "audioCodec": NAME, "colorPolicy": NAME, "fontBundleRevision": NAME}, ["id", "revision", "spec", "audioSampleRate", "audioChannels", "videoCodec", "pixelFormat", "audioCodec", "colorPolicy", "fontBundleRevision"])
schema("NormalizationInput", {"cutId": ID, "baseCutRevision": POS, "timeline": ref("Timeline"), "dramaBindings": arr(ref("DialogueBinding"))}, ["cutId", "baseCutRevision", "timeline", "dramaBindings"])
entity("NormalizationResult", {"projectId": ID, "cutId": ID, "baseCutRevision": POS, "requestHash": string(pattern="^[0-9a-f]{64}$"), "status": enum("processing", "ready", "failed"), "effectiveTimeline": ref("Timeline"), "dramaBindings": arr(ref("DialogueBinding")), "lengthFrames": POS, "durationUs": POS, "normalizedItems": arr(ref("NormalizedItem")), "changes": arr(ref("NormalizationChange")), "renderProfile": ref("RenderProfile"), "rendererVersion": NAME, "normalizationVersion": NAME, "errorCode": string()}, ["projectId", "cutId", "baseCutRevision", "requestHash", "status", "changes"])
require_when("NormalizationResult", {"properties":{"status":{"const":"ready"}},"required":["status"]}, {"required":["effectiveTimeline","dramaBindings","lengthFrames","durationUs","normalizedItems","renderProfile","rendererVersion","normalizationVersion"]})
extend("Cut", {"editingMode": enum("timeline", "external_file"), "dramaBindings": arr(ref("DialogueBinding")), "normalizationId": ID, "lengthFrames": POS, "durationUs": POS}, ["editingMode", "dramaBindings"])
remove("Cut", "timeline")
extend("Cut", {"timeline": ref("Timeline")})
require_when("Cut", {"properties":{"editingMode":{"const":"timeline"}},"required":["editingMode"]}, {"required":["timeline"]})
remove("CutInput", "timeline")
S["CutDraftInput"] = obj({"normalizationId": ID, "acknowledgedChangeIds": arr(ID,uniqueItems=True)}, ["normalizationId", "acknowledgedChangeIds"])
schema("TrackEditDecision", {"clipId": ID, "action": enum("keep", "move", "replace", "remove"), "timelineStartUs": US, "replacement": {"oneOf":[ref("MediaClip"),ref("SubtitleClip")]}}, ["clipId","action"])
schema("CutReplacementInput", {"dramaBindings": arr(ref("DialogueBinding")), "baseCutRevision": POS, "targetClipId": ID, "takeId": ID, "newRange": ref("Range"), "mode": enum("keep_duration", "change_duration"), "trackDecisions": arr(ref("TrackEditDecision"))}, ["baseCutRevision","targetClipId","takeId","newRange","mode","trackDecisions","dramaBindings"])
extend("CutRevision", {"normalizationId": ID, "effectiveTimeline": ref("Timeline"), "dramaBindings": arr(ref("DialogueBinding")), "lengthFrames": POS, "durationUs": POS, "normalizedItems": arr(ref("NormalizedItem")), "renderProfile": ref("RenderProfile"), "rendererVersion": NAME, "normalizationVersion": NAME, "subtitleMediaId": ID, "sourceReviewIds": arr(ID)})
remove("CutRevision", "timeline")
require_when("CutRevision", {"properties":{"origin":{"const":"platform"}},"required":["origin"]}, {"required":["normalizationId","effectiveTimeline","dramaBindings","lengthFrames","durationUs","normalizedItems","renderProfile","rendererVersion","normalizationVersion"]})
extend("ExternalCutInput", {"cutId": ID, "subtitleMediaId": ID})

schema("ReworkLink", {"reviewId": ID, "commentId": ID, "commentRevision": POS}, ["reviewId","commentId"])
schema("ReworkItem", {"sourceCommentId": ID, "outcome": enum("replaced", "retained", "unresolved"), "resultTakeId": ID, "resultClipId": ID, "resultRange": ref("Range"), "note": TEXT}, ["sourceCommentId","outcome","note"])
extend("TaskInput", {"origin": ref("ReworkLink")})
extend("Task", {"origin": ref("ReworkLink"), "result": ref("ReworkItem")})
extend("TaskInput", {"result": ref("ReworkItem")})
extend("ReviewInput", {"sourceReviewIds": arr(ID,uniqueItems=True), "reworkItems": arr(ref("ReworkItem"))})
extend("Review", {"sourceReviewIds": arr(ID), "reworkItems": arr(ref("ReworkItem")), "acceptedExceptions": arr(ref("ReworkItem"))}, ["sourceReviewIds","reworkItems"])
extend("DecisionInput", {"acceptedExceptions": arr(ref("ReworkItem"))})

# Source packages do not require a platform cut; final delivery still requires approval.
schema("SourcePackageSelection", {"takeIds": arr(ID,minItems=1,uniqueItems=True), "extraMediaIds": arr(ID,uniqueItems=True)}, ["takeIds", "extraMediaIds"])
remove("DeliveryInput", "cutRevisionId")
extend("DeliveryInput", {"cutRevisionId": ID, "sourceSelection": ref("SourcePackageSelection")})
S["DeliveryInput"]["oneOf"] = [{"required":["cutRevisionId"],"not":{"required":["sourceSelection"]}},{"required":["sourceSelection"],"not":{"required":["cutRevisionId"]},"properties":{"kind":{"const":"working"},"includeMedia":{"const":True}}}]
require_when("DeliveryInput", {"properties":{"kind":{"const":"final"}},"required":["kind"]}, {"required":["cutRevisionId","reviewId"]})
for name in ["Delivery", "DeliveryManifest"]:
    if "cutRevisionId" in S[name]["required"]: S[name]["required"].remove("cutRevisionId")
    extend(name, {"packageType": enum("source_package", "cut_package")}, ["packageType"])
S["DeliveryManifest"]["properties"]["origin"] = enum("platform", "external", "selection")
extend("DeliveryManifest", {"sourceSelection": ref("SourcePackageSelection"), "takes": arr(ref("Take")), "dramaBindings": arr(ref("DialogueBinding")), "normalizedItems": arr(ref("NormalizedItem")), "sourcePolicy": enum("full_originals"), "handoffTableFile": NAME, "sourceProvenance": arr(obj({"mediaId":ID,"provenance":ref("MediaProvenance")},["mediaId","provenance"]))}, ["sourcePolicy","handoffTableFile"])
for name in ["DeliveryManifest"]:
    require_when(name,{"properties":{"packageType":{"const":"source_package"}},"required":["packageType"]},{"required":["sourceSelection","takes"],"properties":{"origin":{"const":"selection"},"externalTimelineKnown":{"const":False}},"not":{"anyOf":[{"required":["cutRevisionId"]},{"required":["timeline"]}]}})
require_when("Delivery", {"properties":{"kind":{"const":"final"}},"required":["kind"]}, {"required":["cutRevisionId"],"properties":{"packageType":{"const":"cut_package"}}})

require_when("NormalizedItem", {"properties":{"kind":{"enum":["video","subtitle"]}},"required":["kind"]}, {"required":["timelineStartFrame","timelineEndFrame"]})
require_when("NormalizedItem", {"properties":{"kind":{"const":"audio"}},"required":["kind"]}, {"required":["timelineStartSample","timelineEndSample","sourceInSample","sourceOutSample","sourceMediaId"]})
require_when("NormalizedItem", {"properties":{"kind":{"const":"video"}},"required":["kind"]}, {"required":["sourceInFrame","sourceOutFrame","sourceMediaId","sourceMapId","productionCopyId"]})
# Structural conditions that do not need database lookups.
for name, definition in S.items():
    if "scope" in definition.get("properties", {}):
        require_when(name,{"properties":{"scope":{"const":"project"}},"required":["scope"]},{"required":["projectId"]})
        require_when(name,{"properties":{"scope":{"const":"shared"}},"required":["scope"]},{"not":{"required":["projectId"]}})
require_when("ReferenceOverride", {"properties":{"action":{"const":"exclude"}},"required":["action"]}, {"properties":{"references":{"maxItems":0}}})
require_when("CharacterState", {"anyOf":[{"required":["lookId"]},{"required":["lookAssetRevisionId"]}]}, {"required":["lookId","lookAssetRevisionId"]})
require_when("MediaClip", {"properties":{"kind":{"const":"video"}},"required":["kind"]}, {"required":["fit"],"properties":{"streamSelection":{"const":"default"}}})
require_when("TrackEditDecision", {"properties":{"action":{"const":"move"}},"required":["action"]}, {"required":["timelineStartUs"]})
require_when("TrackEditDecision", {"properties":{"action":{"const":"replace"}},"required":["action"]}, {"required":["replacement"]})

# Review closure: expose exact changes and persist verified rendering facts.
schema("TimingChangeValues", {"range": ref("Range"), "timelineStartUs": US, "durationUs": US, "startFrame": INT, "endFrame": INT, "startSample": INT, "endSample": INT, "note": TEXT})
extend("NormalizationChange", {"before": ref("TimingChangeValues"), "after": ref("TimingChangeValues")}, ["before", "after"])
extend("TrackEditDecision", {"note": TEXT})
require_when("NormalizedItem", {"properties":{"kind":{"enum":["video","audio"]}},"required":["kind"]}, {"required":["sourceSha256","sourceMapId","productionCopyId"]})
schema("RenderVerification", {"actualFrameCount": POS, "effectiveAudioSamples": INT, "presentationDurationUs": POS, "containerDurationUs": POS, "firstVideoPts": string(pattern="^-?[0-9]+$"), "lastVideoPts": string(pattern="^-?[0-9]+$"), "audioTimeBaseNum": POS, "audioTimeBaseDen": POS, "verifiedAt": TIME, "profileRevision": POS}, ["actualFrameCount","effectiveAudioSamples","presentationDurationUs","containerDurationUs","firstVideoPts","lastVideoPts","verifiedAt","profileRevision"])
extend("Media", {"renderVerification": ref("RenderVerification")})
require_when("CutRevision", {"properties":{"status":{"const":"ready"}},"required":["status"]}, {"required":["mediaId","durationUs"]})
S["ReworkItem"]["properties"]["note"] = string(minLength=1,maxLength=20000)
for name in ["Review", "DecisionInput"]:
    S[name]["properties"]["acceptedExceptions"] = arr({"allOf":[ref("ReworkItem"),{"properties":{"outcome":{"enum":["retained","unresolved"]}}}]})
require_when("Track", {"properties":{"kind":{"const":"video"}},"required":["kind"]}, {"properties":{"items":{"items":{"allOf":[ref("MediaClip"),{"properties":{"kind":{"const":"video"}}}]}}}})
require_when("Track", {"properties":{"kind":{"const":"audio"}},"required":["kind"]}, {"properties":{"items":{"items":{"allOf":[ref("MediaClip"),{"properties":{"kind":{"const":"audio"}}}]}}}})
require_when("Track", {"properties":{"kind":{"const":"subtitle"}},"required":["kind"]}, {"properties":{"items":{"items":ref("SubtitleClip")}}})

remove("Proposal", "sourceScriptRevisionId")
extend("Proposal", {"sourceScriptRevisionId": ID, "sourceHash": string(pattern="^[0-9a-f]{64}$"), "scriptRange": ref("TextRange")}, ["sourceHash"])
require_when("Proposal", {"properties":{"sourceKind":{"const":"ai_analysis"}},"required":["sourceKind"]}, {"required":["sourceScriptRevisionId","scriptRange"]})
schema("SourceMediaBinding", {"mediaId": ID, "sourceRange": ref("Range"), "usage": enum("native_mixed","dialogue","subtitle","ambience","music","reference"), "shotRevisionId": ID, "dialogueId": ID, "voiceAssetRevisionId": ID, "appliesToMediaId": ID, "note": TEXT}, ["mediaId","usage","note"])
require_when("SourceMediaBinding", {"required":["dialogueId"]}, {"required":["shotRevisionId"]})
extend("SourcePackageSelection", {"sourceBindings": arr(ref("SourceMediaBinding"))}, ["sourceBindings"])
require_when("Media", {"properties":{"status":{"enum":["ready","archived"]}},"required":["status"]}, {"required":["sha256","bytes"]})

remove("Proposal", "sourceRange")
extend("ReworkItem", {"resultCutRevisionId": ID, "resultMediaId": ID})
require_when("ReworkItem", {"properties":{"outcome":{"const":"replaced"}},"required":["outcome"]}, {"anyOf":[{"required":["resultTakeId"]},{"required":["resultClipId"]},{"required":["resultCutRevisionId"]},{"required":["resultMediaId"]}]})

# A portable package must explain its purpose and missing facts without app access.
S["ManifestFile"]["properties"]["role"] = enum("final","preview","source","subtitle","readme","shot_table","sound_table","evidence")
extend("ManifestFile", {"mediaIds": arr(ID,uniqueItems=True), "mime": NAME})
schema("PackageAvailability", {"timelineKnown": BOOL, "preview": enum("included","not_ready","not_applicable"), "subtitles": enum("included","not_requested","missing"), "approved": BOOL}, ["timelineKnown","preview","subtitles","approved"])
S["DeliveryManifest"]["properties"]["sourcePolicy"] = enum("full_originals","not_included")
extend("DeliveryManifest", {"deliveryId": ID, "kind": enum("working","final"), "createdAt": TIME, "availability": ref("PackageAvailability"), "outputSpecBasis": enum("project_target","frozen_timeline","verified_media"), "soundTableFile": NAME, "readmeFile": NAME, "missingItems": arr(TEXT), "unknownItems": arr(TEXT), "selections": arr(ref("Selection"))}, ["deliveryId","kind","createdAt","availability","outputSpecBasis","soundTableFile","readmeFile","missingItems","unknownItems"])
require_when("DeliveryManifest", {"properties":{"packageType":{"const":"source_package"}},"required":["packageType"]}, {"required":["selections"],"properties":{"kind":{"const":"working"},"sourcePolicy":{"const":"full_originals"},"outputSpecBasis":{"const":"project_target"},"availability":{"properties":{"timelineKnown":{"const":False},"preview":{"const":"not_applicable"},"approved":{"const":False}}}}})
require_when("DeliveryManifest", {"properties":{"kind":{"const":"final"}},"required":["kind"]}, {"required":["cutRevisionId","reviewId","approvedBy","approvedAt"],"properties":{"packageType":{"const":"cut_package"},"outputSpecBasis":{"const":"verified_media"},"availability":{"properties":{"preview":{"const":"included"},"approved":{"const":True}}}}})
require_when("Delivery", {"properties":{"status":{"const":"ready"}},"required":["status"]}, {"required":["manifest","packageSha256","packageBytes"]})
require_when("DeliveryInput", {"properties":{"kind":{"const":"working"}},"required":["kind"]}, {"properties":{"includeMedia":{"const":True}}})


# 2026-09-09 closure: append to an existing scene, durable assistance and creative authority.
S["ProposalTarget"] = {"oneOf": [
    obj({"mode": enum("new_structure")}, ["mode"]),
    obj({"mode": enum("append_to_scene"), "sceneId": ID, "sceneRevision": POS, "episodeId": ID}, ["mode","sceneId","sceneRevision","episodeId"]),
]}
for name in ["Proposal", "ImportShotList"]:
    extend(name, {"target": ref("ProposalTarget")}, ["target"])
extend("ApplyProposal", {"proposalRevision": POS}, ["proposalRevision"])
schema("ProposalEdit", {"operations": arr(ref("ProposalOperation"),minItems=1), "target": ref("ProposalTarget"), "baseContentRevision": POS}, ["operations","target","baseContentRevision"])
# Additive implementation fields: fixed review baseline and permanent partial-adoption result.
schema("ProposalApplication", {"proposalRevision": POS, "selectedOperationIds": arr(ID,minItems=1,uniqueItems=True), "createdObjects": {"type":"object","additionalProperties":ID,"description":"本次采纳的 opId 到服务端实际创建对象 id 的固定映射。"}, "contentRevision": POS, "appliedAt": TIME}, ["proposalRevision","selectedOperationIds","createdObjects","contentRevision","appliedAt"])
extend("Proposal", {"baseContentSnapshot": {**ref("ContentTree"),"description":"固定的导入或人工复核基线，供详情比较当前内容。列表可省略；不随内容变化自动更新。","readOnly":True}, "application": {**ref("ProposalApplication"),"readOnly":True,"description":"当前提案的固定采纳结果；详情及历史读取时返回，列表可省略。未选项仍保留在提案修订。"}})

for kind, input_name in [("episode","EpisodeInput"),("scene","SceneInput"),("shot","ShotInput"),("asset_suggestion","AssetInput")]:
    require_when("ProposalOperation", {"properties":{"kind":{"const":kind}},"required":["kind"]}, {"properties":{"proposed":ref(input_name)}})
require_when("Proposal", {"properties":{"target":{"properties":{"mode":{"const":"append_to_scene"}},"required":["mode"]}},"required":["target"]}, {"properties":{"operations":{"items":{"properties":{"kind":{"const":"shot"}}}}}})
schema("ContextSourceInput", {"kind": enum("production","scene","shot_revision","asset_revision"), "objectId": ID, "revision": POS}, ["kind","objectId","revision"])
schema("ContextSnapshot", {"source": ref("SourceDependency"), "text": TEXT}, ["source","text"])
schema("AssistanceRequest", {"kind": enum("prepare_prompt","prepare_rework","discuss"), "canvasId": ID, "targetCapabilityId": ID, "targetCapabilityRevision": POS, "sourceTakeId": ID, "sourceCutRevisionId": ID, "feedback": ref("ReworkLink")}, ["kind"])
require_when("AssistanceRequest", {"properties":{"kind":{"const":"discuss"}},"required":["kind"]}, {"required":["canvasId"],"not":{"anyOf":[{"required":[x]} for x in ["targetCapabilityId","targetCapabilityRevision","feedback","sourceTakeId","sourceCutRevisionId"]]}})
require_when("AssistanceRequest", {"properties":{"kind":{"enum":["prepare_prompt","prepare_rework"]}},"required":["kind"]}, {"required":["targetCapabilityId","targetCapabilityRevision"],"not":{"required":["canvasId"]}})
require_when("AssistanceRequest", {"properties":{"kind":{"const":"prepare_rework"}},"required":["kind"]}, {"required":["feedback"],"properties":{"feedback":{"required":["commentRevision"]}},"anyOf":[{"required":["sourceTakeId"]},{"required":["sourceCutRevisionId"]}]})
schema("AssistanceBody", {"message": string(minLength=1,maxLength=20000), "prompt": TEXT, "referenceSuggestions": arr(ref("Reference")), "retain": arr(TEXT), "change": arr(TEXT), "notes": TEXT}, ["prompt","referenceSuggestions","retain","change","notes"])
entity("AssistanceArtifact", {"projectId": ID, "generationJobId": ID, "request": ref("AssistanceRequest"), "shotSources": arr(ref("ShotSource")), "resolvedInput": ref("ResolvedInput"), "body": ref("AssistanceBody"), "editedBy": ID, "inputOutdated": BOOL}, ["projectId","generationJobId","request","shotSources","resolvedInput","body","inputOutdated"])
schema("AssistanceEdit", {"body": ref("AssistanceBody")}, ["body"])
schema("ArtifactSource", {"artifactId": ID, "revision": POS}, ["artifactId","revision"])
schema("AssistanceTurn", {"source":ref("ArtifactSource"),"instruction":TEXT,"message":string(minLength=1,maxLength=20000)}, ["source","instruction","message"])
for name in ["PlanInput", "Capability"]:
    S[name]["properties"]["purpose"]["enum"].append("creative_assistance")
extend("PlanInput", {"proposalTarget": ref("ProposalTarget"), "contextSources": arr(ref("ContextSourceInput")), "assistance": ref("AssistanceRequest"), "assistanceSource": ref("ArtifactSource")})
extend("ResolvedInput", {"contextSnapshots": arr(ref("ContextSnapshot")), "assistanceSnapshot": ref("AssistanceBody"), "assistanceRequest": ref("AssistanceRequest"), "feedbackSnapshot": obj({"reviewId":ID,"commentId":ID,"commentRevision":POS,"body":TEXT,"subject":ref("ReviewSubject"),"startUs":US,"endUs":US},["reviewId","commentId","commentRevision","body","subject"])})
extend("GenerationJob", {"assistanceArtifactId": ID})
require_when("PlanInput", {"properties":{"purpose":{"const":"script_analysis"}},"required":["purpose"]}, {"required":["proposalTarget"]})
require_when("PlanInput", {"properties":{"purpose":{"const":"creative_assistance"}},"required":["purpose"]}, {"required":["assistance","shotSources"],"properties":{"scope":{"const":"project"},"shotSources":{"minItems":1},"output":{"maxProperties":0}},"not":{"anyOf":[{"required":["proposalTarget"]}]}})
require_when("PlanInput", {"not":{"properties":{"purpose":{"const":"creative_assistance"}},"required":["purpose"]}}, {"not":{"required":["assistance"]}})
require_when("PlanInput", {"not":{"properties":{"purpose":{"const":"script_analysis"}},"required":["purpose"]}}, {"not":{"anyOf":[{"required":["proposalTarget"]}]}})
require_when("PlanInput", {"required":["assistanceSource"]}, {"properties":{"scope":{"const":"project"}},"anyOf":[{"properties":{"purpose":{"enum":["video","image","audio"]}}},{"required":["canvasSources","assistance"],"properties":{"purpose":{"const":"creative_assistance"},"assistance":{"properties":{"kind":{"enum":["prepare_prompt","discuss"]}}}}}]})
S["SourceDependency"]["properties"]["kind"]["enum"] += ["assistance_artifact","creative_confirmation","review_comment"]
for name in ["Task", "TaskInput"]:
    extend(name, {"kind": enum("general","scene_owner","assist","rework"), "sceneId": ID}, ["kind"])
    require_when(name, {"properties":{"kind":{"const":"scene_owner"}},"required":["kind"]}, {"required":["sceneId","assigneeMembershipId"],"not":{"required":["shotId"]}})
# Confirmation records capture only protected meaning, not camera or everyday prompt choices.
schema("CreativeBasisInput", {"kind": enum("script","production","scene","shot_dialogue"), "objectId": ID, "revision": POS, "note": TEXT}, ["kind","objectId","revision"])
S["CreativeSnapshot"] = {"oneOf": [
    obj({"kind":enum("script"),"scriptRevisionId":ID,"text":string(maxLength=500000)},["kind","scriptRevisionId","text"]),
    obj({"kind":enum("production"),"brief":TEXT,"defaultAssetRevisionIds":arr(ID)},["kind","brief","defaultAssetRevisionIds"]),
    obj({"kind":enum("scene"),"summary":TEXT,"state":ref("ContinuityState"),"defaultAssetRevisionIds":arr(ID)},["kind","summary","state","defaultAssetRevisionIds"]),
    obj({"kind":enum("shot_dialogue"),"shotRevisionId":ID,"dialogue":arr(ref("Dialogue"))},["kind","shotRevisionId","dialogue"]),
]}
entity("CreativeBasisRevision", {"projectId":ID,"basis":ref("CreativeBasisInput"),"subjectId":ID,"contentHash":string(pattern="^[0-9a-f]{64}$"),"hashVersion":NAME,"snapshot":ref("CreativeSnapshot")},["projectId","basis","subjectId","contentHash","hashVersion","snapshot"])
schema("ConfirmCreativeBasis", {"basisRevisionId":ID,"usage":enum("project_default","cut_revision"),"cutRevisionId":ID,"expectedCurrentConfirmationId":{"anyOf":[ID,{"type":"null"}]},"note":TEXT},["basisRevisionId","usage"])
require_when("ConfirmCreativeBasis", {"properties":{"usage":{"const":"project_default"}},"required":["usage"]}, {"required":["expectedCurrentConfirmationId"],"not":{"required":["cutRevisionId"]}})
require_when("ConfirmCreativeBasis", {"properties":{"usage":{"const":"cut_revision"}},"required":["usage"]}, {"required":["cutRevisionId"],"not":{"required":["expectedCurrentConfirmationId"]}})
entity("CreativeConfirmation", {"projectId":ID,"basisRevisionId":ID,"usage":enum("project_default","cut_revision"),"cutRevisionId":ID,"basis":ref("CreativeBasisInput"),"subjectId":ID,"contentHash":string(pattern="^[0-9a-f]{64}$"),"snapshot":ref("CreativeSnapshot"),"confirmedBy":ID,"confirmedAt":TIME,"replacesConfirmationId":ID},["projectId","basisRevisionId","usage","basis","subjectId","contentHash","snapshot","confirmedBy","confirmedAt"])
require_when("CreativeConfirmation", {"properties":{"usage":{"const":"cut_revision"}},"required":["usage"]}, {"required":["cutRevisionId"]})
extend("CutRevision", {"creativeBasisRevisionIds":arr(ID,uniqueItems=True)})
require_when("CutRevision", {"properties":{"origin":{"const":"platform"}},"required":["origin"]}, {"required":["creativeBasisRevisionIds"]})
extend("ResolvedInput", {"creativeBasisRevisionIds":arr(ID,uniqueItems=True)})
S["SourceDependency"]["properties"]["kind"]["enum"].append("creative_basis_revision")
for name in ["FreezeCut", "CutRevision", "Review", "DecisionInput"]:
    extend(name, {"creativeConfirmationIds":arr(ID,uniqueItems=True)})


from canvas_contract import schemas as canvas_schemas, register_routes as register_canvas_routes
S.update(canvas_schemas())
S["SourceDependency"]["properties"]["kind"]["enum"].append("canvas_draft")
S["SourceDependency"]["properties"]["kind"]["enum"].append("canvas_node")
schema("CanvasAssistanceSource", {"canvasId":ID,"canvasRevision":POS,"nodeId":ID,"purpose":S["Reference"]["properties"]["purpose"]}, ["canvasId","canvasRevision","nodeId"])
schema("CanvasAssistanceSnapshot", {"source":ref("CanvasAssistanceSource"),"kind":enum("text","image","video","audio"),"content":{"oneOf":[ref("CanvasTextContent"),ref("CanvasDraftContent"),ref("CanvasMediaContent")]},"contentHash":string(pattern="^[0-9a-f]{64}$")}, ["source","kind","content","contentHash"])
require_when("CanvasAssistanceSnapshot", {"properties":{"kind":{"const":"text"}},"required":["kind"]}, {"properties":{"content":ref("CanvasTextContent")}})
require_when("CanvasAssistanceSnapshot", {"properties":{"content":{"properties":{"type":{"const":"media"}},"required":["type"]}},"required":["content"]}, {"properties":{"source":{"required":["purpose"]},"kind":{"enum":["image","video","audio"]}}})
extend("PlanInput", {"canvasSources":arr(ref("CanvasAssistanceSource"),maxItems=20)})
extend("ResolvedInput", {"canvasSnapshots":arr(ref("CanvasAssistanceSnapshot"),maxItems=20),"assistanceInstruction":TEXT,"assistanceHistory":arr(ref("AssistanceTurn"),minItems=1,maxItems=20),"canvasScope":{"oneOf":[obj({"canvasId":ID,"sceneId":ID},["canvasId","sceneId"]),obj({"canvasId":ID,"projectId":ID},["canvasId","projectId"])]}})
require_when("ResolvedInput", {"required":["assistanceInstruction"]}, {"required":["assistanceSnapshot","canvasSnapshots"]})
for rule in S["PlanInput"]["allOf"]:
    if rule.get("if", {}).get("properties", {}).get("purpose", {}).get("const") == "creative_assistance":
        rule["then"]["properties"]["shotSources"] = {"maxItems":100}
        rule["then"]["anyOf"] = [{"properties":{"shotSources":{"minItems":1}}},{"required":["canvasSources"],"properties":{"canvasSources":{"minItems":1}}},{"properties":{"assistance":{"properties":{"kind":{"const":"discuss"}},"required":["kind"]}}}]
require_when("PlanInput", {"required":["canvasSources"]}, {"properties":{"purpose":{"const":"creative_assistance"},"assistance":{"properties":{"kind":{"enum":["prepare_prompt","discuss"]}}},"contextSources":{"maxItems":0},"additionalReferences":{"maxItems":0},"referenceOverrides":{"maxItems":0}}})
require_when("PlanInput", {"properties":{"assistance":{"properties":{"kind":{"const":"discuss"}},"required":["kind"]}},"required":["assistance"]}, {"required":["prompt","canvasSources"],"properties":{"prompt":{"minLength":1},"shotSources":{"maxItems":0},"contextSources":{"maxItems":0},"additionalReferences":{"maxItems":0},"referenceOverrides":{"maxItems":0}}})
require_when("AssistanceArtifact", {"properties":{"request":{"properties":{"kind":{"const":"discuss"}},"required":["kind"]}},"required":["request"]}, {"properties":{"body":{"required":["message"],"properties":{"prompt":{"const":""},"notes":{"const":""},"retain":{"maxItems":0},"change":{"maxItems":0},"referenceSuggestions":{"maxItems":0}}},"resolvedInput":{"required":["canvasScope"]}}})
require_when("AssistanceArtifact", {"properties":{"shotSources":{"maxItems":0}},"required":["shotSources"]}, {"properties":{"resolvedInput":{"required":["canvasSnapshots"]}}})
schema("ApplyCanvasAssistance", {"applicationId":ID,"artifactId":ID,"artifactRevision":POS,"nodeId":ID,"mode":enum("replace","append")}, ["applicationId","artifactId","artifactRevision","nodeId","mode"])
schema("CanvasAssistanceApplication", {"id":ID,"canvasId":ID,"nodeId":ID,"artifactId":ID,"artifactRevision":POS,"mode":enum("replace","append"),"baseCanvasRevision":POS,"resultCanvasRevision":POS,"beforePrompt":TEXT,"afterPrompt":TEXT,"appliedAt":TIME}, ["id","canvasId","nodeId","artifactId","artifactRevision","mode","baseCanvasRevision","resultCanvasRevision","beforePrompt","afterPrompt","appliedAt"])
schema("CanvasAssistanceApplicationResult", {"canvas":ref("Canvas"),"application":ref("CanvasAssistanceApplication")}, ["canvas","application"])

from editing_contract import extend_schemas as extend_editing_schemas, register_routes as register_editing_routes
extend_editing_schemas(S)

paths = {}
catalog = []
PREFIX = "/v1/tenants/{tenantId}"
def route(method, suffix, op, requirement, description, response=None, request=None, code=None, cas=False, permission="project_member", public=False, root=False, listing=False):
    path = suffix if root else PREFIX + suffix
    status = str(code or (201 if method == "post" else 200))
    params = []
    import re
    for param in re.findall(r"\{([^}]+)\}", path):
        params.append({"name": param, "in": "path", "required": True, "schema": ID})
    if not public and method in ["post", "put", "patch", "delete"]:
        params.append({"$ref": "#/components/parameters/Csrf"})
    if method == "post" and not public:
        params.append({"$ref": "#/components/parameters/IdempotencyKey"})
    if cas: params.append({"$ref": "#/components/parameters/IfMatch"})
    if listing:
        params += [{"name": "cursor", "in": "query", "schema": string()}, {"name": "limit", "in": "query", "schema": {"type": "integer", "minimum": 1, "maximum": 100, "default": 30}}, {"name": "q", "in": "query", "schema": string(maxLength=200)}, {"name": "projectId", "in": "query", "schema": ID}]
    responses = {status: {"description": "成功；异步结果需查询资源。" if status == "202" else "成功"}}
    if response: responses[status]["content"] = {"application/json": {"schema": ref(response)}}
    for error in [400,401,403,404,409,412,422,429,503]:
        responses[str(error)] = {"$ref": "#/components/responses/Problem"}
    item = {"operationId": op, "tags": [requirement], "summary": description, "description": f"权限：{permission}。遵守 06-api-contract.md 的授权、版本、幂等和恢复规则。", "parameters": params, "responses": responses, "x-permission": permission, "x-requirement": requirement}
    if public: item["security"] = []
    if request: item["requestBody"] = {"required": True, "content": {"application/json": {"schema": ref(request)}}}
    paths.setdefault(path,{})[method] = item
    catalog.append((requirement,method.upper(),path,op,permission))

route("get","/v1/auth/login","beginLogin","PR-01","跳转到选定 OIDC 提供方",code=302,public=True,root=True,permission="public")
paths["/v1/auth/login"]["get"]["responses"]["302"]["headers"]={"Location":{"schema":string(format="uri"),"description":"可信身份提供方跳转地址；returnTo 仅允许同站路径。"}}
paths["/v1/auth/login"]["get"]["parameters"].append({"name":"returnTo","in":"query","schema":string(maxLength=2048)})
route("get","/v1/auth/callback","finishLogin","PR-01","验证 OIDC state／PKCE 并建立会话",code=302,public=True,root=True,permission="public")
paths["/v1/auth/callback"]["get"]["parameters"]=[{"name":n,"in":"query","required":True,"schema":string()} for n in ["code","state"]]
paths["/v1/auth/callback"]["get"]["responses"]["302"]["headers"]={"Location":{"schema":string(),"description":"经校验的同站返回路径。"}}
route("get","/v1/session","getSession","PR-01","获取当前会话与 CSRF token","Session",root=True,permission="authenticated")
route("post","/v1/session/logout","logout","PR-01","退出当前会话",code=204,root=True,permission="authenticated")
route("get","/v1/tenants","listTenants","PR-01","列出有效工作室",page("Tenant"),root=True,listing=True,permission="authenticated")
route("post","/v1/tenants","createTenant","PR-01","创建工作室并成为 Owner","Tenant","CreateTenant",root=True,permission="authenticated")
route("get","","getTenant","PR-01","读取当前工作室","Tenant",permission="tenant_member")
route("patch","","renameTenant","PR-01","修改工作室名称","Tenant","Rename",cas=True,permission="owner_admin")
route("post","/ownership","transferOwnership","PR-01","转移工作室所有权","Tenant","OwnerTransfer",cas=True,permission="owner")
route("get","/members","listMembers","PR-01","读取内部成员",page("Membership"),listing=True,permission="tenant_member")
route("patch","/members/{membershipId}","changeMember","PR-01","修改角色或停用内部成员","Membership","MembershipChange",cas=True,permission="owner_admin_with_role_restrictions")
route("get","/invitations","listInvitations","PR-01","读取内部邀请状态，列表不返回邀请令牌",page("Invitation"),listing=True,permission="owner_admin")
route("post","/invitations","inviteMember","PR-01","发出内部成员邀请","Invitation","Invite",permission="owner_admin_with_role_restrictions")
route("post","/invitations/{invitationId}/revoke","revokeInvitation","PR-01","撤销未接受邀请","Invitation",cas=True,permission="owner_admin")
route("post","/v1/invitations/accept","acceptInvitation","PR-01","验证邮箱并接受邀请","Membership","AcceptInvite",root=True,permission="authenticated_verified_email")
route("get","/projects","listProjects","PR-02","列出有权项目",page("Project"),listing=True,permission="tenant_member")
route("post","/projects","createProject","PR-02","一次创建项目与剧目","Project","CreateProject",permission="owner_admin")
route("get","/projects/{projectId}","getProject","PR-02","读取项目","Project")
route("patch","/projects/{projectId}","changeProject","PR-02","修改项目名称与规格","Project","ProjectChange",cas=True,permission="project_lead_or_admin")
route("post","/projects/{projectId}/lead","changeLead","PR-02","交接项目负责人","Project","LeadChange",cas=True,permission="owner_admin")
route("post","/projects/{projectId}/archive","archiveProject","PR-02","归档项目，保留在途处理","Project",cas=True,permission="project_lead_or_admin")
route("post","/projects/{projectId}/restore","restoreProject","PR-02","恢复项目为可编辑","Project",cas=True,permission="project_lead_or_admin")
route("get","/projects/{projectId}/members","listProjectMembers","PR-02","读取项目成员",page("ProjectMember"),listing=True)
route("post","/projects/{projectId}/members","addProjectMember","PR-02","加入现有内部协作者","ProjectMember","ProjectMemberChange",permission="project_lead_or_admin")
route("delete","/projects/{projectId}/members/{membershipId}","removeProjectMember","PR-02","移除协作者，负责人需先交接",code=204,cas=True,permission="project_lead_or_admin")
route("get","/projects/{projectId}/production","getProduction","PR-05","读取剧目设定","Production")
route("put","/projects/{projectId}/production","changeProduction","PR-05","修改剧目设定与默认引用","Production","ProductionChange",cas=True)
route("get","/projects/{projectId}/scripts","listScripts","PR-03","读取剧本历史",page("ScriptRevision"),listing=True)
route("post","/projects/{projectId}/scripts","reviseScript","PR-03","保存新剧本版本","ScriptRevision","ScriptInput",cas=True)
route("post","/projects/{projectId}/scripts/preview-docx","previewScriptDocument","PR-03","解析 Word 原件并返回只读预览，不创建剧本版本","ScriptDocumentPreview","ScriptDocumentFile")
route("post","/projects/{projectId}/scripts/import-docx","importScriptDocument","PR-03","核对预览后导入 Word 为固定剧本版本","ScriptRevision","ScriptDocumentImport",cas=True)
route("get","/projects/{projectId}/script-imports/{requestId}","getScriptImportReceipt","PR-03","只读核对本人导入请求是否已保存，恢复丢回包","ScriptImportReceipt")
route("get","/projects/{projectId}/feishu-imports/availability","getFeishuImportAvailability","PR-03","读取项目飞书配置状态","FeishuImportAvailability")
route("post","/projects/{projectId}/feishu-imports","createFeishuImport","PR-03","准备本人私有的飞书文档读取","FeishuImportState","FeishuImportCreate")
route("get","/projects/{projectId}/feishu-imports/{importId}","getFeishuImport","PR-03","恢复本人固定飞书预览","FeishuImportState")
route("post","/projects/{projectId}/feishu-imports/{importId}/advance","advanceFeishuImport","PR-03","继续有界官方导出，不重复未知提交","FeishuImportState","FeishuImportAdvance")
route("post","/projects/{projectId}/feishu-imports/{importId}/confirm","confirmFeishuImport","PR-03","重核源权限并确认同一固定预览","ScriptRevision","FeishuImportConfirm",cas=True)
route("delete","/projects/{projectId}/feishu-imports/{importId}","deleteFeishuImport","PR-03","放弃本人尚未导入的读取",code=204)
route("get","/projects/{projectId}/scripts/{revisionId}","getScriptRevision","PR-03","读取固定剧本正文、阅读表示及规范引用文本","ScriptRevision")
route("get","/projects/{projectId}/scripts/{revisionId}/original","getScriptOriginal","PR-03","按当前项目权限下载固定剧本 Word 原件","ScriptDocumentOriginal")
route("get","/projects/{projectId}/content","getContent","PR-03","读取集场镜与内容版本","ContentTree")
for noun, entity_name, input_name, desc in [("episodes","Episode","EpisodeInput","单集"),("scenes","Scene","SceneInput","场次"),("shots","Shot","ShotInput","镜头")]:
    route("post",f"/projects/{{projectId}}/{noun}","create"+entity_name,"PR-03","创建"+desc,entity_name,input_name,cas=True)
    route("put",f"/projects/{{projectId}}/{noun}/{{objectId}}","update"+entity_name,"PR-03","更新或归档"+desc,entity_name,input_name,cas=True)
route("get","/projects/{projectId}/shots/{shotId}/revisions","listShotRevisions","PR-03","读取镜头要求历史",page("ShotRevision"),listing=True)
route("get","/projects/{projectId}/shots/{shotId}/revisions/{revisionId}","getShotRevision","PR-03","读取固定镜头要求与差异基线","ShotRevision")
route("get","/projects/{projectId}/shot-revisions/{revisionId}","getFixedShotRevision","PR-03","由已保存引用读取固定镜头要求及其真实所属镜头","ShotRevision")
route("post","/projects/{projectId}/content/reorder","reorderContent","PR-03","按完整子集合重排","ContentTree","Reorder",cas=True)
route("get","/projects/{projectId}/proposals","listProposals","PR-04","找回当前项目或场次的新增提案",page("Proposal"),listing=True)
route("get","/projects/{projectId}/proposals/{proposalId}","getProposal","PR-04","读取已生成拆解提案","Proposal")
route("post","/projects/{projectId}/proposals/{proposalId}/apply","applyProposal","PR-04","采纳选定差异，基线冲突拒绝","ContentTree","ApplyProposal",cas=True)
route("get","/assets","listAssets","PR-06","读取授权范围资产",page("Asset"),listing=True,permission="scope_member")
route("post","/assets","createAsset","PR-06","创建设定资产","Asset","AssetInput",permission="project_member_or_shared_admin")
route("get","/assets/{assetId}","getAsset","PR-06","读取资产","Asset",permission="scope_member")
route("patch","/assets/{assetId}","changeAssetMetadata","PR-06","修改资产检索名称、说明与标签","Asset","AssetMetadataChange",cas=True,permission="project_member_or_shared_admin")
route("get","/assets/{assetId}/revisions","listAssetRevisions","PR-06","读取资产固定修订",page("AssetRevision"),listing=True,permission="scope_member")
route("get","/asset-revisions/{revisionId}","getAssetRevision","PR-06","读取确切资产修订，避免加载完整历史","AssetRevision",permission="scope_member")
route("post","/assets/{assetId}/revisions","reviseAsset","PR-06","创建资产修订","AssetRevision","AssetRevisionInput",cas=True,permission="project_member_or_shared_admin")
route("post","/assets/{assetId}/revisions/{revisionId}/confirm","confirmAssetRevision","PR-05","确认设定修订，区别于视频审片","AssetRevision",cas=True,permission="project_lead_or_shared_admin")
route("post","/assets/{assetId}/publish","publishSharedAsset","PR-06","发布指定版本和明确媒体到共享范围","Asset","PublishAsset",permission="owner_admin")
route("post","/assets/{assetId}/archive","archiveAsset","PR-06","归档资产并保留旧引用","Asset",cas=True,permission="project_member_or_shared_admin")
route("get","/assets/{assetId}/usages","getAssetUsages","PR-06","读取有权查看的直接使用位置",page("UsageLocation"),listing=True,permission="scope_member")
route("get","/projects/{projectId}/shared-imports","listSharedImports","PR-06","读取项目已引入的固定共享版本",page("SharedImport"),listing=True)
route("post","/projects/{projectId}/shared-imports","importSharedAsset","PR-06","引入固定共享版本","SharedImport","SharedImportInput")
route("post","/uploads","createUpload","PR-06","创建受限上传意图","UploadIntent","UploadInput",permission="project_member_or_shared_admin")
route("get","/uploads/{uploadId}","getUpload","PR-06","查询上传验收","UploadIntent",permission="scope_member")
route("post","/uploads/{uploadId}/complete","completeUpload","PR-06","开始后端验收与不可变归档","UploadIntent","UploadComplete",code=202,permission="project_member_or_shared_admin")
route("get","/media","listMedia","PR-06","读取素材与生成结果",page("Media"),listing=True,permission="scope_member")
route("get","/media/{mediaId}","getMedia","PR-06","读取媒体元数据","Media",permission="scope_member")
route("post","/media/{mediaId}/access","getMediaAccess","PR-06","签发短时预览或下载地址","AccessGrant","AccessRequest",code=200,permission="scope_member")
route("post","/media/{mediaId}/archive","archiveMedia","PR-06","停止新引用，保留已有使用","Media",cas=True,permission="project_member_or_shared_admin")
route("get","/connections","listConnections","PR-07","读取脱敏连接状态",page("Connection"),listing=True,permission="tenant_member")
route("post","/connections","createConnection","PR-07","登记服务器端模型连接","Connection","ConnectionInput",permission="owner_admin")
route("patch","/connections/{connectionId}","changeConnection","PR-07","轮换凭据或停用连接","Connection","ConnectionChange",cas=True,permission="owner_admin")
route("get","/capabilities","listCapabilities","PR-07","读取已验证模式和输入限制",page("Capability"),listing=True,permission="tenant_member")
route("post","/generation-plans","createGenerationPlan","PR-07","解析实际输入、校验并估计","GenerationPlan","PlanInput",permission="project_member_or_shared_admin")
route("get","/generation-plans/{planId}","getGenerationPlan","PR-07","读取固定生成计划","GenerationPlan",permission="scope_member")
route("post","/generation-jobs","executeGenerationPlan","PR-08","预占预算并排队执行一次计划","GenerationJob","ExecutePlan",code=202,permission="project_member_or_shared_admin")
route("get","/generation-jobs","listGenerationJobs","PR-08","读取作业状态",page("GenerationJob"),listing=True,permission="scope_member")
route("get","/generation-jobs/{jobId}","getGenerationJob","PR-08","读取作业及归档、费用状态","GenerationJob",permission="scope_member")
route("post","/generation-jobs/{jobId}/cancel","cancelGenerationJob","PR-08","请求取消，不承诺退款","GenerationJob",code=202,permission="project_member_or_shared_admin")
route("post","/generation-jobs/{jobId}/recover-archive","recoverJobArchive","PR-08","仅恢复下载归档，不再次生成","GenerationJob",code=202,permission="project_member_or_shared_admin")
route("post","/generation-jobs/{jobId}/reconcile","requestJobReconciliation","PR-15","触发基于原连接的状态与费用核对","GenerationJob",code=202,permission="owner_admin")
route("get","/projects/{projectId}/takes","listTakes","PR-09","读取镜头候选",page("Take"),listing=True)
route("post","/projects/{projectId}/takes","createTake","PR-09","将明确媒体区间关联到镜头","Take","TakeInput")
route("get","/projects/{projectId}/takes/{takeId}","getTake","PR-09","读取固定候选区间与来源","Take")
route("get","/projects/{projectId}/shots/{shotId}/selection","getSelection","PR-09","读取当前采用及镜头修改版本","SelectionState")
schema("SelectedTakeDownloadInput", {"selectionId": ID}, ["selectionId"])
schema("SelectedTakeDownload", {"selectionId": ID, "take": ref("Take"), "media": ref("Media"), "access": ref("AccessGrant")}, ["selectionId", "take", "media", "access"])
route("post","/projects/{projectId}/shots/{shotId}/selection/download","downloadSelectedTake","PR-09","核对当前固定采用后下载完整原视频，候选区间随结果返回","SelectedTakeDownload","SelectedTakeDownloadInput",code=200)
schema("SelectedDeliveryEntry", {"order":POS,"shotId":ID,"shotLabel":NAME,"shotRevisionId":ID,"intent":TEXT,"selectionId":ID,"selectionReason":TEXT,"takeId":ID,"takeNote":TEXT,"mediaId":ID,"fileName":NAME,"originalFileName":NAME,"bytes":POS,"sha256":string(pattern="^[0-9a-f]{64}$"),"range":ref("Range")}, ["order","shotId","shotLabel","shotRevisionId","intent","selectionId","selectionReason","takeId","takeNote","mediaId","fileName","originalFileName","bytes","sha256","range"])
schema("SelectedDeliveryManifest", {"format":enum("scenedesk_selected_originals_v1"),"projectId":ID,"projectName":NAME,"sceneId":ID,"sceneTitle":NAME,"episodeTitle":NAME,"entries":arr(ref("SelectedDeliveryEntry"),minItems=1,maxItems=100),"unselectedCount":INT,"archivedCount":INT,"totalBytes":POS}, ["format","projectId","projectName","sceneId","sceneTitle","episodeTitle","entries","unselectedCount","archivedCount","totalBytes"])
schema("SelectedDeliveryPreview", {"manifest":ref("SelectedDeliveryManifest"),"ticket":string(minLength=1,maxLength=2048),"expiresAt":TIME}, ["manifest","ticket","expiresAt"])
schema("SelectedDeliveryDownload", {"ticket":string(minLength=1,maxLength=2048)}, ["ticket"])
route("get","/projects/{projectId}/scenes/{sceneId}/selected-delivery","previewSelectedDelivery","PR-09","预览本场未归档镜头的固定选用原片交接清单","SelectedDeliveryPreview")
route("post","/projects/{projectId}/scenes/{sceneId}/selected-delivery/download","downloadSelectedDelivery","PR-09","重核权限与预览清单后下载完整原片及顺序区间清单 ZIP",request="SelectedDeliveryDownload",code=200)
delivery_response=paths[PREFIX+"/projects/{projectId}/scenes/{sceneId}/selected-delivery/download"]["post"]["responses"]["200"]
delivery_response["content"]={"application/zip":{"schema":string(format="binary")}}
delivery_response["headers"]={"Content-Disposition":{"schema":string()},"Content-Length":{"schema":INT}}
delivery_operation=paths[PREFIX+"/projects/{projectId}/scenes/{sceneId}/selected-delivery/download"]["post"]
delivery_operation["parameters"]=[p for p in delivery_operation["parameters"] if p.get("$ref")!="#/components/parameters/IdempotencyKey"]
delivery_operation["description"] += " 这是读取原片的下载操作，不创建业务资源，不使用业务创建幂等回执。每次请求重新验证票据、权限与固定清单；票据不代替权限。"
delivery_operation["x-read-only-download"] = True
route("get","/projects/{projectId}/shots/{shotId}/selections","listSelections","PR-09","读取采用与清除历史",page("Selection"),listing=True)
route("put","/projects/{projectId}/shots/{shotId}/selection","selectTake","PR-09","采用候选，不自动改剪辑","Selection","SelectionInput",cas=True)
route("delete","/projects/{projectId}/shots/{shotId}/selection","clearSelection","PR-09","清除当前采用并保留历史","Selection",cas=True)
route("get","/projects/{projectId}/cuts","listCuts","PR-10","列出项目剪辑",page("Cut"),listing=True)
route("post","/projects/{projectId}/cuts","createCut","PR-10","创建剪辑草稿","Cut","CutInput")
route("get","/projects/{projectId}/cuts/{cutId}","getCut","PR-10","读取剪辑草稿","Cut")
route("put","/projects/{projectId}/cuts/{cutId}/draft","saveCutDraft","PR-12","保存明确编排与替换范围","Cut","CutDraftInput",cas=True)
route("post","/projects/{projectId}/cuts/{cutId}/revisions","freezeCut","PR-10","固定剪辑并启动渲染","CutRevision","FreezeCut",code=202,cas=True)
route("get","/projects/{projectId}/cuts/{cutId}/revisions","listCutRevisions","PR-10","读取剪辑固定版本历史",page("CutRevision"),listing=True)
route("get","/projects/{projectId}/cut-revisions/{revisionId}","getCutRevision","PR-10","读取固定版本与渲染状态","CutRevision")
route("post","/projects/{projectId}/cut-revisions/{revisionId}/render","retryRender","PR-10","恢复相同版本渲染","CutRevision",code=202)
route("post","/projects/{projectId}/external-cuts","importExternalCut","PR-13","登记外部成片固定版本","CutRevision","ExternalCutInput")
route("get","/projects/{projectId}/reviews","listReviews","PR-11","列出内部审阅",page("Review"),listing=True)
route("post","/projects/{projectId}/reviews","createReview","PR-11","对确定可播放版本发起审阅","Review","ReviewInput")
route("get","/projects/{projectId}/reviews/{reviewId}","getReview","PR-11","读取审阅与正式决定","Review")
route("get","/projects/{projectId}/reviews/{reviewId}/comments","listComments","PR-11","读取版本上的时间码评论",page("Comment"),listing=True)
route("post","/projects/{projectId}/reviews/{reviewId}/comments","createComment","PR-11","对指定版本添加意见","Comment","CommentInput")
route("patch","/projects/{projectId}/reviews/{reviewId}/comments/{commentId}","changeComment","PR-11","作者编辑文本或有权成员处理意见","Comment","CommentChange",cas=True)
route("post","/projects/{projectId}/reviews/{reviewId}/decision","decideReview","PR-11","形成正式审阅决定","Review","DecisionInput",cas=True,permission="project_lead_or_admin")
route("get","/projects/{projectId}/deliveries","listDeliveries","PR-13","列出工作包及最终交付",page("Delivery"),listing=True)
route("post","/projects/{projectId}/deliveries","createDelivery","PR-13","按固定版本生成工作包或最终交付","Delivery","DeliveryInput",code=202,permission="project_member_working_or_lead_final")
route("get","/projects/{projectId}/deliveries/{deliveryId}","getDelivery","PR-13","读取交付状态与固定清单","Delivery")
route("post","/projects/{projectId}/deliveries/{deliveryId}/recover","recoverDelivery","PR-13","恢复同一交付记录打包，不改变批准与文件版本","Delivery",code=202,permission="project_member_working_or_lead_final")
route("post","/projects/{projectId}/deliveries/{deliveryId}/access","getDeliveryAccess","PR-13","签发授权交付包下载","AccessGrant",code=200)
extend("Task", {"assigneeAvailable": {"type":"boolean","readOnly":True,"description":"受派人当前是否仍为有效项目成员；历史分派不因此消失。"}})
entity("TaskRevision", {"projectId":ID,"taskId":ID,"number":POS,"changedBy":ID,"snapshot":ref("TaskInput")}, ["projectId","taskId","number","changedBy","snapshot"])
route("get","/projects/{projectId}/tasks/{taskId}","getTask","PR-14","读取当前任务及受派人有效资格","Task")
route("get","/projects/{projectId}/tasks/{taskId}/revisions","listTaskRevisions","PR-14","读取不可变分派与处理历史",page("TaskRevision"),listing=True)
route("get","/projects/{projectId}/tasks","listTasks","PR-14","列出基础人工任务",page("Task"),listing=True)
route("post","/projects/{projectId}/tasks","createTask","PR-14","创建内部任务，不改变权限","Task","TaskInput",permission="project_lead_or_admin")
route("patch","/projects/{projectId}/tasks/{taskId}","changeTask","PR-14","更新任务说明或状态","Task","TaskInput",cas=True)
route("get","/budgets","listBudgets","PR-15","读取授权预算与预占",page("Budget"),listing=True,permission="scope_member")
route("post","/budgets","createBudget","PR-15","建立预算周期","Budget","BudgetInput",permission="owner_admin")
route("put","/budgets/{budgetId}","changeBudget","PR-15","修改预算上限，周期不可迁移旧消费","Budget","BudgetInput",cas=True,permission="owner_admin")
route("get","/usage","listUsage","PR-15","读取实际费用和调整记录",page("UsageEntry"),listing=True,permission="scope_member")
route("get","/projects/{projectId}/events","streamProjectEvents","PR-08","接收项目资源变更通知","Event")
route("post","/projects/{projectId}/shot-list-imports","importShotList","PR-03","解析已有分镜CSV为只新增提案","Proposal","ImportShotList",cas=True)
route("get","/connections/{connectionId}/versions","listConnectionVersions","PR-07","读取脱敏账号身份与连接修订",page("ConnectionVersion"),listing=True,permission="owner_admin")
route("patch","/media/{mediaId}","changeMediaMetadata","PR-06","修改素材显示名称、标签及来源说明","Media","MediaMetadataChange",cas=True,permission="project_member_or_shared_admin")
route("post","/media/{mediaId}/derivatives/recover","recoverMediaDerivative","PR-06","仅恢复代理或海报，不生成新原片","Media","RecoverDerivative",code=202,permission="project_member_or_shared_admin")
route("post","/projects/{projectId}/cut-normalizations","normalizeCutDraft","PR-10","解析并固定待确认的有效剪辑边界","NormalizationResult","NormalizationInput",code=202)
route("get","/projects/{projectId}/cut-normalizations/{normalizationId}","getCutNormalization","PR-10","读取归一后的时间线与变化","NormalizationResult")
route("post","/projects/{projectId}/cuts/{cutId}/replacement-previews","previewCutReplacement","PR-12","按明确时长政策预览替换，不修改草稿","NormalizationResult","CutReplacementInput",code=202)
route("put","/projects/{projectId}/proposals/{proposalId}","editProposal","PR-04","保存人工调整的新增提案，保留原始结果","Proposal","ProposalEdit",cas=True)
route("get","/projects/{projectId}/assistance-artifacts","listAssistanceArtifacts","PR-04","找回当前范围的创作建议",page("AssistanceArtifact"),listing=True)
route("get","/projects/{projectId}/assistance-artifacts/{artifactId}","getAssistanceArtifact","PR-04","读取创作建议和固定来源","AssistanceArtifact")
route("put","/projects/{projectId}/assistance-artifacts/{artifactId}","editAssistanceArtifact","PR-04","保存新的人工建议修订","AssistanceArtifact","AssistanceEdit",cas=True)
route("get","/projects/{projectId}/assistance-artifacts/{artifactId}/revisions/{revisionNumber}","getAssistanceRevision","PR-04","读取指定创作建议修订","AssistanceArtifact")
extend("CreativeBasisRevision", {"number": {**POS,"readOnly":True,"description":"同一 subject 的固定依据保存次序，供历史定位；对象 revision 仍为 1。"}, "currentConfirmationId": {**ID,"readOnly":True,"description":"当前 subject 正式指针；确认时作为 expectedCurrentConfirmationId，无指针时省略。"}, "isCurrentSource": {"type":"boolean","readOnly":True,"description":"是否对应当前草稿实际使用的来源；历史快照不因此改变。"}})
extend("CreativeConfirmation", {"note": TEXT})
route("get","/projects/{projectId}/creative-bases","listCreativeBasisRevisions","PR-05","找回已保存但尚未确认的创作依据及历史",page("CreativeBasisRevision"),listing=True)
route("get","/projects/{projectId}/creative-bases/{basisRevisionId}","getCreativeBasisRevision","PR-05","读取稿件实际使用的不可变创作依据","CreativeBasisRevision")
route("get","/projects/{projectId}/creative-confirmations","listCreativeConfirmations","PR-05","读取正式剧情台词与共同设定依据",page("CreativeConfirmation"),listing=True)
route("post","/projects/{projectId}/creative-confirmations","confirmCreativeBasis","PR-05","负责人确认明确版本的创作依据","CreativeConfirmation","ConfirmCreativeBasis",permission="project_lead_or_admin")
event = paths[PREFIX+"/projects/{projectId}/events"]["get"]
event["parameters"].append({"name":"Last-Event-ID","in":"header","schema":string(pattern="^[0-9]+$")})
event["responses"]["200"]["content"]={"text/event-stream":{"schema":string(description="SSE data 是 Event JSON；游标过期发送 reset，客户端刷新快照。")}}

filters = {
    "listAssets": {"scope": SCOPE, "kind": enum("character", "location", "prop", "voice", "style"), "status": enum("active", "archived"), "tag": NAME},
    "listMedia": {"scope": SCOPE, "kind": enum("image", "video", "audio", "document"), "status": enum("processing", "ready", "rejected", "archived"), "sourceJobId": ID},
    "listGenerationJobs": {"scope": SCOPE, "status": enum(*JOB_STATES)},
    "listTakes": {"shotId": ID},
    "listCuts": {"episodeId": ID, "sceneId": ID},
    "listReviews": {"status": enum("open", "approved", "changes_requested"), "cutRevisionId": ID, "takeId": ID},
    "listProposals": {"sceneId": ID, "status": enum("proposed","applied","rejected"), "sourceKind": enum("ai_analysis","csv_import")},
    "listAssistanceArtifacts": {"shotId": ID, "canvasId": ID, "kind": enum("prepare_prompt","prepare_rework","discuss")},
    "listCreativeBasisRevisions": {"subjectId": ID, "kind": enum("script","production","scene","shot_dialogue")},
    "listCreativeConfirmations": {"subjectId": ID},
    "listTasks": {"sceneId": ID, "kind": enum("general","scene_owner","assist","rework"), "assigneeMembershipId": ID, "status": enum("open", "in_progress", "blocked", "done")},
    "listCapabilities": {"connectionId": ID, "purpose": enum("video", "image", "audio", "script_analysis", "creative_assistance")},
}
for methods in paths.values():
    for operation in methods.values():
        if operation["operationId"] == "getProposal":
            operation["parameters"].append({"name":"revisionNumber","in":"query","schema":POS})
        if operation["operationId"] == "getAssistanceRevision":
            next(p for p in operation["parameters"] if p.get("name") == "revisionNumber")["schema"] = POS
        operation["parameters"] += [{"name": name, "in": "query", "schema": value} for name, value in filters.get(operation["operationId"], {}).items()]

register_canvas_routes(route, paths)
register_editing_routes(route, paths)
# A selected canvas draft uses its existing semantic input identity, never an arbitrary note/media node.
S["ContextSourceInput"]["properties"]["kind"]["enum"].append("canvas_draft")
extend("ResolvedInput", {"targetCapabilitySnapshot": ref("Capability"), "targetConnectionVersionId": ID})
extend("AssistanceArtifact", {"executionMode": enum("test_fixture", "verified_provider")})
S["AssistanceBody"]["properties"]["referenceSuggestions"]["maxItems"] = 100
S["AssistanceBody"]["properties"]["retain"]["maxItems"] = 100
S["AssistanceBody"]["properties"]["change"]["maxItems"] = 100
# Prompt preparation has no implicit script excerpt or proposal/advice-source input.
for rule in S["PlanInput"]["allOf"]:
    if rule.get("if", {}).get("properties", {}).get("purpose", {}).get("const") == "creative_assistance":
        rule["then"]["not"]["anyOf"] += [{"required": ["sourceScriptRevisionId"]}, {"required": ["scriptRange"]}]
extend("ResolvedInput", {"capabilitySnapshot": ref("Capability"), "output": ref("OutputOptions")})
# Execution evidence must visibly distinguish explicit fixtures from verified providers.
for entity_name in ["Capability", "GenerationPlan", "GenerationJob"]:
    extend(entity_name, {"executionMode": enum("test_fixture", "verified_provider")})
extend("GenerationJob", {"cancelStatus": enum("not_requested", "requested", "unsupported", "unknown", "confirmed"), "cancelRequestedAt": TIME})
paths[PREFIX+"/generation-jobs"]["get"]["parameters"].append({"name":"planId","in":"query","schema":ID})

document = {"openapi":"3.1.0", "info":{"title":"AI Short Drama Workbench MVP Design Contract","version":"1.3.0","description":"Design-only contract including scene canvas, durable editing work, finite recovery history and presence. Scope, invariants, permissions and recovery behavior are specified in the accompanying implementation documents. No live endpoints or verified model capability are claimed."}, "servers":[{"url":"http://localhost:4310","description":"Planned business API; S0 provides health endpoints only. See engineering readiness report."}], "security":[{"sessionCookie":[]}], "paths":paths, "components":{"securitySchemes":{"sessionCookie":{"type":"apiKey","in":"cookie","name":"session"}},"parameters":{"Csrf":{"name":"X-CSRF-Token","in":"header","required":True,"schema":string()},"IdempotencyKey":{"name":"Idempotency-Key","in":"header","required":True,"schema":string(minLength=16,maxLength=128)},"IfMatch":{"name":"If-Match","in":"header","required":True,"schema":string(pattern='^"[1-9][0-9]*"$'),"description":"对象版本的带引号 ETag；内容集合操作使用 ContentTree.revision。"}},"responses":{"Problem":{"description":"结构化错误，按 code 决定恢复，不自动重放付费创建。","content":{"application/json":{"schema":ref("Error")}}}},"schemas":S}}
(ROOT/"openapi.json").write_text(json.dumps(document,ensure_ascii=False,indent=2)+"\n")
lines=["# API 操作目录（由 build_contract.py 生成）","","完整协议见 [openapi.json](openapi.json)，行为见 [接口规则](06-api-contract.md)。权限标识在接口规则中解释。","","| 需求 | 方法 | 路径 | operationId | 权限 |","|---|---|---|---|---|"]
lines += [f"| {r} | {m} | `{p}` | `{o}` | `{a}` |" for r,m,p,o,a in catalog]
(ROOT/"api-operations.md").write_text("\n".join(lines)+"\n")
print(f"Generated {len(catalog)} operations, {len(paths)} paths, {len(S)} schemas.")
