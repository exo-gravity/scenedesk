CREATE TABLE creative_subjects (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('script','production','scene','shot_dialogue')),
  script_project_id uuid,
  production_id uuid,
  scene_id uuid,
  shot_id uuid,
  UNIQUE (tenant_id,project_id,id,kind),
  FOREIGN KEY (tenant_id,project_id) REFERENCES projects(tenant_id,id),
  FOREIGN KEY (tenant_id,script_project_id) REFERENCES projects(tenant_id,id),
  FOREIGN KEY (tenant_id,project_id,production_id) REFERENCES productions(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id,scene_id) REFERENCES scenes(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id,shot_id) REFERENCES shots(tenant_id,project_id,id),
  CHECK (num_nonnulls(script_project_id,production_id,scene_id,shot_id)=1),
  CHECK (((kind='script' AND script_project_id=id AND id=project_id)
    OR (kind='production' AND production_id=id) OR (kind='scene' AND scene_id=id)
    OR (kind='shot_dialogue' AND shot_id=id)) IS TRUE)
);
CREATE TABLE creative_basis_revisions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  kind text NOT NULL,
  ordinal bigint NOT NULL CHECK (ordinal BETWEEN 1 AND 9007199254740991),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision=1),
  source_revision bigint NOT NULL CHECK (source_revision BETWEEN 1 AND 9007199254740991),
  script_revision_id uuid,
  production_id uuid,
  scene_id uuid,
  shot_revision_id uuid,
  snapshot jsonb NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  hash_version text NOT NULL CHECK (hash_version='creative-v1'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,project_id,id),
  UNIQUE (tenant_id,project_id,subject_id,kind,id),
  UNIQUE (subject_id,ordinal),
  FOREIGN KEY (tenant_id,project_id,subject_id,kind) REFERENCES creative_subjects(tenant_id,project_id,id,kind),
  FOREIGN KEY (tenant_id,project_id,script_revision_id) REFERENCES script_revisions(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id,production_id) REFERENCES productions(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id,scene_id) REFERENCES scenes(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id,subject_id,shot_revision_id) REFERENCES shot_revisions(tenant_id,project_id,shot_id,id),
  CHECK (num_nonnulls(script_revision_id,production_id,scene_id,shot_revision_id)=1),
  CHECK (((kind='script' AND script_revision_id IS NOT NULL AND subject_id=project_id)
    OR (kind='production' AND production_id=subject_id) OR (kind='scene' AND scene_id=subject_id)
    OR (kind='shot_dialogue' AND shot_revision_id IS NOT NULL)) IS TRUE),
  CHECK ((jsonb_typeof(snapshot)='object' AND snapshot ? 'kind' AND snapshot->>'kind'=kind) IS TRUE)
);
CREATE UNIQUE INDEX creative_script_source ON creative_basis_revisions(script_revision_id) WHERE script_revision_id IS NOT NULL;
CREATE UNIQUE INDEX creative_production_source ON creative_basis_revisions(production_id,source_revision) WHERE production_id IS NOT NULL;
CREATE UNIQUE INDEX creative_scene_source ON creative_basis_revisions(scene_id,source_revision) WHERE scene_id IS NOT NULL;
CREATE UNIQUE INDEX creative_shot_source ON creative_basis_revisions(shot_revision_id) WHERE shot_revision_id IS NOT NULL;
CREATE INDEX creative_semantic_content ON creative_basis_revisions(tenant_id,project_id,kind,hash_version,content_hash);
CREATE TABLE creative_confirmations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  kind text NOT NULL,
  basis_revision_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision=1),
  usage text NOT NULL CHECK (usage='project_default'),
  confirmed_by uuid NOT NULL REFERENCES users(id),
  note text CHECK (length(note)<=20000),
  replaces_confirmation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,project_id,subject_id,id,usage),
  UNIQUE (tenant_id,project_id,subject_id,id),
  FOREIGN KEY (tenant_id,project_id,subject_id,kind,basis_revision_id) REFERENCES creative_basis_revisions(tenant_id,project_id,subject_id,kind,id),
  FOREIGN KEY (tenant_id,project_id,subject_id,replaces_confirmation_id) REFERENCES creative_confirmations(tenant_id,project_id,subject_id,id)
);
CREATE TABLE creative_current_confirmations (
  subject_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  confirmation_id uuid NOT NULL,
  usage text NOT NULL DEFAULT 'project_default' CHECK (usage='project_default'),
  FOREIGN KEY (tenant_id,project_id,subject_id,confirmation_id,usage) REFERENCES creative_confirmations(tenant_id,project_id,subject_id,id,usage)
);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['creative_subjects','creative_basis_revisions','creative_confirmations','creative_current_confirmations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY creative_scope ON %I USING (project_role(project_id) IS NOT NULL) WITH CHECK (tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL)',t);
  END LOOP;
