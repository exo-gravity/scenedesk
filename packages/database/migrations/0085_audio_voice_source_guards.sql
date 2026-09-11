-- Fixed voice descriptions are actual authorized asset definitions, never caller-authored snapshots.
CREATE FUNCTION guard_audio_voice_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snapshot jsonb;source asset_revisions;shot jsonb;voice_id text;reference jsonb;
BEGIN
 IF NEW.input->>'purpose'<>'audio' THEN RETURN NULL;END IF;
 FOR snapshot IN SELECT value FROM jsonb_array_elements(coalesce(NEW.resolved_input->'contextSnapshots','[]')) WHERE value->'source'->>'kind'='asset_revision' LOOP
  SELECT * INTO source FROM asset_revisions WHERE tenant_id=NEW.tenant_id AND id=(snapshot->'source'->>'objectId')::uuid AND asset_revision_usable(NEW.tenant_id,NEW.project_id,id,false);
  IF source.id IS NULL OR source.revision IS DISTINCT FROM (snapshot->'source'->>'revision')::bigint OR (snapshot->>'text')::jsonb IS DISTINCT FROM (source.definition-ARRAY['references','looks']) THEN RAISE EXCEPTION 'Audio asset snapshot differs from its actual fixed source' USING ERRCODE='23514';END IF;
 END LOOP;
 FOR shot IN SELECT value FROM jsonb_array_elements(coalesce(NEW.resolved_input->'shots','[]')) LOOP
  FOR voice_id IN SELECT value->>'voiceAssetRevisionId' FROM jsonb_array_elements(coalesce(shot->'spec'->'dialogue','[]')) UNION SELECT value->>'voiceAssetRevisionId' FROM jsonb_array_elements(coalesce(shot->'spec'->'entryState'->'characters','[]')) UNION SELECT value->>'voiceAssetRevisionId' FROM jsonb_array_elements(coalesce(shot->'spec'->'exitState'->'characters','[]')) LOOP
   IF voice_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(NEW.resolved_input->'contextSnapshots','[]')) s JOIN asset_revisions r ON r.id=(s->'source'->>'objectId')::uuid JOIN assets a ON a.id=r.asset_id WHERE s->'source'->>'kind'='asset_revision' AND r.id=voice_id::uuid AND a.kind='voice') THEN RAISE EXCEPTION 'Selected dialogue or continuity voice requires its fixed source snapshot' USING ERRCODE='23514';END IF;
  END LOOP;
 END LOOP;
 FOR reference IN SELECT value->'reference' FROM jsonb_array_elements(coalesce(NEW.resolved_input->'references','[]')) WHERE value->'reference'->>'purpose'='voice' AND value->'reference' ? 'assetRevisionId' LOOP
  IF NOT EXISTS(SELECT 1 FROM asset_revisions r JOIN assets a ON a.id=r.asset_id JOIN asset_revision_media m ON m.asset_revision_id=r.id WHERE r.tenant_id=NEW.tenant_id AND r.id=(reference->>'assetRevisionId')::uuid AND a.kind='voice' AND m.media_id=(reference->>'mediaId')::uuid) THEN RAISE EXCEPTION 'Voice reference must belong to its actual fixed voice asset' USING ERRCODE='23514';END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER audio_voice_sources_fixed AFTER INSERT ON generation_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_audio_voice_sources();
REVOKE ALL ON FUNCTION guard_audio_voice_sources() FROM PUBLIC;
