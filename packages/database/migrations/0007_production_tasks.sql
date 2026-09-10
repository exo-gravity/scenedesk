-- Manual responsibility is independent from worker jobs and review approval.
ALTER TABLE shots ADD CONSTRAINT shots_task_scope UNIQUE (tenant_id,project_id,scene_id,id);
CREATE TABLE production_tasks (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  kind text NOT NULL CHECK (kind IN ('general','scene_owner','assist')),
  assignee_membership_id uuid,
  scene_id uuid,
  shot_id uuid,
  stage text NOT NULL CHECK (stage IN ('planning','assets','generation','editing','review','delivery')),
  status text NOT NULL CHECK (status IN ('open','in_progress','blocked','done')),
  due_at timestamptz,
  note text CHECK (length(note)<=20000),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id) REFERENCES projects(tenant_id,id),
  FOREIGN KEY (tenant_id,assignee_membership_id) REFERENCES memberships(tenant_id,id),
  FOREIGN KEY (tenant_id,project_id,scene_id) REFERENCES scenes(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id,shot_id) REFERENCES shots(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id,scene_id,shot_id) REFERENCES shots(tenant_id,project_id,scene_id,id),
  CHECK (kind<>'scene_owner' OR (scene_id IS NOT NULL AND assignee_membership_id IS NOT NULL AND shot_id IS NULL))
);
-- A completed scene-owner task remains the same responsibility; never create a second one.
CREATE UNIQUE INDEX one_scene_owner_task ON production_tasks(scene_id) WHERE kind='scene_owner';
CREATE INDEX production_tasks_assignee ON production_tasks(tenant_id,project_id,assignee_membership_id,status);
CREATE INDEX production_tasks_scene ON production_tasks(tenant_id,project_id,scene_id);
CREATE TABLE production_task_revisions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  task_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision=1),
  number bigint NOT NULL CHECK (number BETWEEN 1 AND 9007199254740991),
  changed_by uuid NOT NULL REFERENCES users(id),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id,number),
  FOREIGN KEY (tenant_id,project_id,task_id) REFERENCES production_tasks(tenant_id,project_id,id)
);
CREATE TRIGGER task_history_immutable BEFORE UPDATE OR DELETE ON production_task_revisions FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
ALTER TABLE production_tasks ADD CONSTRAINT task_current_history
  FOREIGN KEY (id,revision) REFERENCES production_task_revisions(task_id,number) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION protect_task_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revision<>OLD.revision+1 OR NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.project_id<>OLD.project_id OR NEW.kind<>OLD.kind OR NEW.created_at<>OLD.created_at OR (OLD.kind='scene_owner' AND NEW.scene_id IS DISTINCT FROM OLD.scene_id) THEN
    RAISE EXCEPTION 'Task identity and scene responsibility are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER task_identity_immutable BEFORE UPDATE ON production_tasks FOR EACH ROW EXECUTE FUNCTION protect_task_identity();
REVOKE ALL ON FUNCTION protect_task_identity() FROM PUBLIC;
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['production_tasks','production_task_revisions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY task_scope ON %I USING (project_role(project_id) IS NOT NULL) WITH CHECK (tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL)',t);
  END LOOP;
END $$;
