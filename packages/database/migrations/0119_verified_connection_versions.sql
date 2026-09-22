-- The executor may learn which verified connection versions exist without reading the tenant-scoped capability table.
CREATE FUNCTION list_verified_connection_versions() RETURNS SETOF uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT DISTINCT connection_version_id FROM generation_capabilities WHERE execution_mode='verified_provider';
END $$;
REVOKE ALL ON FUNCTION list_verified_connection_versions() FROM PUBLIC;
