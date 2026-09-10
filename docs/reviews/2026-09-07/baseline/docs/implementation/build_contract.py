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
schema("CreateProject", {"name": NAME, "leadMembershipId": ID, "spec": ref("Spec")}, ["name", "leadMembershipId", "spec"])
schema("ProjectChange", {"name": NAME, "spec": ref("Spec")}, ["name", "spec"])
schema("LeadChange", {"membershipId": ID}, ["membershipId"])
schema("ProjectMemberChange", {"membershipId": ID}, ["membershipId"])
entity("ProjectMember", {"membershipId": ID, "role": enum("lead", "collaborator")}, ["membershipId", "role"])
entity("Production", {"projectId": ID, "title": NAME, "brief": TEXT, "defaultAssetRevisionIds": arr(ID)}, ["projectId", "title", "brief", "defaultAssetRevisionIds"])
schema("ProductionChange", {"title": NAME, "brief": TEXT, "defaultAssetRevisionIds": arr(ID)}, ["title", "brief", "defaultAssetRevisionIds"])
entity("ScriptRevision", {"projectId": ID, "number": POS, "text": string(maxLength=500000), "parentRevisionId": ID}, ["projectId", "number", "text"])
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
schema("UsageLocation", {"kind": enum("scene", "shot_revision", "plan", "cut_draft", "cut_revision", "asset_revision"), "objectId": ID, "projectId": ID, "label": NAME}, ["kind", "objectId", "label"])
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
entity("Take", {"projectId": ID, "shotId": ID, "shotRevisionId": ID, "mediaId": ID, "range": ref("Range"), "sourceTakeId": ID, "note": TEXT}, ["projectId", "shotId", "shotRevisionId", "mediaId", "range"])
schema("TakeInput", {"shotId": ID, "shotRevisionId": ID, "mediaId": ID, "range": ref("Range"), "sourceTakeId": ID, "note": TEXT}, ["shotId", "shotRevisionId", "mediaId", "range"])
schema("SelectionInput", {"takeId": ID, "reason": TEXT}, ["takeId"])
entity("Selection", {"shotId": ID, "takeId": ID, "selectedBy": ID, "affectedCutIds": arr(ID)}, ["shotId", "selectedBy", "affectedCutIds"])

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
schema("CommentChange", {"body": TEXT, "resolved": BOOL}, [])
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
route("get","/projects/{projectId}/content","getContent","PR-03","读取集场镜与内容版本","ContentTree")
for noun, entity_name, input_name, desc in [("episodes","Episode","EpisodeInput","单集"),("scenes","Scene","SceneInput","场次"),("shots","Shot","ShotInput","镜头")]:
    route("post",f"/projects/{{projectId}}/{noun}","create"+entity_name,"PR-03","创建"+desc,entity_name,input_name,cas=True)
    route("put",f"/projects/{{projectId}}/{noun}/{{objectId}}","update"+entity_name,"PR-03","更新或归档"+desc,entity_name,input_name,cas=True)
