-- A project canvas is explicit and unique. Scene canvases keep their original identity.
CREATE TABLE project_canvas_links (
 tenant_id uuid NOT NULL, project_id uuid PRIMARY KEY, canvas_id uuid NOT NULL UNIQUE,
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,project_id,canvas_id) REFERENCES canvases(tenant_id,project_id,id)
);
CREATE FUNCTION validate_project_canvas_link() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 PERFORM id FROM canvases WHERE id=NEW.canvas_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM projects WHERE tenant_id=NEW.tenant_id AND id=NEW.project_id AND status='active')
 OR EXISTS(SELECT 1 FROM scene_canvas_links WHERE canvas_id=NEW.canvas_id)
 THEN RAISE EXCEPTION 'Project canvas requires an active project and independent canvas' USING ERRCODE='P0425';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_canvas_valid BEFORE INSERT ON project_canvas_links FOR EACH ROW EXECUTE FUNCTION validate_project_canvas_link();
CREATE TRIGGER project_canvas_fixed BEFORE UPDATE OR DELETE ON project_canvas_links FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
CREATE OR REPLACE FUNCTION validate_scene_canvas_link() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 PERFORM id FROM canvases WHERE id=NEW.canvas_id FOR UPDATE;
 PERFORM 1 FROM scenes WHERE id=NEW.scene_id AND tenant_id=NEW.tenant_id AND project_id=NEW.project_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM scenes s JOIN episodes e ON e.id=s.episode_id WHERE s.id=NEW.scene_id AND s.status='active' AND e.status='active')
 OR EXISTS(SELECT 1 FROM project_canvas_links WHERE canvas_id=NEW.canvas_id)
 THEN RAISE EXCEPTION 'Cannot bind archived content or a project canvas' USING ERRCODE='P0425';END IF;
 RETURN NEW;
END $$;
CREATE TABLE project_workspace_preferences (
 tenant_id uuid NOT NULL, project_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
 revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 preference jsonb NOT NULL CHECK(octet_length(preference::text)<=262144),
 PRIMARY KEY(user_id,project_id), FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
CREATE FUNCTION validate_project_preference() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE p jsonb:=NEW.preference;
BEGIN
 IF NEW.user_id IS DISTINCT FROM actor_id() OR (TG_OP='INSERT' AND NEW.revision<>1)
 OR (TG_OP='UPDATE' AND ((NEW.tenant_id,NEW.project_id,NEW.user_id) IS DISTINCT FROM (OLD.tenant_id,OLD.project_id,OLD.user_id) OR NEW.revision<>OLD.revision+1))
 THEN RAISE EXCEPTION 'Private preference version conflict' USING ERRCODE='P0412';END IF;
 IF (jsonb_typeof(p)='object' AND p->>'mode'='canvas' AND p->'selectedShotId'='null'::jsonb
 AND jsonb_typeof(p->'selectedNodeIds')='array' AND jsonb_array_length(p->'selectedNodeIds')<=2000
 AND jsonb_typeof(p->'assetPanelOpen')='boolean' AND jsonb_typeof(p->'assistantOpen')='boolean'
 AND jsonb_typeof(p->'viewport')='object' AND (p->'viewport'->>'zoom')::numeric BETWEEN 0.00001 AND 4
 AND (p->'viewport'->>'x')::numeric BETWEEN -8000000 AND 8000000 AND (p->'viewport'->>'y')::numeric BETWEEN -8000000 AND 8000000
 AND (p-ARRAY['mode','selectedShotId','selectedNodeIds','viewport','assetPanelOpen','assistantOpen'])='{}') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Invalid project preference' USING ERRCODE='P0425';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_preference_valid BEFORE INSERT OR UPDATE ON project_workspace_preferences FOR EACH ROW EXECUTE FUNCTION validate_project_preference();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['project_canvas_links','project_workspace_preferences'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY project_canvas_scope ON %I USING(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL) WITH CHECK(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL)',t);
 END LOOP;
