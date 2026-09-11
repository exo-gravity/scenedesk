-- Complete the existing ordered, immutable shot projection. A historical spec
-- remains the source even if the mutable shot head is edited or archived later.
CREATE OR REPLACE FUNCTION guard_prompt_plan_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source jsonb; saved jsonb; expected jsonb; pos integer:=0; selected jsonb;
BEGIN
 IF NEW.input->>'purpose' NOT IN ('creative_assistance','image','video','audio') THEN RETURN NULL; END IF;
 selected:=coalesce(NEW.input->'shotSources','[]'::jsonb);
 IF jsonb_typeof(selected) IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.resolved_input->'shots') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Fixed shot sources must be arrays' USING ERRCODE='23514';
 END IF;
 IF (SELECT count(*) FROM generation_plan_shots WHERE plan_id=NEW.id)<>jsonb_array_length(selected)
  OR jsonb_array_length(NEW.resolved_input->'shots')<>jsonb_array_length(selected) THEN
  RAISE EXCEPTION 'Fixed shot projection missing' USING ERRCODE='23514';
 END IF;
 FOR source IN SELECT value FROM jsonb_array_elements(selected) LOOP
  IF NOT EXISTS(SELECT 1 FROM generation_plan_shots WHERE plan_id=NEW.id AND position=pos AND shot_id=(source->>'shotId')::uuid AND shot_revision_id=(source->>'shotRevisionId')::uuid) THEN
   RAISE EXCEPTION 'Fixed shot projection differs' USING ERRCODE='23514';
  END IF;
  SELECT spec INTO saved FROM shot_revisions WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND shot_id=(source->>'shotId')::uuid AND id=(source->>'shotRevisionId')::uuid;
  IF saved IS NULL OR NEW.resolved_input->'shots'->pos->'spec' IS DISTINCT FROM saved THEN
   RAISE EXCEPTION 'Fixed shot spec differs' USING ERRCODE='23514';
  END IF;
  expected:=jsonb_build_object(
   'shotId',(source->>'shotId')::uuid,'shotRevisionId',(source->>'shotRevisionId')::uuid,
   'spec',saved,'entryState',coalesce(saved->'entryState','{}'::jsonb),'exitState',coalesce(saved->'exitState','{}'::jsonb)
  );
  IF NEW.resolved_input->'shots'->pos IS DISTINCT FROM expected THEN
   RAISE EXCEPTION 'Fixed resolved shot projection differs' USING ERRCODE='23514';
  END IF;
  pos:=pos+1;
 END LOOP;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION guard_prompt_plan_sources() FROM PUBLIC;
