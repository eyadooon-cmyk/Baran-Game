REVOKE ALL ON FUNCTION private.run_baran_monitor() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.run_baran_monitor() TO service_role;

SELECT cron.schedule(
  'baran-game-admin-monitor-15m',
  '*/15 * * * *',
  'select private.run_baran_monitor();'
);
