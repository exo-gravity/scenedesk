-- Actual creative owners and fixed asset/media dependencies. JSON remains the
-- editing document; these projections enforce scope, retention and lineage.
CREATE TYPE creative_link AS (
  category text, slot text, asset_id uuid, asset_revision_id uuid,
  look_id uuid, media_id uuid, purpose text
);

CREATE FUNCTION creative_links(document jsonb) RETURNS SETOF creative_link
LANGUAGE plpgsql IMMUTABLE SET search_path FROM CURRENT AS $$
DECLARE item jsonb; state jsonb; layer text; key text; id uuid; carried jsonb;
BEGIN
  IF octet_length(document::text)>1048576 THEN
    RAISE EXCEPTION 'Creative reference document exceeds limit' USING ERRCODE='P0422';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(document->'defaults','[]')) LOOP
    id:=(item#>>'{}')::uuid;
    RETURN NEXT ('reference','default/'||id,NULL,id,NULL,NULL,'default')::creative_link;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(document->'references','[]')) LOOP
    id:=(item->>'mediaId')::uuid;
    key:='reference/'||concat_ws('/',item->>'purpose',id,coalesce(((item->>'assetRevisionId')::uuid)::text,'-'),coalesce(((item->>'subjectAssetId')::uuid)::text,'-'));
    RETURN NEXT ('reference',key,(item->>'subjectAssetId')::uuid,(item->>'assetRevisionId')::uuid,NULL,id,item->>'purpose')::creative_link;
  END LOOP;
  FOREACH layer IN ARRAY ARRAY['state','entryState','exitState'] LOOP
    state:=document->layer;
    IF (SELECT count(*)<>count(DISTINCT (value->>'characterAssetId')::uuid) FROM jsonb_array_elements(coalesce(state->'characters','[]')))
      OR (SELECT count(*)<>count(DISTINCT (value->>'propAssetId')::uuid) FROM jsonb_array_elements(coalesce(state->'props','[]'))) THEN
      RAISE EXCEPTION 'Duplicate character or prop within a continuity layer' USING ERRCODE='P0422';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(coalesce(state->'characters','[]')) LOOP
      id:=(item->>'characterAssetId')::uuid; key:=layer||'/character/'||id;
      RETURN NEXT ('binding',key,id,NULL,NULL,NULL,'character')::creative_link;
      IF (item->>'lookId' IS NULL)<>(item->>'lookAssetRevisionId' IS NULL) THEN
        RAISE EXCEPTION 'Look identity and fixed parent revision must be paired' USING ERRCODE='P0422';
      END IF;
      IF item->>'lookId' IS NOT NULL THEN
        RETURN NEXT ('binding',key||'/look',id,(item->>'lookAssetRevisionId')::uuid,(item->>'lookId')::uuid,NULL,'look')::creative_link;
      END IF;
      IF item->>'voiceAssetRevisionId' IS NOT NULL THEN
        RETURN NEXT ('binding',key||'/voice',NULL,(item->>'voiceAssetRevisionId')::uuid,NULL,NULL,'voice')::creative_link;
      END IF;
      FOR carried IN SELECT value FROM jsonb_array_elements(coalesce(item->'propAssetIds','[]')) LOOP
        RETURN NEXT ('binding',key||'/prop/'||(carried#>>'{}')::uuid,(carried#>>'{}')::uuid,NULL,NULL,NULL,'carried_prop')::creative_link;
      END LOOP;
    END LOOP;
    FOR item IN SELECT value FROM jsonb_array_elements(coalesce(state->'props','[]')) LOOP
      id:=(item->>'propAssetId')::uuid; key:=layer||'/prop/'||id;
      RETURN NEXT ('binding',key,id,(item->>'propAssetRevisionId')::uuid,NULL,NULL,'prop')::creative_link;
      IF item->>'holderCharacterAssetId' IS NOT NULL THEN
        RETURN NEXT ('binding',key||'/holder',(item->>'holderCharacterAssetId')::uuid,NULL,NULL,NULL,'holder')::creative_link;
      END IF;
    END LOOP;
  END LOOP;
  IF (SELECT count(*)<>count(DISTINCT (value->>'id')::uuid) FROM jsonb_array_elements(coalesce(document->'dialogue','[]'))) THEN
    RAISE EXCEPTION 'Duplicate dialogue identity' USING ERRCODE='P0422';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(document->'dialogue','[]')) LOOP
    key:='dialogue/'||(item->>'id')::uuid;
    IF item->>'characterAssetId' IS NOT NULL THEN
      RETURN NEXT ('binding',key||'/speaker',(item->>'characterAssetId')::uuid,NULL,NULL,NULL,'character')::creative_link;
    END IF;
    IF item->>'voiceAssetRevisionId' IS NOT NULL THEN
      RETURN NEXT ('binding',key||'/voice',NULL,(item->>'voiceAssetRevisionId')::uuid,NULL,NULL,'voice')::creative_link;
    END IF;
  END LOOP;
END $$;

CREATE TABLE creative_references (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  production_id uuid, scene_id uuid, shot_revision_id uuid,
  slot text NOT NULL, purpose text NOT NULL,
  asset_revision_id uuid, media_id uuid, subject_asset_id uuid,
  CHECK (num_nonnulls(production_id,scene_id,shot_revision_id)=1),
  CHECK (num_nonnulls(asset_revision_id,media_id)>=1),
  CHECK (purpose IN ('default','identity','look','location','action','composition','style','voice','start_frame','end_frame','prop')),
  UNIQUE NULLS NOT DISTINCT (production_id,scene_id,shot_revision_id,slot),
  FOREIGN KEY (tenant_id,project_id,production_id) REFERENCES productions(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id,scene_id) REFERENCES scenes(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id,shot_revision_id) REFERENCES shot_revisions(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,asset_revision_id) REFERENCES asset_revisions(tenant_id,id),
  FOREIGN KEY (tenant_id,media_id) REFERENCES media(tenant_id,id),
  FOREIGN KEY (tenant_id,subject_asset_id) REFERENCES assets(tenant_id,id)
);
CREATE INDEX creative_reference_asset_usage ON creative_references(asset_revision_id);
CREATE INDEX creative_reference_media_retention ON creative_references(media_id);
CREATE INDEX creative_reference_subject_usage ON creative_references(subject_asset_id);
CREATE TABLE creative_asset_bindings (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  production_id uuid, scene_id uuid, shot_revision_id uuid,
  slot text NOT NULL, purpose text NOT NULL,
  asset_id uuid, asset_revision_id uuid, look_id uuid,
  CHECK (num_nonnulls(production_id,scene_id,shot_revision_id)=1),
  CHECK (num_nonnulls(asset_id,asset_revision_id)>=1),
  CHECK (purpose IN ('character','look','voice','prop','holder','carried_prop')),
  CHECK ((purpose='look')=(look_id IS NOT NULL)),
  CHECK (look_id IS NULL OR (asset_id IS NOT NULL AND asset_revision_id IS NOT NULL)),
  UNIQUE NULLS NOT DISTINCT (production_id,scene_id,shot_revision_id,slot),
  FOREIGN KEY (tenant_id,project_id,production_id) REFERENCES productions(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id,scene_id) REFERENCES scenes(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id,shot_revision_id) REFERENCES shot_revisions(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,asset_id) REFERENCES assets(tenant_id,id),
  FOREIGN KEY (tenant_id,asset_revision_id) REFERENCES asset_revisions(tenant_id,id),
  FOREIGN KEY (tenant_id,asset_id,asset_revision_id) REFERENCES asset_revisions(tenant_id,asset_id,id),
  FOREIGN KEY (asset_revision_id,look_id) REFERENCES asset_revision_looks(asset_revision_id,look_id)
);
CREATE INDEX creative_binding_asset_usage ON creative_asset_bindings(asset_id);
CREATE INDEX creative_binding_revision_usage ON creative_asset_bindings(asset_revision_id);

CREATE FUNCTION asset_identity_usable(target_tenant uuid,target_project uuid,target_asset uuid,keep_existing boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT EXISTS (SELECT 1 FROM assets a WHERE a.tenant_id=target_tenant AND a.id=target_asset
    AND (a.status='active' OR keep_existing) AND (a.project_id=target_project OR
      (a.scope='shared' AND EXISTS (SELECT 1 FROM shared_imports i JOIN asset_revisions r ON r.id=i.asset_revision_id
        WHERE i.tenant_id=target_tenant AND i.project_id=target_project AND r.asset_id=a.id))))
$$;
CREATE FUNCTION validate_creative_links(target_tenant uuid,target_project uuid,document jsonb,previous jsonb)
RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE link creative_link; keep_existing boolean; source media; root assets; fixed asset_revisions; expected_kind text; previous_links creative_link[];
BEGIN
  previous_links:=ARRAY(SELECT e FROM creative_links(previous) e);
  IF (SELECT count(*)>1000 OR count(*)<>count(DISTINCT (category,slot)) FROM creative_links(document)) THEN
    RAISE EXCEPTION 'Duplicate or excessive creative references' USING ERRCODE='P0422';
  END IF;
  FOR link IN SELECT * FROM creative_links(document) LOOP
    keep_existing:=EXISTS (SELECT 1 FROM unnest(previous_links) old WHERE old IS NOT DISTINCT FROM link);
    expected_kind:=CASE link.purpose WHEN 'character' THEN 'character' WHEN 'holder' THEN 'character'
      WHEN 'look' THEN CASE WHEN link.category='binding' THEN 'character' END
      WHEN 'prop' THEN CASE WHEN link.category='binding' THEN 'prop' END WHEN 'carried_prop' THEN 'prop'
      WHEN 'voice' THEN CASE WHEN link.category='binding' THEN 'voice' END END;
    IF link.asset_id IS NOT NULL THEN
      SELECT * INTO root FROM assets WHERE tenant_id=target_tenant AND id=link.asset_id;
      IF NOT asset_identity_usable(target_tenant,target_project,link.asset_id,keep_existing)
        OR (expected_kind IS NOT NULL AND root.kind<>expected_kind) THEN
        RAISE EXCEPTION 'Invalid creative asset identity or kind' USING ERRCODE='P0422';
      END IF;
    END IF;
    IF link.asset_revision_id IS NOT NULL THEN
      SELECT * INTO fixed FROM asset_revisions WHERE tenant_id=target_tenant AND id=link.asset_revision_id;
      SELECT * INTO root FROM assets WHERE tenant_id=target_tenant AND id=fixed.asset_id;
      IF NOT asset_revision_usable(target_tenant,target_project,link.asset_revision_id,keep_existing)
        OR (link.asset_id IS NOT NULL AND fixed.asset_id<>link.asset_id)
        OR (expected_kind IS NOT NULL AND root.kind<>expected_kind)
        OR (link.look_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM asset_revision_looks WHERE tenant_id=target_tenant
          AND asset_revision_id=link.asset_revision_id AND asset_id=link.asset_id AND look_id=link.look_id)) THEN
        RAISE EXCEPTION 'Invalid creative fixed revision, look or kind' USING ERRCODE='P0422';
      END IF;
    END IF;
    IF link.media_id IS NOT NULL THEN
      SELECT * INTO source FROM media WHERE tenant_id=target_tenant AND id=link.media_id;
      IF source.id IS NULL OR (source.project_id IS NOT NULL AND source.project_id<>target_project)
        OR (source.status<>'ready' AND NOT (source.status='archived' AND keep_existing))
        OR (link.asset_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM asset_revision_media
          WHERE tenant_id=target_tenant AND asset_revision_id=link.asset_revision_id AND media_id=source.id)) THEN
        RAISE EXCEPTION 'Invalid creative reference media or fixed-version membership' USING ERRCODE='P0422';
      END IF;
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION creative_owner_document(target_production uuid,target_scene uuid,target_shot_revision uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT jsonb_build_object('defaults',default_asset_revision_ids) FROM productions WHERE id=target_production
  UNION ALL SELECT jsonb_build_object('defaults',default_asset_revision_ids,'state',state) FROM scenes WHERE id=target_scene
  UNION ALL SELECT spec FROM shot_revisions WHERE id=target_shot_revision
$$;
CREATE FUNCTION validate_creative_owner() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE document jsonb; previous jsonb; current_number bigint;
BEGIN
  IF TG_TABLE_NAME='productions' THEN
    document:=jsonb_build_object('defaults',NEW.default_asset_revision_ids);
    IF TG_OP='UPDATE' THEN previous:=jsonb_build_object('defaults',OLD.default_asset_revision_ids); END IF;
  ELSIF TG_TABLE_NAME='scenes' THEN
    document:=jsonb_build_object('defaults',NEW.default_asset_revision_ids,'state',NEW.state);
    IF TG_OP='UPDATE' THEN previous:=jsonb_build_object('defaults',OLD.default_asset_revision_ids,'state',OLD.state); END IF;
  ELSE
    document:=NEW.spec;
    SELECT r.spec,r.number INTO previous,current_number FROM shots s JOIN shot_revisions r ON r.id=s.current_revision_id
      WHERE s.tenant_id=NEW.tenant_id AND s.project_id=NEW.project_id AND s.id=NEW.shot_id;
    IF NEW.number<>coalesce(current_number,0)+1 THEN
      RAISE EXCEPTION 'Shot revision must append to its current fixed requirements' USING ERRCODE='P0422';
    END IF;
  END IF;
  PERFORM validate_creative_links(NEW.tenant_id,NEW.project_id,document,coalesce(previous,'{}'));
  RETURN NEW;
END $$;
CREATE TRIGGER production_assets_valid BEFORE INSERT OR UPDATE OF default_asset_revision_ids ON productions FOR EACH ROW EXECUTE FUNCTION validate_creative_owner();
CREATE TRIGGER scene_assets_valid BEFORE INSERT OR UPDATE OF state,default_asset_revision_ids ON scenes FOR EACH ROW EXECUTE FUNCTION validate_creative_owner();
CREATE TRIGGER shot_assets_valid BEFORE INSERT ON shot_revisions FOR EACH ROW EXECUTE FUNCTION validate_creative_owner();

-- Invoker triggers use restricted runtime grants. Direct insertion/deletion is
-- still checked against the actual owner's current document; no arbitrary target.
CREATE FUNCTION protect_creative_projection() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE row_data record; link creative_link; expected boolean;
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Replace mutable projections through the owner' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN row_data:=OLD; ELSE row_data:=NEW; END IF;
  IF TG_TABLE_NAME='creative_references' THEN
    link:=('reference',row_data.slot,row_data.subject_asset_id,row_data.asset_revision_id,NULL,row_data.media_id,row_data.purpose)::creative_link;
  ELSE
    link:=('binding',row_data.slot,row_data.asset_id,row_data.asset_revision_id,row_data.look_id,NULL,row_data.purpose)::creative_link;
  END IF;
  expected:=EXISTS (SELECT 1 FROM creative_links(creative_owner_document(row_data.production_id,row_data.scene_id,row_data.shot_revision_id)) e WHERE e IS NOT DISTINCT FROM link);
  IF (TG_OP='INSERT' AND NOT expected) OR (TG_OP='DELETE' AND (row_data.shot_revision_id IS NOT NULL OR expected)) THEN
    RAISE EXCEPTION 'Creative projection must match its actual owner and preserve fixed history' USING ERRCODE='23514';
  END IF;
  RETURN row_data;
END $$;
CREATE FUNCTION project_creative_owner() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE prod uuid; scene uuid; shot uuid; link creative_link; document jsonb;
BEGIN
  IF TG_TABLE_NAME='productions' THEN prod:=NEW.id;
  ELSIF TG_TABLE_NAME='scenes' THEN scene:=NEW.id;
  ELSE shot:=NEW.id; END IF;
  document:=creative_owner_document(prod,scene,shot);
  DELETE FROM creative_references r WHERE (r.production_id,r.scene_id,r.shot_revision_id) IS NOT DISTINCT FROM (prod,scene,shot)
    AND NOT EXISTS (SELECT 1 FROM creative_links(document) e WHERE e IS NOT DISTINCT FROM
      ('reference',r.slot,r.subject_asset_id,r.asset_revision_id,NULL,r.media_id,r.purpose)::creative_link);
  DELETE FROM creative_asset_bindings r WHERE (r.production_id,r.scene_id,r.shot_revision_id) IS NOT DISTINCT FROM (prod,scene,shot)
    AND NOT EXISTS (SELECT 1 FROM creative_links(document) e WHERE e IS NOT DISTINCT FROM
      ('binding',r.slot,r.asset_id,r.asset_revision_id,r.look_id,NULL,r.purpose)::creative_link);
  FOR link IN SELECT * FROM creative_links(document) LOOP
    IF link.category='reference' THEN
      INSERT INTO creative_references(tenant_id,project_id,production_id,scene_id,shot_revision_id,slot,purpose,asset_revision_id,media_id,subject_asset_id)
        VALUES(NEW.tenant_id,NEW.project_id,prod,scene,shot,link.slot,link.purpose,link.asset_revision_id,link.media_id,link.asset_id) ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO creative_asset_bindings(tenant_id,project_id,production_id,scene_id,shot_revision_id,slot,purpose,asset_id,asset_revision_id,look_id)
        VALUES(NEW.tenant_id,NEW.project_id,prod,scene,shot,link.slot,link.purpose,link.asset_id,link.asset_revision_id,link.look_id) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  IF shot IS NOT NULL THEN
    INSERT INTO dialogue_lines(tenant_id,project_id,shot_revision_id,dialogue_id,text,performance,source_excerpt,source_dialogue_id,speaker_asset_id,voice_asset_revision_id)
      SELECT NEW.tenant_id,NEW.project_id,shot,(value->>'id')::uuid,value->>'text',value->>'performance',value->'sourceExcerpt',
        (value->>'sourceDialogueId')::uuid,(value->>'characterAssetId')::uuid,(value->>'voiceAssetRevisionId')::uuid
      FROM jsonb_array_elements(coalesce(document->'dialogue','[]'));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER production_assets_projection AFTER INSERT OR UPDATE OF default_asset_revision_ids ON productions FOR EACH ROW EXECUTE FUNCTION project_creative_owner();
CREATE TRIGGER scene_assets_projection AFTER INSERT OR UPDATE OF state,default_asset_revision_ids ON scenes FOR EACH ROW EXECUTE FUNCTION project_creative_owner();
CREATE TRIGGER shot_assets_projection AFTER INSERT ON shot_revisions FOR EACH ROW EXECUTE FUNCTION project_creative_owner();
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['creative_references','creative_asset_bindings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY creative_link_scope ON %I USING (tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL) WITH CHECK (tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL)',t);
    EXECUTE format('CREATE TRIGGER creative_projection_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION protect_creative_projection()',t);
  END LOOP;
END $$;

ALTER TABLE dialogue_lines ADD COLUMN speaker_asset_id uuid,
  ADD COLUMN voice_asset_revision_id uuid,
  ADD FOREIGN KEY (tenant_id,speaker_asset_id) REFERENCES assets(tenant_id,id),
  ADD FOREIGN KEY (tenant_id,voice_asset_revision_id) REFERENCES asset_revisions(tenant_id,id);
CREATE FUNCTION validate_dialogue_projection() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE expected jsonb;
BEGIN
  SELECT value INTO expected FROM shot_revisions r CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.spec->'dialogue','[]'))
    WHERE r.tenant_id=NEW.tenant_id AND r.project_id=NEW.project_id AND r.id=NEW.shot_revision_id AND (value->>'id')::uuid=NEW.dialogue_id;
  IF expected IS NULL OR (NEW.text,NEW.performance,NEW.source_excerpt,NEW.source_dialogue_id,NEW.speaker_asset_id,NEW.voice_asset_revision_id)
    IS DISTINCT FROM (expected->>'text',expected->>'performance',expected->'sourceExcerpt',(expected->>'sourceDialogueId')::uuid,
      (expected->>'characterAssetId')::uuid,(expected->>'voiceAssetRevisionId')::uuid) THEN
    RAISE EXCEPTION 'Dialogue projection must match fixed shot requirements' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dialogue_projection_valid BEFORE INSERT ON dialogue_lines FOR EACH ROW EXECUTE FUNCTION validate_dialogue_projection();

