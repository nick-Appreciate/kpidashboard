import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Sync BPU Meter Readings
 *
 * Triggers the BPU Bot server to scrape meter reading data from
 * mymeter.bpu.com and upload it to the bpu_meter_readings table.
 *
 * The bot server must be running and logged in (session persisted).
 * If not logged in, this function logs a warning — manual re-login
 * is required via `npm run login` on the VPS.
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

    if (!health.logged_in) {
      console.warn('[sync-bpu] ⚠️  Bot is NOT logged in. Manual login required on VPS.');
      return new Response(
        JSON.stringify({
          error:
            'BPU bot is not logged in. SSH into the VPS and run `npm run login` in the bpu-bot directory.',
          bot_url: health.current_url,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Step 2: Trigger scrape
    console.log('[sync-bpu] Triggering scrape...');
    const scrapeRes = await fetch(`${botUrl}/api/scrape`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        start_date: startDate,
        end_date: endDate,
        dry_run: dryRun,
      }),
    });

    if (!scrapeRes.ok) {
      const errText = await scrapeRes.text();
      console.error(`[sync-bpu] Scrape request failed: ${scrapeRes.status} ${errText}`);
      return new Response(
        JSON.stringify({
          error: `Scrape failed: ${scrapeRes.status}`,
          details: errText,
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const scrapeResult = await scrapeRes.json();
    console.log('[sync-bpu] Scrape result:', scrapeResult);

    return new Response(JSON.stringify(scrapeResult), {
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
