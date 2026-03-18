import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '../../../../lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ─── Types ───────────────────────────────────────────────────────────────

interface BotConfig {
  name: string;
  label: string;
  port: number;
  url: string;
  secret: string;
}

interface BotHealth {
  name: string;
  label: string;
  port: number;
  ok: boolean;
  logged_in: boolean;
  current_url: string;
  reachable: boolean;
  error?: string;
}

interface SystemAlert {
  severity: 'critical' | 'warning' | 'info';
  bot: string;
  type: 'bot_down' | 'session_expired' | 'stale_data';
  message: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

async function getBotConfigs(): Promise<BotConfig[]> {
  const { data, error } = await supabaseAdmin
    .from('bot_config')
    .select('name, label, port, url, secret')
    .neq('name', 'supervisor');
  if (error || !data) return [];
  return data;
}

async function fetchBotHealth(bot: BotConfig): Promise<BotHealth> {
  try {
    const res = await fetch(`${bot.url}/api/health`, {
      headers: { Authorization: `Bearer ${bot.secret}` },
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    return { name: bot.name, label: bot.label, port: bot.port, ok: data.ok, logged_in: data.logged_in, current_url: data.current_url || '', reachable: true };
  } catch (err: any) {
    return { name: bot.name, label: bot.label, port: bot.port, ok: false, logged_in: false, current_url: '', reachable: false, error: err.message };
  }
}

async function fetchLastScrapeTimestamp(): Promise<string | null> {
  const { data } = await supabase
    .from('bpu_meter_readings')
    .select('reading_timestamp')
    .order('reading_timestamp', { ascending: false })
    .limit(1);
  return data?.[0]?.reading_timestamp || null;
}

async function fetchLastDataTimestamps(): Promise<Record<string, string | null>> {
  const [bpu, simmons, appfolio] = await Promise.all([
    supabase.from('bpu_meter_readings').select('reading_timestamp').order('reading_timestamp', { ascending: false }).limit(1),
    supabase.from('simmons_scrape_log').select('completed_at').in('status', ['completed', 'partial']).order('completed_at', { ascending: false }).limit(1),
    supabase.from('bills').select('appfolio_synced_at').order('appfolio_synced_at', { ascending: false }).limit(1),
  ]);
  return {
    bpu: bpu.data?.[0]?.reading_timestamp || null,
    simmons: simmons.data?.[0]?.completed_at || null,
    appfolio: appfolio.data?.[0]?.appfolio_synced_at || null,
  };
}

function deriveAlerts(bots: BotHealth[], lastScrape: string | null): SystemAlert[] {
  const alerts: SystemAlert[] = [];
  for (const bot of bots) {
    if (!bot.reachable) {
      alerts.push({ severity: 'critical', bot: bot.name, type: 'bot_down', message: `${bot.label} bot is unreachable` });
    } else if (!bot.logged_in) {
      alerts.push({ severity: 'warning', bot: bot.name, type: 'session_expired', message: `${bot.label} session expired — re-login required` });
    }
  }
  if (lastScrape) {
    const hoursAgo = (Date.now() - new Date(lastScrape).getTime()) / (1000 * 60 * 60);
    if (hoursAgo > 48) {
      alerts.push({ severity: 'warning', bot: 'bpu', type: 'stale_data', message: `Last BPU data is ${Math.round(hoursAgo)} hours old` });
    }
  }
  return alerts;
}

// ─── GET: Fetch bot health + alerts ──────────────────────────────────────

export async function GET() {
  try {
    const configs = await getBotConfigs();
    const healthPromises = configs.map((bot) => fetchBotHealth(bot));
    const [bots, lastScrape, lastDataByBot] = await Promise.all([
      Promise.all(healthPromises),
      fetchLastScrapeTimestamp(),
      fetchLastDataTimestamps(),
    ]);
    const alerts = deriveAlerts(bots, lastScrape);
    return NextResponse.json({ bots, lastScrape, lastDataByBot, alerts, alertCount: alerts.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}

// ─── Supervisor config (for remote PM2 restart) ─────────────────────────

async function getSupervisorConfig(): Promise<{ url: string; secret: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('bot_config')
    .select('url, secret')
    .eq('name', 'supervisor')
    .single();
  if (error || !data) return null;
  return data;
}

// Bot name → PM2 process name mapping
const PM2_PROCESS_NAMES: Record<string, string> = {
  bpu: 'bpu-bot',
  simmons: 'simmons-bot',
};

// ─── POST: Proxy login/sync/restart actions to bots ─────────────────────

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { bot, action, ...params } = body;

    // Handle restart action via supervisor (separate service)
    if (action === 'restart') {
      const pm2Name = PM2_PROCESS_NAMES[bot];
      if (!pm2Name) {
        return NextResponse.json({ error: `No PM2 process for bot: ${bot}` }, { status: 400 });
      }

      const supervisor = await getSupervisorConfig();
      if (!supervisor) {
        return NextResponse.json({ error: 'Supervisor not configured in bot_config table' }, { status: 500 });
      }

      const res = await fetch(`${supervisor.url}/restart/${pm2Name}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supervisor.secret}` },
        signal: AbortSignal.timeout(15000),
      });

      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    }

    const configs = await getBotConfigs();
    const botConfig = configs.find((b) => b.name === bot);
    if (!botConfig) {
      return NextResponse.json({ error: `Unknown bot: ${bot}` }, { status: 400 });
    }

    const endpoints: Record<string, string> = {
      login: '/api/login',
      '2fa-setup': '/api/login/2fa-setup',
      '2fa-verify': '/api/login/2fa-verify',
      screenshot: '/api/login/screenshot',
      sync: '/api/scrape-async',
      'sync-como': '/api/como/scrape-async',
    };

    const endpoint = endpoints[action];
    if (!endpoint) {
      return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 });
    }

    // For sync actions, inject default 14-day date range if not provided
    let forwardParams = params;
    if (action === 'sync' || action === 'sync-como') {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - 14);
      forwardParams = {
        start_date: start.toISOString().split('T')[0],
        end_date: now.toISOString().split('T')[0],
        ...params,
      };
    }

    const res = await fetch(`${botConfig.url}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${botConfig.secret}` },
      body: JSON.stringify(forwardParams),
      signal: AbortSignal.timeout(30000),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
