-- Asset identity, fixed definitions and explicit dependency projections.
-- A new current pointer does not rewrite any prior definition or reference.
CREATE TABLE assets (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid,
  scope text NOT NULL CHECK (scope IN ('project','shared')),
  kind text NOT NULL CHECK (kind IN ('character','location','prop','voice','style')),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '' CHECK (length(description)<=20000),
  tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags)<=50),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  current_revision_id uuid,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,project_id) REFERENCES projects(tenant_id,id),
  CHECK ((scope='project')=(project_id IS NOT NULL))
);
CREATE INDEX assets_browse ON assets(tenant_id,scope,project_id,kind,status,created_at,id);
CREATE TABLE asset_revisions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  number bigint NOT NULL CHECK (number BETWEEN 1 AND 9007199254740991),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition)='object'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),
  parent_revision_id uuid,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision IN (1,2)),
  confirmed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id,number),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,asset_id,id),
  FOREIGN KEY (tenant_id,asset_id) REFERENCES assets(tenant_id,id),
  FOREIGN KEY (tenant_id,asset_id,parent_revision_id) REFERENCES asset_revisions(tenant_id,asset_id,id),
  CHECK ((status='confirmed')=(confirmed_by IS NOT NULL)),
  CHECK ((status='draft' AND revision=1) OR (status='confirmed' AND revision=2))
);
ALTER TABLE assets ADD CONSTRAINT asset_current_revision_scope
  FOREIGN KEY (tenant_id,id,current_revision_id) REFERENCES asset_revisions(tenant_id,asset_id,id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE asset_looks (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  UNIQUE (tenant_id,asset_id,id),
  FOREIGN KEY (tenant_id,asset_id) REFERENCES assets(tenant_id,id)
);
CREATE TABLE asset_revision_looks (
  tenant_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  asset_revision_id uuid NOT NULL,
  look_id uuid NOT NULL,
  number bigint NOT NULL CHECK (number BETWEEN 1 AND 9007199254740991),
  definition jsonb NOT NULL,
  PRIMARY KEY (asset_revision_id,look_id),
  FOREIGN KEY (tenant_id,asset_id,asset_revision_id) REFERENCES asset_revisions(tenant_id,asset_id,id),
  FOREIGN KEY (tenant_id,asset_id,look_id) REFERENCES asset_looks(tenant_id,asset_id,id)
);
CREATE TABLE asset_revision_media (
  tenant_id uuid NOT NULL,
  asset_revision_id uuid NOT NULL,
  media_id uuid NOT NULL,
  look_key text NOT NULL DEFAULT '',
  position integer NOT NULL CHECK (position BETWEEN 0 AND 199),
  role text NOT NULL CHECK (role IN ('identity','look','location','action','composition','style','voice','start_frame','end_frame','prop')),
  referenced_asset_revision_id uuid,
  subject_asset_id uuid,
  PRIMARY KEY (asset_revision_id,look_key,position),
  UNIQUE (asset_revision_id,look_key,media_id,role),
  FOREIGN KEY (tenant_id,asset_revision_id) REFERENCES asset_revisions(tenant_id,id),
  FOREIGN KEY (tenant_id,media_id) REFERENCES media(tenant_id,id),
  FOREIGN KEY (tenant_id,referenced_asset_revision_id) REFERENCES asset_revisions(tenant_id,id),
  FOREIGN KEY (tenant_id,subject_asset_id) REFERENCES assets(tenant_id,id)
);
CREATE INDEX asset_media_retention ON asset_revision_media(media_id,asset_revision_id);
CREATE TABLE asset_revision_dependencies (
  tenant_id uuid NOT NULL,
  asset_revision_id uuid NOT NULL,
  referenced_asset_revision_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('reference','default_voice')),
  PRIMARY KEY (asset_revision_id,referenced_asset_revision_id,purpose),
  CHECK (asset_revision_id<>referenced_asset_revision_id),
  FOREIGN KEY (tenant_id,asset_revision_id) REFERENCES asset_revisions(tenant_id,id),
  FOREIGN KEY (tenant_id,referenced_asset_revision_id) REFERENCES asset_revisions(tenant_id,id)
);
CREATE INDEX asset_dependency_usage ON asset_revision_dependencies(referenced_asset_revision_id,asset_revision_id);
CREATE TABLE shared_imports (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  asset_revision_id uuid NOT NULL,
  imported_by uuid NOT NULL REFERENCES users(id),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision=1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id,asset_revision_id),
  FOREIGN KEY (tenant_id,project_id) REFERENCES projects(tenant_id,id),
  FOREIGN KEY (tenant_id,asset_revision_id) REFERENCES asset_revisions(tenant_id,id)
);

