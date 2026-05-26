import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Sync Utility Meter Readings (BPU + COMO)
 *
 * Triggers the bot server to scrape meter reading data from both
 * mymeter.bpu.com and COMO MyUtilityBill portal, uploading to
 * bpu_meter_readings and como_meter_readings tables respectively.
 *
 * The bot server must be running and logged in (sessions persisted).
 * If a source is not logged in, it is skipped with a warning.
 * Manual re-login is required via `npm run login` / `npm run login:como` on the VPS.
 *
 * Invoke:
 *   curl -X POST '<SUPABASE_URL>/functions/v1/sync-bpu' \
 *     -H 'Authorization: Bearer <ANON_KEY>' \
 *     -H 'Content-Type: application/json' \
 *     -d '{"days": 14}'
 *
 * Body options:
 *   days: number        — number of days to look back (default: 14)
 *   start_date: string  — explicit start date YYYY-MM-DD (overrides days)
 *   end_date: string    — explicit end date YYYY-MM-DD (default: today)
 *   dry_run: boolean    — parse CSV but don't upload to Supabase (default: false)
 */

const botUrl = Deno.env.get('BPU_BOT_URL');       // e.g. https://your-hostinger-server.com:3101
const botSecret = Deno.env.get('BPU_BOT_SECRET'); // API_SECRET on the bot server

Deno.serve(async (req: Request) => {
  try {
    // Validate config
    if (!botUrl || !botSecret) {
      return new Response(
        JSON.stringify({
          error: 'BPU_BOT_URL and BPU_BOT_SECRET must be set as edge function secrets.',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    let days = 14;
    let startDate: string | undefined;
    let endDate: string | undefined;
    let dryRun = false;

    try {
      const body = await req.json();
      if (body.days) days = body.days;
      if (body.start_date) startDate = body.start_date;
      if (body.end_date) endDate = body.end_date;
      if (body.dry_run) dryRun = body.dry_run;
    } catch {
      // No body or invalid JSON — use defaults
    }

    // Calculate date range if not explicitly provided
    if (!startDate) {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - days);
      startDate = start.toISOString().split('T')[0];
    }
    if (!endDate) {
      endDate = new Date().toISOString().split('T')[0];
    }

    console.log(`[sync-bpu] Date range: ${startDate} to ${endDate} (dry_run: ${dryRun})`);

    // Step 1: Health check
    console.log(`[sync-bpu] Checking bot health at ${botUrl}...`);
    const healthRes = await fetch(`${botUrl}/api/health`, {
      headers: { Authorization: `Bearer ${botSecret}` },
    });

    if (!healthRes.ok) {
      const errText = await healthRes.text();
      return new Response(
        JSON.stringify({
          error: `Bot health check failed: ${healthRes.status} ${errText}`,
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const health = await healthRes.json();
    console.log(`[sync-bpu] Bot health:`, health);

    // Step 2: Trigger BPU scrape (fire-and-forget — bot uploads directly to Supabase)
    let bpuResult: any = null;
    if (health.bpu?.logged_in ?? health.logged_in) {
      console.log('[sync-bpu] Triggering BPU async scrape...');
      try {
        const scrapeRes = await fetch(`${botUrl}/api/scrape-async`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${botSecret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ start_date: startDate, end_date: endDate, dry_run: dryRun }),
        });

        bpuResult = await scrapeRes.json();
        console.log('[sync-bpu] BPU trigger result:', bpuResult);
      } catch (err) {
        console.error('[sync-bpu] BPU trigger error:', err);
        bpuResult = { triggered: false, error: (err as Error).message };
      }
    } else {
      console.warn('[sync-bpu] ⚠️  BPU not logged in — skipping. Run `npm run login` on VPS.');
      bpuResult = { triggered: false, error: 'Not logged in' };
    }

    // Step 3: Trigger COMO scrape (fire-and-forget)
    let comoResult: any = null;
    const comoLoggedIn = health.como?.logged_in ?? false;
    if (comoLoggedIn) {
      console.log('[sync-bpu] Triggering COMO async scrape...');
      try {
        const comoRes = await fetch(`${botUrl}/api/como/scrape-async`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${botSecret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ start_date: startDate, end_date: endDate, dry_run: dryRun }),
        });

        comoResult = await comoRes.json();
        console.log('[sync-bpu] COMO trigger result:', comoResult);
      } catch (err) {
        console.error('[sync-bpu] COMO trigger error:', err);
        comoResult = { triggered: false, error: (err as Error).message };
      }
    } else {
      console.warn('[sync-bpu] ⚠️  COMO not logged in — skipping. Run `npm run login:como` on VPS.');
      comoResult = { triggered: false, error: 'Not logged in' };
    }

    return new Response(JSON.stringify({ bpu: bpuResult, como: comoResult }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[sync-bpu] Unexpected error:', err);
    return new Response(
      JSON.stringify({ error: `Unexpected error: ${(err as Error).message}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