END $$;
CREATE TRIGGER creative_basis_immutable BEFORE UPDATE OR DELETE ON creative_basis_revisions FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
CREATE TRIGGER creative_confirmation_immutable BEFORE UPDATE OR DELETE ON creative_confirmations FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
CREATE TRIGGER creative_subject_immutable BEFORE UPDATE OR DELETE ON creative_subjects FOR EACH ROW EXECUTE FUNCTION protect_content_revision();

-- Canonical JSON without insignificant whitespace, C-ordered schema property names.
-- Payload keys are the declared ASCII domain fields. Text is retained exactly.
CREATE FUNCTION creative_canonical(value jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT SET search_path FROM CURRENT AS $$
DECLARE result text;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||creative_canonical(val),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(value) AS e(key,val);
    WHEN 'array' THEN SELECT '['||coalesce(string_agg(creative_canonical(val),',' ORDER BY ordinal),'')||']' INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS e(val,ordinal);
    ELSE result:=value::text;
  END CASE;
  RETURN result;
END $$;
CREATE FUNCTION creative_id_set(value jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM (SELECT DISTINCT elem::uuid::text AS id FROM jsonb_array_elements_text(coalesce(value,'[]'::jsonb)) elem) ids;
$$;
CREATE FUNCTION creative_payload(value jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE STRICT SET search_path FROM CURRENT AS $$
DECLARE payload jsonb;
BEGIN
  CASE value->>'kind'
    WHEN 'script' THEN payload:=jsonb_build_object('kind','script','text',value->>'text');
    WHEN 'production' THEN payload:=jsonb_build_object('kind','production','brief',value->>'brief','defaultAssetRevisionIds',creative_id_set(value->'defaultAssetRevisionIds'));
    WHEN 'scene' THEN payload:=jsonb_build_object('kind','scene','summary',value->>'summary','state',value->'state','defaultAssetRevisionIds',creative_id_set(value->'defaultAssetRevisionIds'));
    WHEN 'shot_dialogue' THEN
      SELECT jsonb_build_object('kind','shot_dialogue','dialogue',coalesce(jsonb_agg(line ORDER BY creative_canonical(line) COLLATE "C"),'[]'::jsonb)) INTO payload
      FROM (SELECT jsonb_build_object('identity',coalesce(d->>'sourceDialogueId',d->>'id')::uuid::text,'speaker',(d->>'characterAssetId')::uuid::text,'text',d->>'text') AS line FROM jsonb_array_elements(coalesce(value->'dialogue','[]'::jsonb)) d) normalized;
    ELSE RAISE EXCEPTION 'Invalid creative basis kind' USING ERRCODE='23514';
  END CASE;
  RETURN payload;
END $$;

-- Source capture reads the real object under its existing RLS, never a client snapshot.
-- Application source writes already hold the project write lock. Backfill runs in migration.
CREATE FUNCTION capture_creative_basis(p_kind text,p_object_id uuid) RETURNS uuid LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE source record; snapshot_value jsonb; basis_id uuid; subject uuid; hash_value text; previous creative_basis_revisions%ROWTYPE; meaningful boolean;
BEGIN
  CASE p_kind
    WHEN 'script' THEN
      SELECT tenant_id,project_id,revision,text INTO STRICT source FROM script_revisions WHERE id=p_object_id;
      subject:=source.project_id;snapshot_value:=jsonb_build_object('kind',p_kind,'scriptRevisionId',p_object_id,'text',source.text);meaningful:=true;
    WHEN 'production' THEN
      SELECT tenant_id,project_id,revision,brief,default_asset_revision_ids INTO STRICT source FROM productions WHERE id=p_object_id;
      subject:=p_object_id;snapshot_value:=jsonb_build_object('kind',p_kind,'brief',source.brief,'defaultAssetRevisionIds',source.default_asset_revision_ids);meaningful:=source.brief<>'' OR source.default_asset_revision_ids<>'[]'::jsonb;
    WHEN 'scene' THEN
      SELECT tenant_id,project_id,revision,summary,state,default_asset_revision_ids INTO STRICT source FROM scenes WHERE id=p_object_id;
      subject:=p_object_id;snapshot_value:=jsonb_build_object('kind',p_kind,'summary',source.summary,'state',source.state,'defaultAssetRevisionIds',source.default_asset_revision_ids);meaningful:=source.summary<>'' OR source.state<>'{}'::jsonb OR source.default_asset_revision_ids<>'[]'::jsonb;
    WHEN 'shot_dialogue' THEN
      SELECT tenant_id,project_id,shot_id,revision,spec INTO STRICT source FROM shot_revisions WHERE id=p_object_id;
      subject:=source.shot_id;snapshot_value:=jsonb_build_object('kind',p_kind,'shotRevisionId',p_object_id,'dialogue',coalesce(source.spec->'dialogue','[]'::jsonb));meaningful:=jsonb_array_length(snapshot_value->'dialogue')>0;
    ELSE RAISE EXCEPTION 'Invalid creative basis kind' USING ERRCODE='23514';
  END CASE;
  SELECT * INTO previous FROM creative_basis_revisions WHERE tenant_id=source.tenant_id AND project_id=source.project_id AND subject_id=subject ORDER BY ordinal DESC LIMIT 1;
  IF NOT meaningful AND previous.id IS NULL THEN RETURN NULL; END IF;
  hash_value:=encode(sha256(convert_to(creative_canonical(creative_payload(snapshot_value)),'UTF8')),'hex');
  IF p_kind IN ('production','scene') AND previous.content_hash=hash_value THEN RETURN previous.id; END IF;
  SELECT id INTO basis_id FROM creative_basis_revisions WHERE tenant_id=source.tenant_id AND project_id=source.project_id AND source_revision=source.revision AND
    ((p_kind='script' AND script_revision_id=p_object_id) OR (p_kind='production' AND production_id=p_object_id) OR (p_kind='scene' AND scene_id=p_object_id) OR (p_kind='shot_dialogue' AND shot_revision_id=p_object_id));
  IF basis_id IS NOT NULL THEN RETURN basis_id; END IF;
  INSERT INTO creative_subjects(id,tenant_id,project_id,kind,script_project_id,production_id,scene_id,shot_id)
    VALUES(subject,source.tenant_id,source.project_id,p_kind,CASE WHEN p_kind='script' THEN subject END,CASE WHEN p_kind='production' THEN subject END,CASE WHEN p_kind='scene' THEN subject END,CASE WHEN p_kind='shot_dialogue' THEN subject END) ON CONFLICT(id) DO NOTHING;
  basis_id:=gen_random_uuid();
  INSERT INTO creative_basis_revisions(id,tenant_id,project_id,subject_id,kind,ordinal,source_revision,script_revision_id,production_id,scene_id,shot_revision_id,snapshot,content_hash,hash_version)
    VALUES(basis_id,source.tenant_id,source.project_id,subject,p_kind,coalesce(previous.ordinal,0)+1,source.revision,CASE WHEN p_kind='script' THEN p_object_id END,CASE WHEN p_kind='production' THEN p_object_id END,CASE WHEN p_kind='scene' THEN p_object_id END,CASE WHEN p_kind='shot_dialogue' THEN p_object_id END,snapshot_value,hash_value,'creative-v1');
  RETURN basis_id;
END $$;
CREATE FUNCTION capture_creative_source() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  PERFORM capture_creative_basis(TG_ARGV[0],NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER script_creative_capture AFTER INSERT ON script_revisions FOR EACH ROW EXECUTE FUNCTION capture_creative_source('script');
CREATE TRIGGER production_creative_capture AFTER INSERT OR UPDATE ON productions FOR EACH ROW EXECUTE FUNCTION capture_creative_source('production');
CREATE TRIGGER scene_creative_capture AFTER INSERT OR UPDATE ON scenes FOR EACH ROW EXECUTE FUNCTION capture_creative_source('scene');
CREATE TRIGGER dialogue_creative_capture AFTER INSERT ON shot_revisions FOR EACH ROW EXECUTE FUNCTION capture_creative_source('shot_dialogue');
REVOKE ALL ON FUNCTION creative_canonical(jsonb),creative_id_set(jsonb),creative_payload(jsonb),capture_creative_basis(text,uuid),capture_creative_source() FROM PUBLIC;

-- Backfill only actual immutable script/shot history and surviving production/scene values.
-- Earlier mutable production/scene versions cannot be reconstructed and are not fabricated.
DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT id FROM script_revisions ORDER BY project_id,number LOOP PERFORM capture_creative_basis('script',item.id); END LOOP;
  FOR item IN SELECT id FROM productions LOOP PERFORM capture_creative_basis('production',item.id); END LOOP;
  FOR item IN SELECT id FROM scenes LOOP PERFORM capture_creative_basis('scene',item.id); END LOOP;
  FOR item IN SELECT id FROM shot_revisions ORDER BY shot_id,number LOOP PERFORM capture_creative_basis('shot_dialogue',item.id); END LOOP;
END $$;
