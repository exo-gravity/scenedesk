-- 0081's guard only ever admitted a test_fixture capability for image/video/audio
-- plans, so a verified_provider capability could never reach "ready" at the
-- database layer even once verified and estimated by the API. Mirror the same
-- purpose/mode authorization the API now applies in media-input.ts.
CREATE OR REPLACE FUNCTION guard_generation_plan_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_text text; selected text; first_offset integer; last_offset integer;
BEGIN
 IF NEW.input->>'purpose' IN ('image','video','audio') THEN
  IF NEW.input ? 'sourceScriptRevisionId' OR NEW.input ? 'scriptRange' OR NEW.input ? 'assistance' OR NEW.resolved_input ? 'sourceExcerpt' OR NOT EXISTS(
    SELECT 1 FROM generation_capabilities
    WHERE id=NEW.capability_id AND definition->>'purpose'=NEW.input->>'purpose' AND (
      (execution_mode='test_fixture' AND definition->>'mode'=(NEW.input->>'purpose')||'_fixture_v1')
      OR (execution_mode='verified_provider' AND definition->>'mode' IN ('frames_v1','reference_v1'))
    )
  ) THEN RAISE EXCEPTION 'Media generation requires a distinct executable capability and explicit source' USING ERRCODE='23514';END IF;RETURN NEW;
 END IF;
 IF NEW.input->>'purpose'='creative_assistance' THEN
  IF NEW.input ? 'sourceScriptRevisionId' OR NEW.input ? 'scriptRange' OR NEW.resolved_input ? 'sourceExcerpt' THEN RAISE EXCEPTION 'Prompt assistance selects fixed shot and explicit context sources' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT text INTO source_text FROM script_revisions WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND id=(NEW.input->>'sourceScriptRevisionId')::uuid;
 first_offset:=(NEW.input->'scriptRange'->>'startOffset')::integer;last_offset:=(NEW.input->'scriptRange'->>'endOffset')::integer;
 selected:=substring(source_text FROM first_offset+1 FOR greatest(0,last_offset-first_offset));
 IF source_text IS NULL OR first_offset<0 OR last_offset<=first_offset OR last_offset>length(source_text) OR NEW.resolved_input->'sourceExcerpt'->>'scriptRevisionId' IS DISTINCT FROM NEW.input->>'sourceScriptRevisionId' OR NEW.resolved_input->'sourceExcerpt'->'range' IS DISTINCT FROM NEW.input->'scriptRange' OR NEW.resolved_input->'sourceExcerpt'->>'quote' IS DISTINCT FROM selected THEN RAISE EXCEPTION 'Fixed script source does not match' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
