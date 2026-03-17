import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Sync Simmons Bank Deposits
 *
 * Triggers the simmons-bot server to scrape deposit data and check images
 * from all active Simmons Bank accounts, then runs Claude extraction on
 * any new un-extracted check images.
 *
 * The bot server must be running and logged in (sessions auto-persist via TOTP).
 *
 * Invoke:
 *   curl -X POST '<SUPABASE_URL>/functions/v1/sync-simmons' \
 *     -H 'Authorization: Bearer <ANON_KEY>' \
 *     -H 'Content-Type: application/json' \
 *     -d '{"days": 14}'
 *
 * Body options:
 *   days: number        — number of days to look back (default: 14)
 *   start_date: string  — explicit start date YYYY-MM-DD (overrides days)
 *   end_date: string    — explicit end date YYYY-MM-DD (default: today)
 *   extract: boolean    — run Claude extraction on new images (default: true)
 *   dry_run: boolean    — scrape but don't upload to Supabase (default: false)
 */

const botUrl = Deno.env.get('SIMMONS_BOT_URL');       // e.g. https://your-hostinger-server.com:3102
const botSecret = Deno.env.get('SIMMONS_BOT_SECRET'); // API_SECRET on the bot server

Deno.serve(async (req: Request) => {
  try {
    if (!botUrl || !botSecret) {
      return new Response(
        JSON.stringify({
          error: 'SIMMONS_BOT_URL and SIMMONS_BOT_SECRET must be set as edge function secrets.',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    let days = 14;
    let startDate: string | undefined;
    let endDate: string | undefined;
    let extract = true;
    let dryRun = false;

    try {
      const body = await req.json();
      if (body.days) days = body.days;
      if (body.start_date) startDate = body.start_date;
      if (body.end_date) endDate = body.end_date;
      if (body.extract !== undefined) extract = body.extract;
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

    console.log(`[sync-simmons] Date range: ${startDate} to ${endDate} (extract: ${extract}, dry_run: ${dryRun})`);

    // Step 1: Health check
    console.log(`[sync-simmons] Checking bot health at ${botUrl}...`);
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
    console.log(`[sync-simmons] Bot health:`, health);

    if (!health.logged_in) {
      // Simmons bot can auto-login with TOTP, so try logging in first
      console.log('[sync-simmons] Not logged in, triggering auto-login...');
      try {
        const loginRes = await fetch(`${botUrl}/api/login`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${botSecret}` },
        });
        const loginResult = await loginRes.json();
        console.log('[sync-simmons] Login result:', loginResult);

        if (!loginResult.success) {
          return new Response(
            JSON.stringify({ error: 'Auto-login failed', details: loginResult }),
            { status: 502, headers: { 'Content-Type': 'application/json' } }
          );
        }
      } catch (err) {
        return new Response(
          JSON.stringify({ error: `Login request failed: ${(err as Error).message}` }),
          { status: 502, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // Step 2: Trigger async scrape (fire-and-forget — bot uploads directly to Supabase)
    console.log('[sync-simmons] Triggering async scrape...');
    let scrapeResult: any = null;

    try {
      const scrapeRes = await fetch(`${botUrl}/api/scrape-async`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${botSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          start_date: startDate,
          end_date: endDate,
          extract,
          dry_run: dryRun,
        }),
      });

      scrapeResult = await scrapeRes.json();
      console.log('[sync-simmons] Scrape trigger result:', scrapeResult);
    } catch (err) {
      console.error('[sync-simmons] Scrape trigger error:', err);
      scrapeResult = { triggered: false, error: (err as Error).message };
    }

    return new Response(JSON.stringify({ scrape: scrapeResult }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[sync-simmons] Unexpected error:', err);
    return new Response(
      JSON.stringify({ error: `Unexpected error: ${(err as Error).message}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
