-- S0 infrastructure metadata only. M01-M06 product tables are future migrations.
CREATE TABLE runtime_metadata (
  key text PRIMARY KEY,
  value text NOT NULL
);
INSERT INTO runtime_metadata (key, value) VALUES ('implementation_phase', 's0');
