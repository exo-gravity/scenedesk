-- Distinguish previous-reference rows from the trigger OLD record.
CREATE OR REPLACE FUNCTION project_assistance_references() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reference jsonb; offset_number integer:=0; kept boolean;
BEGIN
 IF NEW.number=1 THEN
  IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Original artifact requires execution evidence' USING ERRCODE='42501'; END IF;
 ELSIF NEW.edited_by IS DISTINCT FROM actor_id() OR NEW.number<>(SELECT revision+1 FROM assistance_artifacts WHERE id=NEW.artifact_id) THEN RAISE EXCEPTION 'Assistance edit must append under current actor' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(NEW.body->'referenceSuggestions')<>'array' OR jsonb_array_length(NEW.body->'referenceSuggestions')>100 THEN RAISE EXCEPTION 'Invalid assistance references' USING ERRCODE='23514'; END IF;
 FOR reference IN SELECT value FROM jsonb_array_elements(NEW.body->'referenceSuggestions') LOOP
  IF NOT EXISTS(SELECT 1 FROM media m WHERE m.tenant_id=NEW.tenant_id AND m.id=(reference->>'mediaId')::uuid AND (m.project_id IS NULL OR m.project_id=NEW.project_id)) THEN RAISE EXCEPTION 'Reference outside project' USING ERRCODE='23514'; END IF;
  SELECT EXISTS(SELECT 1 FROM assistance_artifact_revisions r CROSS JOIN LATERAL jsonb_array_elements(r.body->'referenceSuggestions') previous_reference(value) WHERE r.artifact_id=NEW.artifact_id AND r.number=NEW.number-1 AND (previous_reference.value-'note')=(reference-'note')) INTO kept;
  IF NEW.number>1 AND NOT kept THEN
   IF NOT EXISTS(SELECT 1 FROM media WHERE tenant_id=NEW.tenant_id AND id=(reference->>'mediaId')::uuid AND status='ready') OR (reference ? 'assetRevisionId' AND NOT asset_revision_usable(NEW.tenant_id,NEW.project_id,(reference->>'assetRevisionId')::uuid,false)) OR (reference ? 'subjectAssetId' AND NOT asset_identity_usable(NEW.tenant_id,NEW.project_id,(reference->>'subjectAssetId')::uuid,false)) THEN RAISE EXCEPTION 'New reference unavailable' USING ERRCODE='23514'; END IF;
  END IF;
  IF reference ? 'assetRevisionId' AND NOT EXISTS(SELECT 1 FROM asset_revision_media WHERE tenant_id=NEW.tenant_id AND asset_revision_id=(reference->>'assetRevisionId')::uuid AND media_id=(reference->>'mediaId')::uuid) THEN RAISE EXCEPTION 'Reference media differs from asset revision' USING ERRCODE='23514'; END IF;
  INSERT INTO assistance_revision_refs(tenant_id,project_id,artifact_id,number,position,media_id,asset_revision_id,subject_asset_id) VALUES(NEW.tenant_id,NEW.project_id,NEW.artifact_id,NEW.number,offset_number,(reference->>'mediaId')::uuid,(reference->>'assetRevisionId')::uuid,(reference->>'subjectAssetId')::uuid);
  offset_number:=offset_number+1;
 END LOOP;
 RETURN NEW;
END $$;
