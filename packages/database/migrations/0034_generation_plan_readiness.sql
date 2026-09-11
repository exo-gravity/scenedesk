-- 0030 removed the automatically named ready-plan guard while extending purpose.
-- Keep applied migrations immutable and restore the invariant under an explicit name.
ALTER TABLE generation_plans ADD CONSTRAINT generation_plans_ready_cost_check
  CHECK (status <> 'ready' OR (cost_estimate IS NOT NULL AND blocking_reasons = '[]'));
