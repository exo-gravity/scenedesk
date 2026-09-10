CREATE TABLE analysis_proposals (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  source_kind text NOT NULL CHECK (source_kind = 'csv_import'),
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  source_csv_text text NOT NULL CHECK (length(source_csv_text) BETWEEN 1 AND 500000),
  import_fingerprint text NOT NULL CHECK (import_fingerprint ~ '^[0-9a-f]{64}$'),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','applied','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,project_id,id),
  UNIQUE (project_id,import_fingerprint),
  FOREIGN KEY (tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
CREATE TABLE analysis_proposal_revisions (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  number bigint NOT NULL CHECK (number BETWEEN 1 AND 9007199254740991),
  base_content_revision bigint NOT NULL CHECK (base_content_revision BETWEEN 1 AND 9007199254740991),
  base_content_snapshot jsonb NOT NULL CHECK (jsonb_typeof(base_content_snapshot) = 'object' AND (base_content_snapshot->>'revision')::bigint = base_content_revision),
  target jsonb NOT NULL CHECK (target ? 'mode' AND target->>'mode' IN ('new_structure','append_to_scene')),
  target_scene_id uuid,
  target_episode_id uuid,
  operations jsonb NOT NULL CHECK (jsonb_typeof(operations) = 'array' AND jsonb_array_length(operations) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (proposal_id,number),
  UNIQUE (tenant_id,project_id,proposal_id,number),
  FOREIGN KEY (tenant_id,project_id,proposal_id) REFERENCES analysis_proposals(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id,target_scene_id) REFERENCES scenes(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id,target_episode_id) REFERENCES episodes(tenant_id,project_id,id),
  CHECK ((target->>'mode' = 'new_structure' AND target_scene_id IS NULL AND target_episode_id IS NULL)
    OR (target->>'mode' = 'append_to_scene' AND target_scene_id IS NOT NULL AND target_episode_id IS NOT NULL
      AND target ?& ARRAY['sceneId','episodeId','sceneRevision'] AND (target->>'sceneRevision')::bigint BETWEEN 1 AND 9007199254740991
      AND (target->>'sceneId')::uuid = target_scene_id AND (target->>'episodeId')::uuid = target_episode_id))
);
ALTER TABLE analysis_proposals ADD CONSTRAINT proposal_current_revision
  FOREIGN KEY (tenant_id,project_id,id,revision) REFERENCES analysis_proposal_revisions(tenant_id,project_id,proposal_id,number)
  DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX proposal_target_scene ON analysis_proposal_revisions(tenant_id,project_id,target_scene_id);
CREATE TABLE proposal_applications (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  proposal_id uuid PRIMARY KEY,
  proposal_revision bigint NOT NULL,
  selected_operation_ids jsonb NOT NULL CHECK (jsonb_typeof(selected_operation_ids) = 'array'),
  created_objects jsonb NOT NULL CHECK (jsonb_typeof(created_objects) = 'object'),
  content_revision bigint NOT NULL CHECK (content_revision BETWEEN 1 AND 9007199254740991),
  applied_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,project_id,proposal_id,proposal_revision) REFERENCES analysis_proposal_revisions(tenant_id,project_id,proposal_id,number)
);
CREATE TRIGGER proposal_revision_immutable BEFORE UPDATE OR DELETE ON analysis_proposal_revisions
  FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
CREATE TRIGGER proposal_application_immutable BEFORE UPDATE OR DELETE ON proposal_applications
  FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['analysis_proposals','analysis_proposal_revisions','proposal_applications'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY proposal_scope ON %I USING (project_role(project_id) IS NOT NULL) WITH CHECK (tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL)',t);
  END LOOP;
END $$;

CREATE FUNCTION protect_proposal_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_kind IS DISTINCT FROM OLD.source_kind OR NEW.source_hash IS DISTINCT FROM OLD.source_hash
    OR NEW.source_csv_text IS DISTINCT FROM OLD.source_csv_text OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Proposal source is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status <> 'proposed' OR (NEW.revision <> OLD.revision AND NEW.revision <> OLD.revision+1) THEN
    RAISE EXCEPTION 'Proposal history or lifecycle cannot be rewritten' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION protect_proposal_source() FROM PUBLIC;
CREATE TRIGGER proposal_source_immutable BEFORE UPDATE ON analysis_proposals
  FOR EACH ROW EXECUTE FUNCTION protect_proposal_source();
