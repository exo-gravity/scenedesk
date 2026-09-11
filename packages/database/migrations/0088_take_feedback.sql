-- Take feedback is a fixed candidate discussion, not a Cut approval or rework decision.
CREATE TABLE reviews (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  take_id uuid NOT NULL, number bigint NOT NULL CHECK(number BETWEEN 1 AND 9007199254740991),
  status text NOT NULL DEFAULT 'open' CHECK(status='open'),
  opened_by uuid NOT NULL REFERENCES users(id), revision bigint NOT NULL DEFAULT 1 CHECK(revision=1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,project_id,id), UNIQUE(take_id,number),
  FOREIGN KEY(tenant_id,project_id,take_id) REFERENCES takes(tenant_id,project_id,id)
);
CREATE UNIQUE INDEX review_one_open_take ON reviews(take_id) WHERE status='open';
CREATE INDEX reviews_project_history ON reviews(tenant_id,project_id,created_at,id);
CREATE TABLE review_comments (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL, review_id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES users(id),
  start_us bigint CHECK(start_us BETWEEN 0 AND 9007199254740991),
  end_us bigint CHECK(end_us BETWEEN 1 AND 9007199254740991), parent_comment_id uuid,
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 5000 AND body ~ '[^[:space:]]'),
  resolved boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(end_us IS NULL OR (start_us IS NOT NULL AND end_us>start_us)),
  CHECK(parent_comment_id IS DISTINCT FROM id),
  UNIQUE(tenant_id,project_id,review_id,id),
  FOREIGN KEY(tenant_id,project_id,review_id) REFERENCES reviews(tenant_id,project_id,id),
  FOREIGN KEY(tenant_id,project_id,review_id,parent_comment_id) REFERENCES review_comments(tenant_id,project_id,review_id,id)
);
CREATE INDEX review_comments_history ON review_comments(tenant_id,project_id,review_id,created_at,id);
CREATE INDEX review_comments_time ON review_comments(review_id,start_us,id);
CREATE TABLE review_comment_revisions (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, review_id uuid NOT NULL, comment_id uuid NOT NULL,
  number bigint NOT NULL CHECK(number BETWEEN 1 AND 9007199254740991),
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 5000 AND body ~ '[^[:space:]]'), resolved boolean NOT NULL,
  edited_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(comment_id,number), UNIQUE(tenant_id,project_id,review_id,comment_id,number),
  FOREIGN KEY(tenant_id,project_id,review_id,comment_id) REFERENCES review_comments(tenant_id,project_id,review_id,id)
);
ALTER TABLE review_comments ADD CONSTRAINT review_comment_current_revision
  FOREIGN KEY(tenant_id,project_id,review_id,id,revision)
  REFERENCES review_comment_revisions(tenant_id,project_id,review_id,comment_id,number) DEFERRABLE INITIALLY DEFERRED;
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['reviews','review_comments','review_comment_revisions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',name);
    EXECUTE format('CREATE POLICY review_project_scope ON %I USING(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL) WITH CHECK(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL)',name);
  END LOOP;
END $$;
CREATE FUNCTION validate_take_review() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE candidate takes; source media; next_number bigint;
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM tenant_scope() OR project_role(NEW.project_id) IS NULL OR NEW.opened_by IS DISTINCT FROM actor_id()
    OR NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND status='active') THEN
    RAISE EXCEPTION 'Review requires current project authority and its actual actor' USING ERRCODE='P0425';
  END IF;
  -- The immutable subject is the lock identity, so future review decisions can share this order.
  PERFORM pg_advisory_xact_lock(hashtextextended('take-review:'||NEW.take_id::text,0));
  SELECT * INTO candidate FROM takes WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND id=NEW.take_id;
  SELECT * INTO source FROM media WHERE tenant_id=NEW.tenant_id AND id=candidate.media_id;
  IF candidate.id IS NULL OR source.status IS DISTINCT FROM 'ready' OR source.kind IS DISTINCT FROM 'video'
    OR (source.project_id IS NOT NULL AND source.project_id<>NEW.project_id) THEN
    RAISE EXCEPTION 'Review requires an authorized ready candidate video' USING ERRCODE='P0423';
  END IF;
  SELECT coalesce(max(number),0)+1 INTO next_number FROM reviews WHERE take_id=NEW.take_id;
  IF NEW.number<>next_number THEN RAISE EXCEPTION 'Review round must append under its subject lock' USING ERRCODE='P0409'; END IF;
  NEW.created_at:=now();
  RETURN NEW;
END $$;
CREATE TRIGGER take_review_valid BEFORE INSERT ON reviews FOR EACH ROW EXECUTE FUNCTION validate_take_review();
CREATE TRIGGER take_review_immutable BEFORE UPDATE OR DELETE ON reviews FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
CREATE FUNCTION validate_review_comment() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE duration bigint;
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM tenant_scope() OR project_role(NEW.project_id) IS NULL
    OR NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND status='active') THEN
    RAISE EXCEPTION 'Comment requires current project authority' USING ERRCODE='P0425';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.author_id IS DISTINCT FROM actor_id() OR NEW.revision<>1 OR NEW.resolved THEN
      RAISE EXCEPTION 'Comment must start with its author and first unresolved version' USING ERRCODE='P0425';
    END IF;
    SELECT t.out_us-t.in_us INTO duration FROM reviews r JOIN takes t ON t.id=r.take_id
      WHERE r.tenant_id=NEW.tenant_id AND r.project_id=NEW.project_id AND r.id=NEW.review_id AND r.status='open';
    IF duration IS NULL OR NEW.start_us>=duration OR NEW.end_us>duration THEN
      RAISE EXCEPTION 'Comment time is outside its fixed Take local interval' USING ERRCODE='P0423';
    END IF;
    NEW.created_at:=now();
  ELSE
    IF (to_jsonb(NEW)-ARRAY['body','resolved','revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['body','resolved','revision','updated_at'])
      OR NEW.revision<>OLD.revision+1 THEN
      RAISE EXCEPTION 'Comment edits preserve identity and append one version' USING ERRCODE='P0412';
    END IF;
    IF NEW.body IS DISTINCT FROM OLD.body AND OLD.author_id IS DISTINCT FROM actor_id() THEN
      RAISE EXCEPTION 'Only the author may edit comment text' USING ERRCODE='P0425';
    END IF;
  END IF;
  NEW.updated_at:=now();
  RETURN NEW;
END $$;
CREATE TRIGGER review_comment_valid BEFORE INSERT OR UPDATE ON review_comments FOR EACH ROW EXECUTE FUNCTION validate_review_comment();
CREATE TRIGGER review_comment_no_delete BEFORE DELETE ON review_comments FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
-- History is produced by the authorized root mutation, never supplied by the API role.
CREATE FUNCTION snapshot_review_comment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  INSERT INTO review_comment_revisions(tenant_id,project_id,review_id,comment_id,number,body,resolved,edited_by)
    VALUES(NEW.tenant_id,NEW.project_id,NEW.review_id,NEW.id,NEW.revision,NEW.body,NEW.resolved,actor_id());
  RETURN NULL;
END $$;
CREATE TRIGGER review_comment_snapshot AFTER INSERT OR UPDATE ON review_comments FOR EACH ROW EXECUTE FUNCTION snapshot_review_comment();
CREATE TRIGGER review_comment_revision_immutable BEFORE UPDATE OR DELETE ON review_comment_revisions FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
REVOKE ALL ON reviews,review_comments,review_comment_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_take_review(),validate_review_comment(),snapshot_review_comment() FROM PUBLIC;
