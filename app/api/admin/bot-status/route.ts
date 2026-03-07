import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

export const dynamic = 'force-dynamic';

// ─── Types ───────────────────────────────────────────────────────────────

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

// ─── Bot Config ──────────────────────────────────────────────────────────

const BOTS = [
  { name: 'appfolio', label: 'Appfolio', port: 3100, urlEnv: 'APPFOLIO_BOT_URL', secretEnv: 'APPFOLIO_BOT_SECRET' },
  { name: 'bpu', label: 'BPU Utility', port: 3101, urlEnv: 'BPU_BOT_URL', secretEnv: 'BPU_BOT_SECRET' },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────

async function fetchBotHealth(
  name: string,
  label: string,
  port: number,
  url: string | undefined,
  secret: string | undefined
): Promise<BotHealth> {
  if (!url || !secret) {
    return { name, label, port, ok: false, logged_in: false, current_url: '', reachable: false, error: 'Not configured' };
  }
  try {
    const res = await fetch(`${url}/api/health`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    return { name, label, port, ok: data.ok, logged_in: data.logged_in, current_url: data.current_url || '', reachable: true };
  } catch (err: any) {
    return { name, label, port, ok: false, logged_in: false, current_url: '', reachable: false, error: err.message };
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
    const envDebug = BOTS.map((b) => ({
      name: b.name,
      urlEnv: b.urlEnv,
      secretEnv: b.secretEnv,
      hasUrl: !!process.env[b.urlEnv],
      hasSecret: !!process.env[b.secretEnv],
    }));
    console.log('Bot env check:', JSON.stringify(envDebug));

    const healthPromises = BOTS.map((b) =>
      fetchBotHealth(b.name, b.label, b.port, process.env[b.urlEnv], process.env[b.secretEnv])
    );
    const [bots, lastScrape] = await Promise.all([
      Promise.all(healthPromises),
      fetchLastScrapeTimestamp(),
    ]);
    const alerts = deriveAlerts(bots, lastScrape);
    return NextResponse.json({ bots, lastScrape, alerts, alertCount: alerts.length, _envDebug: envDebug });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}

// ─── POST: Proxy login actions to bots ───────────────────────────────────

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { bot, action, ...params } = body;

    const botConfig = BOTS.find((b) => b.name === bot);
    if (!botConfig) {
      return NextResponse.json({ error: `Unknown bot: ${bot}` }, { status: 400 });
    }

    const url = process.env[botConfig.urlEnv];
    const secret = process.env[botConfig.secretEnv];
    if (!url || !secret) {
      return NextResponse.json({ error: `Bot ${bot} not configured` }, { status: 400 });
    }

    const endpoints: Record<string, string> = {
      login: '/api/login',
      '2fa-setup': '/api/login/2fa-setup',
      '2fa-verify': '/api/login/2fa-verify',
      screenshot: '/api/login/screenshot',
    };

    const endpoint = endpoints[action];
    if (!endpoint) {
      return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 });
    }

    const res = await fetch(`${url}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(30000),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
