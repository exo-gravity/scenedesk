CREATE TABLE generation_canvas_results (
 tenant_id uuid NOT NULL,project_id uuid NOT NULL,canvas_id uuid NOT NULL,job_id uuid NOT NULL,media_id uuid NOT NULL,node_id uuid NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(canvas_id,job_id,media_id),FOREIGN KEY(tenant_id,project_id,canvas_id,node_id) REFERENCES canvas_node_index(tenant_id,project_id,canvas_id,node_id),FOREIGN KEY(tenant_id,project_id,job_id) REFERENCES generation_jobs(tenant_id,project_id,id),FOREIGN KEY(tenant_id,project_id,media_id) REFERENCES media(tenant_id,project_id,id)
);
ALTER TABLE generation_canvas_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_canvas_results FORCE ROW LEVEL SECURITY;
CREATE POLICY canvas_generation_result_scope ON generation_canvas_results USING(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL) WITH CHECK(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL);
CREATE TRIGGER canvas_generation_result_immutable BEFORE UPDATE OR DELETE ON generation_canvas_results FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
CREATE FUNCTION validate_canvas_generation_result() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM generation_jobs j JOIN generation_canvas_origins o ON o.plan_id=j.plan_id JOIN media m ON m.source_job_id=j.id JOIN canvas_node_index n ON n.node_id=NEW.node_id WHERE j.id=NEW.job_id AND j.status='succeeded' AND o.canvas_id=NEW.canvas_id AND m.id=NEW.media_id AND m.status='ready' AND n.canvas_id=NEW.canvas_id AND n.media_id=m.id AND n.content_type='media') THEN RAISE EXCEPTION 'Canvas result must preserve actual generation identity' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER canvas_generation_result_identity BEFORE INSERT ON generation_canvas_results FOR EACH ROW EXECUTE FUNCTION validate_canvas_generation_result();
REVOKE ALL ON FUNCTION validate_canvas_generation_result() FROM PUBLIC;