CREATE FUNCTION protect_asset_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW.tenant_id,NEW.project_id,NEW.scope,NEW.kind,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.project_id,OLD.scope,OLD.kind,OLD.created_at)
    OR NEW.revision<>OLD.revision+1 OR (OLD.status='archived' AND (NEW.status,NEW.current_revision_id) IS DISTINCT FROM (OLD.status,OLD.current_revision_id)) THEN
    RAISE EXCEPTION 'Asset identity and archived definition are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER asset_identity BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION protect_asset_identity();
CREATE FUNCTION protect_asset_revision() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE root assets;
BEGIN
  SELECT * INTO root FROM assets WHERE tenant_id=OLD.tenant_id AND id=OLD.asset_id;
  IF TG_OP='DELETE' OR (NEW.id,NEW.tenant_id,NEW.asset_id,NEW.number,NEW.definition,NEW.parent_revision_id,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.asset_id,OLD.number,OLD.definition,OLD.parent_revision_id,OLD.created_at)
    OR OLD.status<>'draft' OR NEW.status<>'confirmed' OR NEW.revision<>OLD.revision+1
    OR NEW.confirmed_by IS DISTINCT FROM actor_id() OR root.status<>'active'
    OR (CASE WHEN root.project_id IS NULL THEN tenant_role(root.tenant_id) NOT IN ('owner','admin') ELSE project_role(root.project_id) NOT IN ('admin','lead') END) THEN
    RAISE EXCEPTION 'Only authorized confirmation can change a fixed asset revision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER asset_revision_immutable BEFORE UPDATE OR DELETE ON asset_revisions FOR EACH ROW EXECUTE FUNCTION protect_asset_revision();