END $$;
CREATE POLICY own_project_preference ON project_workspace_preferences AS RESTRICTIVE USING(user_id=actor_id()) WITH CHECK(user_id=actor_id());
ALTER TABLE generation_assistance_scopes ALTER COLUMN scene_id DROP NOT NULL;
CREATE OR REPLACE FUNCTION discussion_canvas_scope(t uuid,p uuid,canvas uuid,current_only boolean) RETURNS jsonb LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT CASE WHEN l.scene_id IS NOT NULL THEN jsonb_build_object('canvasId',c.id,'sceneId',l.scene_id)
 ELSE jsonb_build_object('canvasId',c.id,'projectId',c.project_id) END
 FROM canvases c JOIN projects project ON project.id=c.project_id
 LEFT JOIN scene_canvas_links l ON l.canvas_id=c.id LEFT JOIN scenes s ON s.id=l.scene_id LEFT JOIN episodes e ON e.id=s.episode_id
 LEFT JOIN project_canvas_links pl ON pl.canvas_id=c.id
 WHERE c.tenant_id=t AND c.project_id=p AND c.id=canvas AND (l.scene_id IS NOT NULL OR pl.project_id IS NOT NULL)
 AND (NOT current_only OR (project.status='active' AND (pl.project_id IS NOT NULL OR (s.status='active' AND e.status='active'))))
$$;
CREATE OR REPLACE FUNCTION guard_discussion_scope() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM generation_plans p WHERE p.id=NEW.plan_id AND p.tenant_id=NEW.tenant_id AND p.project_id=NEW.project_id
 AND p.input->'assistance'->>'kind'='discuss'
 AND p.resolved_input->'canvasScope'=CASE WHEN NEW.scene_id IS NOT NULL THEN jsonb_build_object('canvasId',NEW.canvas_id,'sceneId',NEW.scene_id) ELSE jsonb_build_object('canvasId',NEW.canvas_id,'projectId',NEW.project_id) END
 AND discussion_canvas_scope(NEW.tenant_id,NEW.project_id,NEW.canvas_id,true)=p.resolved_input->'canvasScope')
 THEN RAISE EXCEPTION 'Discussion scope must preserve the validated real canvas' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION canvas_assistance_snapshot(t uuid,p uuid,source jsonb,check_version boolean) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
DECLARE c canvases; node jsonb; contents jsonb;
BEGIN
 SELECT canvas.* INTO c FROM canvases canvas WHERE canvas.tenant_id=t AND canvas.project_id=p
 AND canvas.id=(source->>'canvasId')::uuid AND discussion_canvas_scope(t,p,canvas.id,true) IS NOT NULL;
 IF c.id IS NULL OR (check_version AND c.revision<>(source->>'canvasRevision')::bigint) THEN RETURN NULL;END IF;
 SELECT n INTO node FROM canvas_revisions r JOIN canvas_history_bodies b ON b.canvas_id=r.canvas_id AND b.hash=r.body_hash CROSS JOIN LATERAL jsonb_array_elements(b.document->'nodes') n
 WHERE r.canvas_id=c.id AND r.revision=c.revision AND (n->>'id')::uuid=(source->>'nodeId')::uuid;
 IF node IS NULL OR (node->'content'->>'type'='media' AND (NOT source ? 'purpose' OR source->>'purpose' NOT IN ('identity','look','location','action','composition','style','voice','start_frame','end_frame','prop')))
 OR (node->'content'->>'type'<>'media' AND source ? 'purpose') THEN RETURN NULL;END IF;
 contents:=jsonb_build_object('kind',node->'kind','content',node->'content');
 RETURN contents || jsonb_build_object('source',source,'contentHash',encode(sha256(convert_to(creative_canonical(contents),'UTF8')),'hex'));
END $$;

REVOKE ALL ON FUNCTION validate_project_canvas_link(),validate_scene_canvas_link(),validate_project_preference(),discussion_canvas_scope(uuid,uuid,uuid,boolean),guard_discussion_scope(),canvas_assistance_snapshot(uuid,uuid,jsonb,boolean) FROM PUBLIC;