route("get","/projects/{projectId}/shots/{shotId}/revisions","listShotRevisions","PR-03","读取镜头要求历史",page("ShotRevision"),listing=True)
route("get","/projects/{projectId}/shots/{shotId}/revisions/{revisionId}","getShotRevision","PR-03","读取固定镜头要求与差异基线","ShotRevision")
route("post","/projects/{projectId}/content/reorder","reorderContent","PR-03","按完整子集合重排","ContentTree","Reorder",cas=True)
route("get","/projects/{projectId}/proposals/{proposalId}","getProposal","PR-04","读取已生成拆解提案","Proposal")
route("post","/projects/{projectId}/proposals/{proposalId}/apply","applyProposal","PR-04","采纳选定差异，基线冲突拒绝","ContentTree","ApplyProposal",cas=True)
route("get","/assets","listAssets","PR-06","读取授权范围资产",page("Asset"),listing=True,permission="scope_member")
route("post","/assets","createAsset","PR-06","创建设定资产","Asset","AssetInput",permission="project_member_or_shared_admin")
route("get","/assets/{assetId}","getAsset","PR-06","读取资产","Asset",permission="scope_member")
route("patch","/assets/{assetId}","changeAssetMetadata","PR-06","修改资产检索名称、说明与标签","Asset","AssetMetadataChange",cas=True,permission="project_member_or_shared_admin")
route("get","/assets/{assetId}/revisions","listAssetRevisions","PR-06","读取资产固定修订",page("AssetRevision"),listing=True,permission="scope_member")
route("post","/assets/{assetId}/revisions","reviseAsset","PR-06","创建资产修订","AssetRevision","AssetRevisionInput",cas=True,permission="project_member_or_shared_admin")
route("post","/assets/{assetId}/revisions/{revisionId}/confirm","confirmAssetRevision","PR-05","确认设定修订，区别于视频审片","AssetRevision",cas=True,permission="project_lead_or_shared_admin")
route("post","/assets/{assetId}/publish","publishSharedAsset","PR-06","发布指定版本和明确媒体到共享范围","Asset","PublishAsset",permission="owner_admin")
route("post","/assets/{assetId}/archive","archiveAsset","PR-06","归档资产并保留旧引用","Asset",cas=True,permission="project_member_or_shared_admin")
route("get","/assets/{assetId}/usages","getAssetUsages","PR-06","读取有权查看的直接使用位置",page("UsageLocation"),listing=True,permission="scope_member")
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
route("get","/projects/{projectId}/tasks","listTasks","PR-14","列出基础人工任务",page("Task"),listing=True)
route("post","/projects/{projectId}/tasks","createTask","PR-14","创建内部任务，不改变权限","Task","TaskInput",permission="project_lead_or_admin")
route("patch","/projects/{projectId}/tasks/{taskId}","changeTask","PR-14","更新任务说明或状态","Task","TaskInput",cas=True)
route("get","/budgets","listBudgets","PR-15","读取授权预算与预占",page("Budget"),listing=True,permission="scope_member")
route("post","/budgets","createBudget","PR-15","建立预算周期","Budget","BudgetInput",permission="owner_admin")
route("put","/budgets/{budgetId}","changeBudget","PR-15","修改预算上限，周期不可迁移旧消费","Budget","BudgetInput",cas=True,permission="owner_admin")
route("get","/usage","listUsage","PR-15","读取实际费用和调整记录",page("UsageEntry"),listing=True,permission="scope_member")
route("get","/projects/{projectId}/events","streamProjectEvents","PR-08","接收项目资源变更通知","Event")
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
    "listTasks": {"assigneeMembershipId": ID, "status": enum("open", "in_progress", "blocked", "done")},
    "listCapabilities": {"connectionId": ID, "purpose": enum("video", "image", "audio", "script_analysis")},
}
for methods in paths.values():
    for operation in methods.values():
        operation["parameters"] += [{"name": name, "in": "query", "schema": value} for name, value in filters.get(operation["operationId"], {}).items()]

document = {"openapi":"3.1.0", "info":{"title":"AI Short Drama Workbench MVP Design Contract","version":"0.1.0","description":"Design-only contract. Scope, invariants, permissions and recovery behavior are specified in the accompanying implementation documents. No live endpoints or verified model capability are claimed."}, "servers":[{"url":"http://localhost:3000","description":"Proposed local API address; not a running service"}], "security":[{"sessionCookie":[]}], "paths":paths, "components":{"securitySchemes":{"sessionCookie":{"type":"apiKey","in":"cookie","name":"session"}},"parameters":{"Csrf":{"name":"X-CSRF-Token","in":"header","required":True,"schema":string()},"IdempotencyKey":{"name":"Idempotency-Key","in":"header","required":True,"schema":string(minLength=16,maxLength=128)},"IfMatch":{"name":"If-Match","in":"header","required":True,"schema":string(pattern='^"[1-9][0-9]*"$'),"description":"对象版本的带引号 ETag；内容集合操作使用 ContentTree.revision。"}},"responses":{"Problem":{"description":"结构化错误，按 code 决定恢复，不自动重放付费创建。","content":{"application/json":{"schema":ref("Error")}}}},"schemas":S}}
(ROOT/"openapi.json").write_text(json.dumps(document,ensure_ascii=False,indent=2)+"\n")
lines=["# API 操作目录（由 build_contract.py 生成）","","完整协议见 [openapi.json](openapi.json)，行为见 [接口规则](06-api-contract.md)。权限标识在接口规则中解释。","","| 需求 | 方法 | 路径 | operationId | 权限 |","|---|---|---|---|---|"]
lines += [f"| {r} | {m} | `{p}` | `{o}` | `{a}` |" for r,m,p,o,a in catalog]
(ROOT/"api-operations.md").write_text("\n".join(lines)+"\n")
print(f"Generated {len(catalog)} operations, {len(paths)} paths, {len(S)} schemas.")
