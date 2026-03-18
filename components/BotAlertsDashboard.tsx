'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../contexts/AuthContext';

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
  type: string;
  message: string;
}

interface BotStatusResponse {
  bots: BotHealth[];
  lastScrape: string | null;
  lastDataByBot: Record<string, string | null>;
  alerts: SystemAlert[];
  alertCount: number;
}

interface LoginFlow {
  bot: string;
  step: string;
  screenshot?: string;
  message?: string;
  loading: boolean;
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-rose-500/15 text-rose-400 border border-rose-500/30',
  warning: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  info: 'bg-blue-500/15 text-blue-400 border border-blue-500/30',
};

// ─── Component ───────────────────────────────────────────────────────────

export default function BotAlertsDashboard() {
  const { appUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<BotStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [loginFlow, setLoginFlow] = useState<LoginFlow | null>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [restarting, setRestarting] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && appUser?.role !== 'admin') {
      router.push('/');
    }
  }, [authLoading, appUser, router]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/bot-status');
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setLastRefresh(new Date());
      }
    } catch {
      // silently fail, will retry on next poll
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (appUser?.role === 'admin') fetchStatus();
    const interval = setInterval(() => {
      if (appUser?.role === 'admin') fetchStatus();
    }, 30000);
    return () => clearInterval(interval);
  }, [appUser, fetchStatus]);

  // ─── Login flow handlers ────────────────────────────────────────────

  async function handleLogin(botName: string) {
    setLoginFlow({ bot: botName, step: 'starting', loading: true });
    try {
      const res = await fetch('/api/admin/bot-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot: botName, action: 'login' }),
      });
      const result = await res.json();

      if (botName === 'appfolio') {
        setLoginFlow({
          bot: botName,
          step: result.step || 'unknown',
          screenshot: result.screenshot,
          message: result.instructions || result.message,
          loading: false,
        });
      } else {
        // BPU - login was triggered, credentials filled
        setLoginFlow({
          bot: botName,
          step: result.success ? 'success' : 'captcha_needed',
          message: result.message || 'Credentials filled. CAPTCHA must be solved on the VPS.',
          loading: false,
        });
        if (result.success) {
          fetchStatus();
          handleSync(botName);
        }
      }
    } catch (err: any) {
      setLoginFlow({ bot: botName, step: 'error', message: err.message, loading: false });
    }
  }

  async function handle2FASetup() {
    if (!loginFlow) return;
    setLoginFlow((f) => f && { ...f, loading: true });
    try {
      const res = await fetch('/api/admin/bot-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot: 'appfolio', action: '2fa-setup', phone: phone || 'skip' }),
      });
      const result = await res.json();
      setLoginFlow({
        bot: 'appfolio',
        step: 'code_entry',
        screenshot: result.screenshot,
        message: result.instructions || 'Enter the verification code sent to your phone.',
        loading: false,
      });
    } catch (err: any) {
      setLoginFlow((f) => f && { ...f, step: 'error', message: err.message, loading: false });
    }
  }

  async function handle2FAVerify() {
    if (!loginFlow || !code) return;
    setLoginFlow((f) => f && { ...f, loading: true });
    try {
      const res = await fetch('/api/admin/bot-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot: 'appfolio', action: '2fa-verify', code }),
      });
      const result = await res.json();
      if (result.success) {
        setLoginFlow({ bot: 'appfolio', step: 'success', message: 'Login successful!', loading: false });
        fetchStatus();
        handleSync('appfolio');
      } else {
        setLoginFlow({
          bot: 'appfolio',
          step: 'code_entry',
          screenshot: result.screenshot,
          message: result.error || 'Verification failed. Try again.',
          loading: false,
        });
      }
    } catch (err: any) {
      setLoginFlow((f) => f && { ...f, step: 'error', message: err.message, loading: false });
    }
  }

  async function handleCheckBPUStatus() {
    setLoginFlow((f) => f && { ...f, loading: true });
    await fetchStatus();
    const bpu = data?.bots.find((b) => b.name === 'bpu');
    if (bpu?.logged_in) {
      setLoginFlow({ bot: 'bpu', step: 'success', message: 'BPU session is now active!', loading: false });
    } else {
      setLoginFlow((f) => f && { ...f, message: 'Still not logged in. Solve the CAPTCHA on the VPS.', loading: false });
    }
  }

  // ─── Sync handler ──────────────────────────────────────────────────

  async function handleSync(botName: string) {
    setSyncing(botName);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/admin/bot-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot: botName, action: 'sync' }),
      });
      const result = await res.json();
      if (result.triggered) {
        setSyncMessage(`${botName} sync triggered`);
      } else {
        setSyncMessage(result.error || result.reason || 'Sync failed');
      }
    } catch (err: any) {
      setSyncMessage(`Sync error: ${err.message}`);
    } finally {
      setSyncing(null);
      setTimeout(() => setSyncMessage(null), 5000);
      setTimeout(fetchStatus, 5000);
    }
  }

  // ─── Restart handler (via VPS supervisor) ───────────────────────────

  async function handleRestart(botName: string) {
    setRestarting(botName);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/admin/bot-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot: botName, action: 'restart' }),
      });
      const result = await res.json();
      if (result.success) {
        setSyncMessage(`${botName} restart triggered — checking status...`);
        // Poll for reconnection after restart
        setTimeout(fetchStatus, 5000);
        setTimeout(fetchStatus, 10000);
        setTimeout(fetchStatus, 20000);
      } else {
        setSyncMessage(result.error || 'Restart failed');
      }
    } catch (err: any) {
      setSyncMessage(`Restart error: ${err.message}`);
    } finally {
      setRestarting(null);
    }
  }

  // ─── Guards ─────────────────────────────────────────────────────────

  if (authLoading || appUser?.role !== 'admin') {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-accent" />
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-accent" />
      </div>
    );
  }

  const bots = data?.bots || [];
  const alerts = data?.alerts || [];

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Bot Alerts</h1>
          <p className="text-sm text-slate-400 mt-1">Monitor scraper bots and system health</p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-[10px] text-slate-500">
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchStatus}
            className="px-3 py-1.5 text-xs font-medium bg-white/5 text-slate-300 rounded-md hover:bg-white/10 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Bot Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {bots.map((bot) => {
          const status = !bot.reachable ? 'down' : !bot.logged_in ? 'expired' : 'online';
          const statusText = !bot.reachable ? 'Unreachable' : !bot.logged_in ? 'Session Expired' : 'Online';
          const bgClass = { down: 'bg-rose-500/10', expired: 'bg-amber-500/10', online: 'bg-emerald-500/10' }[status];
          const dotClass = { down: 'bg-rose-500', expired: 'bg-amber-500', online: 'bg-emerald-500 animate-pulse' }[status];
          const textClass = { down: 'text-rose-400', expired: 'text-amber-400', online: 'text-emerald-400' }[status];

          return (
            <div key={bot.name} className="glass-stat">
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${bgClass}`}>
                      {bot.name === 'appfolio' ? (
                        <svg className={`w-5 h-5 ${textClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                      ) : (
                        <svg className={`w-5 h-5 ${textClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a8 8 0 008-8c0-3.5-2.5-6.5-4-8l-4 5-4-5c-1.5 1.5-4 4.5-4 8a8 8 0 008 8z" />
                        </svg>
                      )}
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-white">{bot.label}</h3>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`w-2 h-2 rounded-full ${dotClass}`} />
                        <span className={`text-xs ${textClass}`}>{statusText}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {bot.reachable && bot.logged_in && (
                      <button
                        onClick={() => handleSync(bot.name)}
                        disabled={syncing === bot.name}
                        className="px-3 py-1.5 text-xs font-medium bg-blue-500/15 text-blue-400 rounded-md hover:bg-blue-500/25 transition-colors disabled:opacity-50"
                      >
                        {syncing === bot.name ? 'Syncing...' : 'Sync Now'}
                      </button>
                    )}
                    {bot.reachable && !bot.logged_in && (
                      <button
                        onClick={() => handleLogin(bot.name)}
                        disabled={loginFlow?.loading}
                        className="px-3 py-1.5 text-xs font-medium bg-accent/15 text-accent rounded-md hover:bg-accent/25 transition-colors disabled:opacity-50"
                      >
                        Re-Login
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-1 text-xs text-slate-500">
                  <div className="flex justify-between">
                    <span>Port</span>
                    <span className="text-slate-400">{bot.port}</span>
                  </div>
                  {bot.error && (
                    <div className="flex justify-between">
                      <span>Error</span>
                      <span className="text-rose-400 truncate max-w-[200px]">{bot.error}</span>
                    </div>
                  )}
                  {data?.lastDataByBot?.[bot.name] && (
                    <div className="flex justify-between">
                      <span>Last Data</span>
                      <span className="text-slate-400">
                        {new Date(data.lastDataByBot[bot.name]!).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Unreachable state — actionable recovery panel */}
                {!bot.reachable && (
                  <div className="mt-3 p-3 bg-rose-500/5 border border-rose-500/20 rounded-lg space-y-2">
                    <p className="text-xs text-rose-300">
                      Bot process may have crashed or VPS is down.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleRestart(bot.name)}
                        disabled={restarting === bot.name}
                        className="px-3 py-1.5 text-xs font-medium bg-rose-500/15 text-rose-400 rounded-md hover:bg-rose-500/25 transition-colors disabled:opacity-50"
                      >
                        {restarting === bot.name ? 'Restarting...' : 'Restart Bot'}
                      </button>
                      <button
                        onClick={fetchStatus}
                        className="px-3 py-1.5 text-xs font-medium bg-white/5 text-slate-300 rounded-md hover:bg-white/10 transition-colors"
                      >
                        Retry Connection
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Login Flow Panel */}
      {loginFlow && loginFlow.step !== 'success' && (
        <div className="glass-card p-6 space-y-4">
          {loginFlow.bot === 'appfolio' && (
            <>
              <h3 className="text-lg font-semibold text-white">Appfolio Re-Login</h3>

              {loginFlow.loading && (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-accent" />
                  Processing...
                </div>
              )}

              {loginFlow.screenshot && (
                <img
                  src={loginFlow.screenshot}
                  alt="Login state"
                  className="rounded-lg border border-white/10 max-h-64 w-auto"
                />
              )}

              {loginFlow.message && (
                <p className="text-sm text-slate-400">{loginFlow.message}</p>
              )}

              {loginFlow.step === '2fa_required' && !loginFlow.loading && (
                <div className="flex gap-2">
                  <button
                    onClick={handle2FASetup}
                    className="px-4 py-2 text-xs font-medium bg-accent/15 text-accent rounded-md hover:bg-accent/25 transition-colors"
                  >
                    Send Verification Code via SMS
                  </button>
                </div>
              )}

              {loginFlow.step === 'code_entry' && !loginFlow.loading && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="6-digit code"
                    className="dark-input flex-1 text-sm tracking-widest font-mono"
                    value={code}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                      setCode(val);
                      if (val.length === 6) setTimeout(handle2FAVerify, 100);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && handle2FAVerify()}
                    maxLength={6}
                    autoFocus
                  />
                  <button
                    onClick={handle2FAVerify}
                    disabled={code.length !== 6}
                    className="px-4 py-2 text-xs font-medium bg-accent/15 text-accent rounded-md hover:bg-accent/25 transition-colors disabled:opacity-40"
                  >
                    Verify
                  </button>
                </div>
              )}
            </>
          )}

          {loginFlow.bot === 'bpu' && (
            <>
              <h3 className="text-lg font-semibold text-white">BPU Re-Login</h3>

              {loginFlow.loading && (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-accent" />
                  Processing...
                </div>
              )}

              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-sm text-amber-200">
                <p className="font-medium mb-2">CAPTCHA Required</p>
                <p className="text-amber-300/80">
                  BPU login requires solving a CAPTCHA in a visible browser. Credentials have been auto-filled on the VPS.
                </p>
                <p className="text-amber-300/70 mt-2 text-xs">
                  To solve: run the login helper on your laptop and transfer the session, or access the VPS via SSH with X11 forwarding.
                </p>
              </div>

              {loginFlow.message && (
                <p className="text-sm text-slate-400">{loginFlow.message}</p>
              )}

              <button
                onClick={handleCheckBPUStatus}
                disabled={loginFlow.loading}
                className="px-4 py-2 text-xs font-medium bg-accent/15 text-accent rounded-md hover:bg-accent/25 transition-colors disabled:opacity-50"
              >
                Check Login Status
              </button>
            </>
          )}

          <button
            onClick={() => setLoginFlow(null)}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            Close
          </button>
        </div>
      )}

      {loginFlow?.step === 'success' && (
        <div className="glass-card p-4 flex items-center justify-between">
          <span className="text-sm text-emerald-400">{loginFlow.message}</span>
          <button
            onClick={() => setLoginFlow(null)}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Sync Message */}
      {syncMessage && (
        <div className="glass-card p-3 flex items-center justify-between">
          <span className="text-sm text-blue-400">{syncMessage}</span>
          <button
            onClick={() => setSyncMessage(null)}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* System Alerts */}
      <div className="glass-card overflow-hidden">
        <div className="p-4 border-b border-white/5">
          <h2 className="text-sm font-semibold text-white">System Alerts</h2>
        </div>
        {alerts.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            All systems healthy. No active alerts.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-800/95 backdrop-blur">
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3 font-medium">Severity</th>
                  <th className="px-4 py-3 font-medium">Bot</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {alerts.map((alert, i) => (
                  <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.info}`}>
                        {alert.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{alert.bot}</td>
                    <td className="px-4 py-3 text-slate-400">{alert.type.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-slate-300">{alert.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
