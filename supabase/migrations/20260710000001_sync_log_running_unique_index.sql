-- Prevent concurrent syncs for the same integration by enforcing
-- a unique partial index on running sync log entries.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_log_running_unique
  ON integration_sync_log (integration_id)
  WHERE status = 'running';
