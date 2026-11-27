-- The store now uses HomsCard only. Pause legacy SyriaMarket catalog jobs without deleting historical data.
do $disable_legacy$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname in (
      'baran-syrimarket-catalog-auto-sync',
      'baran-syrimarket-catalog-audit-sync'
    )
      and active
  loop
    perform cron.alter_job(job_id := v_job.jobid, active := false);
  end loop;
end;
$disable_legacy$;
