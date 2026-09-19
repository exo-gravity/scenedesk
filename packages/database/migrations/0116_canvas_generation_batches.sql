-- Canvas multi-node generation: a batch is a grouping identity over the existing
-- one-plan-per-job facts. It owns no scheduling, cost or adoption of its own.
-- All items of one batch share one canvas revision, so the whole batch is fixed
-- against a single canvas state; the revision is never re-pointed after insert.
CREATE TABLE generation_batches (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 canvas_id uuid NOT NULL, scene_id uuid,
 canvas_revision bigint NOT NULL CHECK(canvas_revision > 0),
 created_by uuid NOT NULL REFERENCES users(id),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 9007199254740991),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,project_id,id),
 -- Lets an item prove it belongs to this batch's canvas without a trigger.
 UNIQUE(tenant_id,project_id,canvas_id,id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,project_id,canvas_id) REFERENCES canvases(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,scene_id) REFERENCES scenes(tenant_id,project_id,id)
);
CREATE INDEX generation_batches_canvas ON generation_batches(tenant_id,project_id,canvas_id,created_at DESC);
CREATE TABLE generation_batch_items (
 tenant_id uuid NOT NULL, project_id uuid NOT NULL, batch_id uuid NOT NULL,
 canvas_id uuid NOT NULL, node_id uuid NOT NULL, plan_id uuid NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','blocked','invalid')),
 problem_code text,
 blocking_reasons jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(batch_id,node_id),
 FOREIGN KEY(tenant_id,project_id,plan_id) REFERENCES generation_plans(tenant_id,project_id,id),
 -- A node of another canvas or project cannot be grouped into this batch.
 FOREIGN KEY(tenant_id,project_id,canvas_id,node_id) REFERENCES canvas_node_index(tenant_id,project_id,canvas_id,node_id)
);
-- Replaces the plain batch reference so the canvas_id above is provably the batch's.
ALTER TABLE generation_batch_items ADD FOREIGN KEY(tenant_id,project_id,canvas_id,batch_id) REFERENCES generation_batches(tenant_id,project_id,canvas_id,id);
-- Every selected node gets exactly one item, including a node that could not become
-- a plan: that item carries a blocked plan row recording why, so the confirmation
-- screen accounts for the whole selection and the reason survives a reload.
-- Selection order is not restated here: each item's plan origin already carries the
-- ordered source nodes the plan was fixed against.
-- `status` is the verdict on the item's *fixed plan* and is written once at prepare:
-- `ready` (executable when its plan is ready and unexpired), `blocked` (the plan
-- itself is blocked) or `invalid` (the node never became a plan). An execution that
-- is refused later leaves `status` alone and records only `problem_code`, so a
-- refused item stays retryable instead of being parked in a dead state.
CREATE FUNCTION guard_generation_batch_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'Batch grouping is immutable' USING ERRCODE='23514';
 END IF;
 IF (to_jsonb(NEW)-ARRAY['problem_code','blocking_reasons','updated_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['problem_code','blocking_reasons','updated_at']) THEN
  RAISE EXCEPTION 'Batch item grouping is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER generation_batch_item_guard BEFORE UPDATE OR DELETE ON generation_batch_items FOR EACH ROW EXECUTE FUNCTION guard_generation_batch_item();
-- The batch itself never changes grouping, canvas or revision; only its change
-- token moves, so a client can tell that item state advanced.
CREATE FUNCTION guard_generation_batch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'A generation batch is immutable' USING ERRCODE='23514';
 END IF;
 IF (to_jsonb(NEW)-ARRAY['revision','updated_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revision','updated_at'])
    OR NEW.revision<>OLD.revision+1 THEN
  RAISE EXCEPTION 'A generation batch is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER generation_batch_guard BEFORE UPDATE OR DELETE ON generation_batches FOR EACH ROW EXECUTE FUNCTION guard_generation_batch();
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['generation_batches','generation_batch_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY generation_batch_scope ON %I USING(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL) WITH CHECK(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL)',t);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION guard_generation_batch_item(),guard_generation_batch() FROM PUBLIC;
