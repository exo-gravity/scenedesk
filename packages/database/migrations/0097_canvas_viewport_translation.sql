-- Viewport translation is a screen-space transform, not a node coordinate.
-- +/-8,000,000 = 2 * max zoom 4 * node coordinate limit 1,000,000.
-- This covers centering and zooming at either legal node boundary.
-- CanvasPoint, zoom, private actor ownership and preference CAS are unchanged.
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
    OR NOT ((p->'viewport'->>'x')::numeric BETWEEN -8000000 AND 8000000)
    OR NOT ((p->'viewport'->>'y')::numeric BETWEEN -8000000 AND 8000000)
    OR (p->>'selectedShotId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shots WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND scene_id=NEW.scene_id AND id=(p->>'selectedShotId')::uuid)) THEN
    RAISE EXCEPTION 'Invalid scene preference' USING ERRCODE='P0425';
  END IF;
  -- A selection may reference a not-yet-saved local node. It carries no authority.
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION validate_scene_preference() FROM PUBLIC;