-- Read and write scopes match media; shared reads grant no private project access.
DO $$
DECLARE t text;
BEGIN
  ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
  ALTER TABLE assets FORCE ROW LEVEL SECURITY;
  CREATE POLICY asset_read ON assets FOR SELECT USING (media_scope_read(tenant_id,project_id));
  CREATE POLICY asset_insert ON assets FOR INSERT WITH CHECK (media_scope_write(tenant_id,project_id));
  CREATE POLICY asset_update ON assets FOR UPDATE USING (media_scope_write(tenant_id,project_id)) WITH CHECK (media_scope_write(tenant_id,project_id));
  FOREACH t IN ARRAY ARRAY['asset_revisions','asset_looks','asset_revision_looks','asset_revision_media','asset_revision_dependencies'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    IF t IN ('asset_revisions','asset_looks','asset_revision_looks') THEN
      EXECUTE format('CREATE POLICY asset_child_read ON %I FOR SELECT USING (tenant_id=tenant_scope() AND EXISTS (SELECT 1 FROM assets a WHERE a.id=asset_id AND a.tenant_id=%I.tenant_id))',t,t);
      EXECUTE format('CREATE POLICY asset_child_insert ON %I FOR INSERT WITH CHECK (tenant_id=tenant_scope() AND EXISTS (SELECT 1 FROM assets a WHERE a.id=asset_id AND a.tenant_id=%I.tenant_id AND media_scope_write(a.tenant_id,a.project_id)))',t,t);
    ELSE
      EXECUTE format('CREATE POLICY asset_child_read ON %I FOR SELECT USING (tenant_id=tenant_scope() AND EXISTS (SELECT 1 FROM asset_revisions r WHERE r.id=asset_revision_id AND r.tenant_id=%I.tenant_id))',t,t);
      EXECUTE format('CREATE POLICY asset_child_insert ON %I FOR INSERT WITH CHECK (tenant_id=tenant_scope() AND EXISTS (SELECT 1 FROM asset_revisions r JOIN assets a ON a.id=r.asset_id WHERE r.id=asset_revision_id AND r.tenant_id=%I.tenant_id AND media_scope_write(a.tenant_id,a.project_id)))',t,t);
    END IF;
    IF t<>'asset_revisions' THEN
      EXECUTE format('CREATE TRIGGER asset_projection_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION protect_content_revision()',t);
    END IF;
  END LOOP;
END $$;
CREATE POLICY asset_revision_confirm ON asset_revisions FOR UPDATE USING (EXISTS (SELECT 1 FROM assets a WHERE a.id=asset_id AND media_scope_write(a.tenant_id,a.project_id))) WITH CHECK (EXISTS (SELECT 1 FROM assets a WHERE a.id=asset_id AND media_scope_write(a.tenant_id,a.project_id)));
ALTER TABLE shared_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY shared_import_scope ON shared_imports USING (tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL) WITH CHECK (tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL);
CREATE TRIGGER shared_import_immutable BEFORE UPDATE OR DELETE ON shared_imports FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
REVOKE ALL ON FUNCTION protect_asset_identity(),protect_asset_revision() FROM PUBLIC;

CREATE FUNCTION asset_revision_usable(target_tenant uuid,target_project uuid,target_revision uuid,keep_existing boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT EXISTS (
    SELECT 1 FROM asset_revisions r JOIN assets a ON a.id=r.asset_id AND a.tenant_id=r.tenant_id
    WHERE r.tenant_id=target_tenant AND r.tenant_id=tenant_scope() AND r.id=target_revision
      AND (a.status='active' OR keep_existing)
      AND CASE WHEN target_project IS NULL THEN a.scope='shared'
        ELSE a.project_id=target_project OR (a.scope='shared' AND EXISTS (
          SELECT 1 FROM shared_imports i WHERE i.tenant_id=target_tenant AND i.project_id=target_project AND i.asset_revision_id=r.id
        )) END
  )
$$;
CREATE FUNCTION validate_asset_definition() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE root assets; parent asset_revisions; look jsonb; old_look jsonb; ref jsonb; old_ref jsonb;
  source media; dep asset_revisions; subject assets; look_number bigint; expected_number bigint;
  key text; ref_count integer; old_refs jsonb; definitions jsonb;
BEGIN
  SELECT * INTO root FROM assets WHERE tenant_id=NEW.tenant_id AND id=NEW.asset_id FOR UPDATE;
  IF root.id IS NULL OR root.status<>'active' OR NEW.status<>'draft' OR NEW.revision<>1
    OR NEW.number<>(SELECT coalesce(max(number),0)+1 FROM asset_revisions WHERE asset_id=NEW.asset_id)
    OR (root.current_revision_id IS NOT NULL AND NEW.parent_revision_id IS NULL)
    OR (NEW.parent_revision_id IS NULL AND NEW.number<>1) THEN
    RAISE EXCEPTION 'Asset revision must append to an active authorized root' USING ERRCODE='23514';
  END IF;
  IF NEW.parent_revision_id IS NOT NULL THEN
    SELECT * INTO parent FROM asset_revisions WHERE tenant_id=NEW.tenant_id AND asset_id=NEW.asset_id AND id=NEW.parent_revision_id;
    IF parent.id IS NULL THEN RAISE EXCEPTION 'Invalid asset parent revision' USING ERRCODE='23514'; END IF;
  END IF;
  IF octet_length(NEW.definition::text)>1048576 OR jsonb_typeof(NEW.definition->'description') IS DISTINCT FROM 'string'
    OR length(NEW.definition->>'description')>20000 OR jsonb_typeof(NEW.definition->'references') IS DISTINCT FROM 'array'
    OR (NEW.definition ? 'looks' AND jsonb_typeof(NEW.definition->'looks') IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'Invalid bounded asset definition' USING ERRCODE='23514';
  END IF;
  IF jsonb_array_length(coalesce(NEW.definition->'looks','[]'))>100
    OR (root.kind<>'character' AND (jsonb_array_length(coalesce(NEW.definition->'looks','[]'))>0 OR NEW.definition ? 'defaultVoiceAssetRevisionId')) THEN
    RAISE EXCEPTION 'Only characters contain bounded looks and a default voice' USING ERRCODE='23514';
  END IF;
  ref_count:=jsonb_array_length(NEW.definition->'references');
  FOR look IN SELECT value FROM jsonb_array_elements(coalesce(NEW.definition->'looks','[]')) LOOP
    IF jsonb_typeof(look->'references') IS DISTINCT FROM 'array' OR length(btrim(look->>'label')) NOT BETWEEN 1 AND 160 THEN
      RAISE EXCEPTION 'Invalid character look' USING ERRCODE='23514';
    END IF;
    ref_count:=ref_count+jsonb_array_length(look->'references');
    SELECT value INTO old_look FROM jsonb_array_elements(coalesce(parent.definition->'looks','[]')) WHERE (value->>'id')::uuid=(look->>'id')::uuid;
    SELECT coalesce(max(number),0)+1 INTO expected_number FROM asset_revision_looks WHERE tenant_id=NEW.tenant_id AND asset_id=NEW.asset_id AND look_id=(look->>'id')::uuid;
    IF old_look IS NOT NULL THEN
      expected_number:=(old_look->>'revision')::bigint+CASE WHEN (old_look-'revision')=(look-'revision') THEN 0 ELSE 1 END;
    END IF;
    IF (look->>'revision')::bigint<>expected_number THEN
      RAISE EXCEPTION 'Changed looks advance one revision; unchanged looks retain their version' USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF ref_count>200 THEN RAISE EXCEPTION 'Too many asset references' USING ERRCODE='23514'; END IF;
  definitions:=jsonb_build_array(jsonb_build_object('id','','references',NEW.definition->'references'))||coalesce(NEW.definition->'looks','[]');
  FOR look IN SELECT value FROM jsonb_array_elements(definitions) LOOP
    key:=look->>'id';
    old_refs:=CASE WHEN key='' THEN parent.definition->'references' ELSE (SELECT value->'references' FROM jsonb_array_elements(coalesce(parent.definition->'looks','[]')) WHERE value->>'id'=key) END;
    FOR ref IN SELECT value FROM jsonb_array_elements(look->'references') LOOP
      SELECT value INTO old_ref FROM jsonb_array_elements(coalesce(old_refs,'[]')) WHERE
        (value->>'mediaId')::uuid=(ref->>'mediaId')::uuid AND value->>'purpose'=ref->>'purpose'
        AND (value->>'assetRevisionId')::uuid IS NOT DISTINCT FROM (ref->>'assetRevisionId')::uuid
        AND (value->>'subjectAssetId')::uuid IS NOT DISTINCT FROM (ref->>'subjectAssetId')::uuid;
      SELECT * INTO source FROM media WHERE tenant_id=NEW.tenant_id AND id=(ref->>'mediaId')::uuid;
      IF source.id IS NULL OR (source.project_id IS NOT NULL AND source.project_id IS DISTINCT FROM root.project_id)
        OR (source.status<>'ready' AND NOT (source.status='archived' AND old_ref IS NOT NULL)) THEN
        RAISE EXCEPTION 'New asset media must be ready and in the same authorized scope' USING ERRCODE='23514';
      END IF;
      IF ref ? 'assetRevisionId' THEN
        SELECT * INTO dep FROM asset_revisions WHERE tenant_id=NEW.tenant_id AND id=(ref->>'assetRevisionId')::uuid;
        IF NOT asset_revision_usable(NEW.tenant_id,root.project_id,dep.id,old_ref IS NOT NULL)
          OR NOT EXISTS (SELECT 1 FROM asset_revision_media WHERE tenant_id=NEW.tenant_id AND asset_revision_id=dep.id AND media_id=source.id)
          OR (ref ? 'subjectAssetId' AND dep.asset_id<>(ref->>'subjectAssetId')::uuid) THEN
          RAISE EXCEPTION 'Media and subject must belong to the specified usable fixed revision' USING ERRCODE='23514';
        END IF;
      END IF;
      IF ref ? 'subjectAssetId' THEN
        SELECT * INTO subject FROM assets WHERE tenant_id=NEW.tenant_id AND id=(ref->>'subjectAssetId')::uuid;
        IF subject.id IS NULL OR (subject.status<>'active' AND old_ref IS NULL)
          OR (subject.project_id IS NOT NULL AND subject.project_id IS DISTINCT FROM root.project_id)
          OR (subject.scope='shared' AND root.project_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM shared_imports i JOIN asset_revisions r ON r.id=i.asset_revision_id
            WHERE i.tenant_id=NEW.tenant_id AND i.project_id=root.project_id AND r.asset_id=subject.id
          )) THEN
          RAISE EXCEPTION 'Reference subject must belong to the authorized scope' USING ERRCODE='23514';
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  IF NEW.definition ? 'defaultVoiceAssetRevisionId' THEN
    SELECT * INTO dep FROM asset_revisions WHERE tenant_id=NEW.tenant_id AND id=(NEW.definition->>'defaultVoiceAssetRevisionId')::uuid;
    IF NOT asset_revision_usable(NEW.tenant_id,root.project_id,dep.id,
      (parent.definition->>'defaultVoiceAssetRevisionId')::uuid IS NOT DISTINCT FROM dep.id)
      OR NOT EXISTS (SELECT 1 FROM assets WHERE id=dep.asset_id AND tenant_id=NEW.tenant_id AND kind='voice') THEN
      RAISE EXCEPTION 'Default voice must be a fixed voice asset in the authorized scope' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER asset_definition_valid BEFORE INSERT ON asset_revisions FOR EACH ROW EXECUTE FUNCTION validate_asset_definition();

CREATE FUNCTION project_asset_definition() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE look jsonb; ref jsonb; position integer; key text; definitions jsonb;
BEGIN
  FOR look IN SELECT value FROM jsonb_array_elements(coalesce(NEW.definition->'looks','[]')) LOOP
    INSERT INTO asset_looks(id,tenant_id,asset_id) VALUES ((look->>'id')::uuid,NEW.tenant_id,NEW.asset_id) ON CONFLICT (id) DO NOTHING;
    INSERT INTO asset_revision_looks(tenant_id,asset_id,asset_revision_id,look_id,number,definition)
      VALUES (NEW.tenant_id,NEW.asset_id,NEW.id,(look->>'id')::uuid,(look->>'revision')::bigint,look);
  END LOOP;
  definitions:=jsonb_build_array(jsonb_build_object('id','','references',NEW.definition->'references'))||coalesce(NEW.definition->'looks','[]');
  FOR look IN SELECT value FROM jsonb_array_elements(definitions) LOOP
    key:=look->>'id'; position:=0;
    FOR ref IN SELECT value FROM jsonb_array_elements(look->'references') LOOP
      INSERT INTO asset_revision_media(tenant_id,asset_revision_id,media_id,look_key,position,role,referenced_asset_revision_id,subject_asset_id)
        VALUES (NEW.tenant_id,NEW.id,(ref->>'mediaId')::uuid,key,position,ref->>'purpose',(ref->>'assetRevisionId')::uuid,(ref->>'subjectAssetId')::uuid);
      IF ref ? 'assetRevisionId' THEN
        INSERT INTO asset_revision_dependencies(tenant_id,asset_revision_id,referenced_asset_revision_id,purpose)
          VALUES (NEW.tenant_id,NEW.id,(ref->>'assetRevisionId')::uuid,'reference') ON CONFLICT DO NOTHING;
      END IF;
      position:=position+1;
    END LOOP;
  END LOOP;
  IF NEW.definition ? 'defaultVoiceAssetRevisionId' THEN
    INSERT INTO asset_revision_dependencies(tenant_id,asset_revision_id,referenced_asset_revision_id,purpose)
      VALUES (NEW.tenant_id,NEW.id,(NEW.definition->>'defaultVoiceAssetRevisionId')::uuid,'default_voice');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER asset_definition_projection AFTER INSERT ON asset_revisions FOR EACH ROW EXECUTE FUNCTION project_asset_definition();

CREATE FUNCTION validate_asset_projection() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE definition jsonb; expected jsonb;
BEGIN
  IF TG_TABLE_NAME='asset_looks' THEN
    IF NOT EXISTS (SELECT 1 FROM assets WHERE tenant_id=NEW.tenant_id AND id=NEW.asset_id AND kind='character') THEN
      RAISE EXCEPTION 'A look identity belongs to one character' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT r.definition INTO definition FROM asset_revisions r WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.asset_revision_id;
  IF TG_TABLE_NAME='asset_revision_looks' THEN
    SELECT value INTO expected FROM jsonb_array_elements(coalesce(definition->'looks','[]')) WHERE (value->>'id')::uuid=NEW.look_id;
    IF expected IS NULL OR expected<>NEW.definition OR (expected->>'revision')::bigint<>NEW.number THEN
      RAISE EXCEPTION 'Look projection must match the fixed definition' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='asset_revision_media' THEN
    IF NEW.look_key='' THEN expected:=definition->'references'->NEW.position;
    ELSE SELECT value->'references'->NEW.position INTO expected FROM jsonb_array_elements(coalesce(definition->'looks','[]')) WHERE value->>'id'=NEW.look_key; END IF;
    IF expected IS NULL OR (expected->>'mediaId')::uuid IS DISTINCT FROM NEW.media_id OR expected->>'purpose' IS DISTINCT FROM NEW.role
      OR (expected->>'assetRevisionId')::uuid IS DISTINCT FROM NEW.referenced_asset_revision_id
      OR (expected->>'subjectAssetId')::uuid IS DISTINCT FROM NEW.subject_asset_id THEN
      RAISE EXCEPTION 'Media projection must match the fixed definition' USING ERRCODE='23514';
    END IF;
  ELSE
    IF (NEW.purpose='default_voice' AND (definition->>'defaultVoiceAssetRevisionId')::uuid IS DISTINCT FROM NEW.referenced_asset_revision_id)
      OR (NEW.purpose='reference' AND NOT EXISTS (SELECT 1 FROM asset_revision_media WHERE tenant_id=NEW.tenant_id AND asset_revision_id=NEW.asset_revision_id AND referenced_asset_revision_id=NEW.referenced_asset_revision_id)) THEN
      RAISE EXCEPTION 'Dependency projection must match the fixed definition' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER asset_look_valid BEFORE INSERT ON asset_looks FOR EACH ROW EXECUTE FUNCTION validate_asset_projection();
CREATE TRIGGER asset_revision_look_valid BEFORE INSERT ON asset_revision_looks FOR EACH ROW EXECUTE FUNCTION validate_asset_projection();
CREATE TRIGGER asset_media_valid BEFORE INSERT ON asset_revision_media FOR EACH ROW EXECUTE FUNCTION validate_asset_projection();
CREATE TRIGGER asset_dependency_valid BEFORE INSERT ON asset_revision_dependencies FOR EACH ROW EXECUTE FUNCTION validate_asset_projection();
CREATE FUNCTION validate_shared_import() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.imported_by IS DISTINCT FROM actor_id() OR NOT EXISTS (
    SELECT 1 FROM asset_revisions r JOIN assets a ON a.id=r.asset_id
    WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.asset_revision_id AND a.scope='shared' AND a.status='active'
  ) THEN RAISE EXCEPTION 'Import must pin an active shared asset revision' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER shared_import_valid BEFORE INSERT ON shared_imports FOR EACH ROW EXECUTE FUNCTION validate_shared_import();
REVOKE ALL ON FUNCTION asset_revision_usable(uuid,uuid,uuid,boolean),validate_asset_definition(),project_asset_definition(),validate_asset_projection(),validate_shared_import() FROM PUBLIC;
