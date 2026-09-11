-- Separate generated output provenance from user uploads; no capability is enabled here.
ALTER TABLE generation_plans DROP CONSTRAINT generation_plans_check;
ALTER TABLE generation_plans DROP CONSTRAINT generation_plans_input_check;
ALTER TABLE generation_plans DROP CONSTRAINT generation_plans_input_check1;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='generation_plans'::regclass AND conname='generation_plans_ready_cost_check') THEN ALTER TABLE generation_plans ADD CONSTRAINT generation_plans_ready_cost_check CHECK(status<>'ready' OR (cost_estimate IS NOT NULL AND blocking_reasons='[]'));END IF;END $$;
ALTER TABLE generation_plans ADD CHECK((input->>'scope'='project' AND (input->>'projectId')::uuid=project_id AND input->>'purpose' IN ('script_analysis','creative_assistance','image')) IS TRUE);
ALTER TABLE generation_plans ADD CHECK(((input->>'purpose'='script_analysis' AND input->'proposalTarget'->>'mode'='append_to_scene') OR (input->>'purpose'='creative_assistance' AND input->'assistance'->>'kind'='prepare_prompt' AND jsonb_array_length(input->'shotSources') BETWEEN 1 AND 100) OR (input->>'purpose'='image')) IS TRUE);
ALTER TABLE generation_plans ADD COLUMN assistance_artifact_id uuid GENERATED ALWAYS AS ((input->'assistanceSource'->>'artifactId')::uuid) STORED;
ALTER TABLE generation_plans ADD COLUMN assistance_artifact_revision bigint GENERATED ALWAYS AS ((input->'assistanceSource'->>'revision')::bigint) STORED;
ALTER TABLE generation_plans ADD FOREIGN KEY(tenant_id,project_id,assistance_artifact_id,assistance_artifact_revision) REFERENCES assistance_artifact_revisions(tenant_id,project_id,artifact_id,number);
ALTER TABLE media ALTER COLUMN source_upload_id DROP NOT NULL;
ALTER TABLE media ADD COLUMN source_job_id uuid;
ALTER TABLE media ADD FOREIGN KEY(tenant_id,project_id,source_job_id) REFERENCES generation_jobs(tenant_id,project_id,id);
ALTER TABLE media ADD CHECK(num_nonnulls(source_upload_id,source_job_id)=1);
CREATE UNIQUE INDEX media_single_image_job ON media(source_job_id) WHERE source_job_id IS NOT NULL;
ALTER TABLE generation_jobs ADD COLUMN result_media_id uuid;
ALTER TABLE generation_jobs ADD FOREIGN KEY(tenant_id,project_id,result_media_id) REFERENCES media(tenant_id,project_id,id);
ALTER TABLE generation_jobs DROP CONSTRAINT generation_jobs_status_check;
ALTER TABLE generation_jobs ADD CHECK(status IN ('queued','dispatching','submission_unknown','archiving','archive_failed','succeeded','failed','cancelled','reconciliation_required'));
ALTER TABLE generation_jobs DROP CONSTRAINT generation_jobs_check;
ALTER TABLE generation_jobs ADD CHECK((status='succeeded' AND num_nonnulls(proposal_id,assistance_artifact_id,result_media_id)=1) OR (status='reconciliation_required' AND num_nonnulls(proposal_id,assistance_artifact_id,result_media_id)<=1) OR (status NOT IN ('succeeded','reconciliation_required') AND num_nonnulls(proposal_id,assistance_artifact_id,result_media_id)=0));
CREATE TABLE generation_media_outputs (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,project_id uuid NOT NULL,job_id uuid NOT NULL UNIQUE,media_id uuid NOT NULL UNIQUE,evidence_id uuid NOT NULL REFERENCES generation_submission_evidence(id),
 source jsonb NOT NULL CHECK(source->>'kind'='fixture_object' AND source->'object'->>'key' ~ '^(staging|originals)/[a-f0-9-]{36}$' AND source->>'sha256' ~ '^[a-f0-9]{64}$' AND source->>'mime' IN ('image/png','image/jpeg','image/webp') AND (source->'object'->>'bytes')::bigint BETWEEN 1 AND 268435456 AND length(source->'object'->>'versionId') BETWEEN 1 AND 1024 AND source->'object'->>'versionId'<>'null'),
 output_options jsonb NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','accepted','failed','rejected')),
 step_revision bigint NOT NULL DEFAULT 1 CHECK(step_revision>0),epoch bigint NOT NULL CHECK(epoch>0),processing_attempts integer NOT NULL DEFAULT 0 CHECK(processing_attempts BETWEEN 0 AND 6),
 lease_token uuid,lease_expires_at timestamptz,issue jsonb,revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,project_id,id),FOREIGN KEY(tenant_id,project_id,job_id) REFERENCES generation_jobs(tenant_id,project_id,id),FOREIGN KEY(tenant_id,project_id,media_id) REFERENCES media(tenant_id,project_id,id)
);
CREATE INDEX generation_media_repair ON generation_media_outputs(status,updated_at,id);
CREATE TABLE generation_canvas_origins (
 tenant_id uuid NOT NULL,project_id uuid NOT NULL,plan_id uuid PRIMARY KEY,canvas_id uuid NOT NULL,node_id uuid NOT NULL,canvas_revision bigint NOT NULL CHECK(canvas_revision>0),input_fingerprint text NOT NULL CHECK(input_fingerprint ~ '^[a-f0-9]{64}$'),source_node_ids uuid[] NOT NULL,
 FOREIGN KEY(tenant_id,project_id,plan_id) REFERENCES generation_plans(tenant_id,project_id,id),FOREIGN KEY(tenant_id,project_id,canvas_id) REFERENCES canvases(tenant_id,project_id,id),FOREIGN KEY(tenant_id,project_id,canvas_id,node_id) REFERENCES canvas_node_index(tenant_id,project_id,canvas_id,node_id)
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['generation_media_outputs','generation_canvas_origins'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);EXECUTE format('CREATE POLICY generation_source_read ON %I FOR SELECT USING(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL)',t);END LOOP; END $$;
CREATE POLICY generation_origin_insert ON generation_canvas_origins FOR INSERT WITH CHECK(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL);
CREATE TRIGGER generation_canvas_origin_immutable BEFORE UPDATE OR DELETE ON generation_canvas_origins FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
CREATE FUNCTION guard_generation_media_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT generation_worker_login() OR NOT EXISTS(SELECT 1 FROM generation_jobs j JOIN generation_plans p ON p.id=j.plan_id JOIN media m ON m.source_job_id=j.id JOIN generation_submission_evidence e ON e.id=NEW.evidence_id JOIN generation_attempts a ON a.id=e.attempt_id AND a.job_id=j.id WHERE j.id=NEW.job_id AND j.tenant_id=NEW.tenant_id AND j.project_id=NEW.project_id AND m.id=NEW.media_id AND p.input->>'purpose'='image' AND NEW.source=e.body->'output'->'images'->0 AND NEW.output_options=p.resolved_input->'output') THEN RAISE EXCEPTION 'Image source requires original attempt evidence' USING ERRCODE='23514';END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','step_revision','epoch','processing_attempts','lease_token','lease_expires_at','issue','revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','step_revision','epoch','processing_attempts','lease_token','lease_expires_at','issue','revision','updated_at']) OR NEW.revision<>OLD.revision+1 OR OLD.status='accepted' THEN RAISE EXCEPTION 'Fixed generation output source is immutable' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER generation_output_source_fixed BEFORE INSERT OR UPDATE ON generation_media_outputs FOR EACH ROW EXECUTE FUNCTION guard_generation_media_source();
REVOKE ALL ON FUNCTION guard_generation_media_source() FROM PUBLIC;
