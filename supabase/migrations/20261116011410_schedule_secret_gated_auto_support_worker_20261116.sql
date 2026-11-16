SELECT cron.schedule(
  'baran-auto-support-worker',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := 'https://tjvuqgcyvbowyfenrpau.supabase.co/functions/v1/baran-auto-support-reply',
      body := '{"dry_run":false}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-baran-cron-secret',(select token from private.baran_auto_support_secret where id=true)
      ),
      timeout_milliseconds := 10000
    );
  $job$
);
