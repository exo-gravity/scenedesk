-- A legal canvas spans +/-1,000,000 coordinates. At the positive 0.00001
-- zoom floor its ~2,001,600px width occupies ~20px, below the desktop viewport
-- (at least 240px high) even after fit padding. Fit chooses the actual larger
-- zoom from measured bounds; this floor must not crop a legal distant layout.
-- Preserve actor, CAS, coordinate, selection and private-preference guards.
CREATE OR REPLACE FUNCTION validate_scene_preference() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE p jsonb;
BEGIN
  p:=NEW.preference;
  IF NEW.user_id IS DISTINCT FROM actor_id() OR (TG_OP='INSERT' AND NEW.revision<>1)
    OR (TG_OP='UPDATE' AND ((NEW.tenant_id,NEW.project_id,NEW.scene_id,NEW.user_id) IS DISTINCT FROM (OLD.tenant_id,OLD.project_id,OLD.scene_id,OLD.user_id) OR NEW.revision<>OLD.revision+1)) THEN
    RAISE EXCEPTION 'Private preference version conflict' USING ERRCODE='P0412';
  END IF;
  IF p->>'mode' NOT IN ('storyboard','canvas') OR jsonb_typeof(p->'selectedNodeIds') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p->'selectedNodeIds')>2000
    OR NOT ((p->'viewport'->>'zoom')::numeric BETWEEN 0.00001 AND 4)
    OR NOT ((p->'viewport'->>'x')::numeric BETWEEN -1000000 AND 1000000)
    OR NOT ((p->'viewport'->>'y')::numeric BETWEEN -1000000 AND 1000000)
    OR (p->>'selectedShotId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shots WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND scene_id=NEW.scene_id AND id=(p->>'selectedShotId')::uuid)) THEN
    RAISE EXCEPTION 'Invalid scene preference' USING ERRCODE='P0425';
  END IF;
  -- A selection may reference a not-yet-saved local node. It carries no authority.
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION validate_scene_preference() FROM PUBLIC;
