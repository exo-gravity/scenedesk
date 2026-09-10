CREATE TABLE script_revisions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  number bigint NOT NULL CHECK (number BETWEEN 1 AND 9007199254740991),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision = 1),
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 500000),
  parent_revision_id uuid,
  source_format text NOT NULL DEFAULT 'plain_text' CHECK (source_format = 'plain_text'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  FOREIGN KEY (tenant_id, project_id, parent_revision_id) REFERENCES script_revisions(tenant_id, project_id, id)
);
ALTER TABLE project_content_versions ADD CONSTRAINT content_script_scope
  FOREIGN KEY (tenant_id, project_id, current_script_revision_id) REFERENCES script_revisions(tenant_id, project_id, id);

CREATE TABLE episodes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  position bigint NOT NULL CHECK (position BETWEEN 0 AND 9007199254740991),
  status text NOT NULL CHECK (status IN ('active','archived')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);
CREATE INDEX episodes_order ON episodes(tenant_id, project_id, position, id);
CREATE TABLE scenes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  episode_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  position bigint NOT NULL CHECK (position BETWEEN 0 AND 9007199254740991),
  time_label text CHECK (length(time_label) BETWEEN 1 AND 160),
  location_label text CHECK (length(location_label) BETWEEN 1 AND 160),
  summary text NOT NULL CHECK (length(summary) <= 20000),
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  default_asset_revision_ids jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(default_asset_revision_ids) = 'array'),
  status text NOT NULL CHECK (status IN ('active','archived')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, episode_id) REFERENCES episodes(tenant_id, project_id, id)
);
CREATE INDEX scenes_order ON scenes(tenant_id, project_id, episode_id, position, id);
CREATE TABLE shots (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  scene_id uuid NOT NULL,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 160),
  position bigint NOT NULL CHECK (position BETWEEN 0 AND 9007199254740991),
  current_revision_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('active','archived')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, scene_id) REFERENCES scenes(tenant_id, project_id, id)
);
CREATE INDEX shots_order ON shots(tenant_id, project_id, scene_id, position, id);
CREATE TABLE shot_revisions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  shot_id uuid NOT NULL,
  number bigint NOT NULL CHECK (number BETWEEN 1 AND 9007199254740991),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision = 1),
  spec jsonb NOT NULL CHECK (jsonb_typeof(spec) = 'object'),
  source_script_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shot_id, number),
  UNIQUE (tenant_id, project_id, id),
  UNIQUE (tenant_id, project_id, shot_id, id),
  FOREIGN KEY (tenant_id, project_id, shot_id) REFERENCES shots(tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, source_script_revision_id) REFERENCES script_revisions(tenant_id, project_id, id)
);
ALTER TABLE shots ADD CONSTRAINT shot_current_revision_scope
  FOREIGN KEY (tenant_id, project_id, id, current_revision_id) REFERENCES shot_revisions(tenant_id, project_id, shot_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE shot_source_shots (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  shot_revision_id uuid NOT NULL,
  source_shot_id uuid NOT NULL,
  PRIMARY KEY (shot_revision_id, source_shot_id),
  FOREIGN KEY (tenant_id, project_id, shot_revision_id) REFERENCES shot_revisions(tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, source_shot_id) REFERENCES shots(tenant_id, project_id, id)
);
CREATE TABLE shot_source_scripts (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  shot_revision_id uuid NOT NULL,
  script_revision_id uuid NOT NULL,
  PRIMARY KEY (shot_revision_id, script_revision_id),
  FOREIGN KEY (tenant_id, project_id, shot_revision_id) REFERENCES shot_revisions(tenant_id, project_id, id),
  FOREIGN KEY (tenant_id, project_id, script_revision_id) REFERENCES script_revisions(tenant_id, project_id, id)
);
CREATE TABLE dialogue_lines (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  shot_revision_id uuid NOT NULL,
  dialogue_id uuid NOT NULL,
  text text NOT NULL CHECK (length(text) <= 20000),
  performance text CHECK (length(performance) <= 20000),
  source_excerpt jsonb,
  source_dialogue_id uuid,
  PRIMARY KEY (shot_revision_id, dialogue_id),
  UNIQUE (tenant_id, project_id, shot_revision_id, dialogue_id),
  FOREIGN KEY (tenant_id, project_id, shot_revision_id) REFERENCES shot_revisions(tenant_id, project_id, id)
);
CREATE INDEX dialogue_identity ON dialogue_lines(tenant_id, project_id, dialogue_id);

CREATE FUNCTION protect_content_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  RAISE EXCEPTION 'Content revisions and their source projections are immutable' USING ERRCODE = '23514';
END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['script_revisions','shot_revisions','shot_source_shots','shot_source_scripts','dialogue_lines'] LOOP
    EXECUTE format('CREATE TRIGGER content_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION protect_content_revision()',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['script_revisions','episodes','scenes','shots','shot_revisions','shot_source_shots','shot_source_scripts','dialogue_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY project_content_scope ON %I USING (project_role(project_id) IS NOT NULL) WITH CHECK (tenant_id = tenant_scope() AND project_role(project_id) IS NOT NULL)',t);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION protect_content_revision() FROM PUBLIC;