CREATE TABLE project_quality_references (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, media_id uuid NOT NULL,
  PRIMARY KEY(project_id,media_id),
  FOREIGN KEY (tenant_id,project_id) REFERENCES projects(tenant_id,id),
  FOREIGN KEY (tenant_id,media_id) REFERENCES media(tenant_id,id)
);
CREATE INDEX project_quality_media_retention ON project_quality_references(media_id);
ALTER TABLE project_quality_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_quality_references FORCE ROW LEVEL SECURITY;
CREATE POLICY quality_reference_scope ON project_quality_references USING (tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL)
  WITH CHECK (tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL);
CREATE FUNCTION project_quality_media() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE ids uuid[]; previous uuid[]; quality_id uuid; source media;
BEGIN
  SELECT coalesce(array_agg(value::uuid),'{}') INTO ids FROM jsonb_array_elements_text(coalesce(NEW.spec->'qualityReferenceMediaIds','[]'));
  IF TG_OP='UPDATE' THEN
    SELECT coalesce(array_agg(value::uuid),'{}') INTO previous FROM jsonb_array_elements_text(coalesce(OLD.spec->'qualityReferenceMediaIds','[]'));
  END IF;
  IF cardinality(ids)>200 OR cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids) x) THEN
    RAISE EXCEPTION 'Duplicate or excessive quality references' USING ERRCODE='P0422';
  END IF;
  FOREACH quality_id IN ARRAY ids LOOP
    SELECT * INTO source FROM media WHERE tenant_id=NEW.tenant_id AND media.id=quality_id;
    IF source.id IS NULL OR (source.project_id IS NOT NULL AND source.project_id<>NEW.id)
      OR (source.status<>'ready' AND NOT (source.status='archived' AND quality_id=ANY(coalesce(previous,'{}')))) THEN
      RAISE EXCEPTION 'Invalid quality reference media' USING ERRCODE='P0422';
    END IF;
  END LOOP;
  DELETE FROM project_quality_references WHERE project_id=NEW.id AND NOT(media_id=ANY(ids));
  INSERT INTO project_quality_references(tenant_id,project_id,media_id) SELECT NEW.tenant_id,NEW.id,x FROM unnest(ids) x ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE FUNCTION protect_quality_projection() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE row_data project_quality_references; expected boolean;
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Quality projection must be replaced through its project' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN row_data:=OLD; ELSE row_data:=NEW; END IF;
  expected:=EXISTS (SELECT 1 FROM projects p CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(p.spec->'qualityReferenceMediaIds','[]'))
    WHERE p.tenant_id=row_data.tenant_id AND p.id=row_data.project_id AND value::uuid=row_data.media_id);
  IF expected<>(TG_OP='INSERT') THEN RAISE EXCEPTION 'Quality projection must match project settings' USING ERRCODE='23514'; END IF;
  RETURN row_data;
