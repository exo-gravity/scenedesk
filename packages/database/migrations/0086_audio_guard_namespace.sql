-- Resolve immutable source tables in this schema, even if a caller has temporary objects.
ALTER FUNCTION guard_audio_voice_sources() SET search_path FROM CURRENT;