END $$;
CREATE TRIGGER project_quality_projection AFTER INSERT OR UPDATE OF spec ON projects FOR EACH ROW EXECUTE FUNCTION project_quality_media();
CREATE TRIGGER quality_projection_guard BEFORE INSERT OR UPDATE OR DELETE ON project_quality_references FOR EACH ROW EXECUTE FUNCTION protect_quality_projection();

-- Previous releases rejected all these bindings; no accepted references need
-- backfill. Stop migration if that premise is violated instead of losing lineage.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM productions WHERE default_asset_revision_ids<>'[]')
    OR EXISTS (SELECT 1 FROM scenes WHERE default_asset_revision_ids<>'[]' OR coalesce(state->'characters','[]')<>'[]' OR coalesce(state->'props','[]')<>'[]')
    OR EXISTS (SELECT 1 FROM shot_revisions r CROSS JOIN LATERAL creative_links(r.spec))
    OR EXISTS (SELECT 1 FROM projects WHERE coalesce(spec->'qualityReferenceMediaIds','[]')<>'[]') THEN
    RAISE EXCEPTION 'Existing creative bindings require an explicit backfill before migration';
  END IF;
END $$;
REVOKE ALL ON FUNCTION creative_links(jsonb),asset_identity_usable(uuid,uuid,uuid,boolean),validate_creative_links(uuid,uuid,jsonb,jsonb),
  creative_owner_document(uuid,uuid,uuid),validate_creative_owner(),protect_creative_projection(),project_creative_owner(),
  validate_dialogue_projection(),project_quality_media(),protect_quality_projection() FROM PUBLIC;
