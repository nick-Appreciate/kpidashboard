/**
 * VPS Supervisor Service
 *
 * Lightweight always-on service that can restart bot processes via PM2.
 * Runs on a separate port (3199) so it's reachable even when bots are down.
 *
 * Endpoints:
 *   GET  /health              — supervisor health check
 *   POST /restart/:botName    — restart a PM2 process (bpu-bot, simmons-bot)
 *   GET  /status              — PM2 status of all managed processes
 *
 * Deploy:
 *   pm2 start dist/server.js --name vps-supervisor
 *   (included in ecosystem.config.cjs)
 */

import 'dotenv/config';
import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3199');
const API_SECRET = process.env.API_SECRET || 'changeme';

// Only allow restarting these specific processes
const ALLOWED_PROCESSES = ['bpu-bot', 'simmons-bot'];

// ─── Auth Middleware ──────────────────────────────────────────────────────

function requireAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== API_SECRET) {
    return res.status(401).json({ error: 'Invalid API_SECRET' });
  }
  next();
}

app.use('/restart', requireAuth);
app.use('/status', requireAuth);

// ─── Routes ──────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'vps-supervisor', uptime: process.uptime() });
});

app.get('/status', async (_req, res) => {
  try {
    const { stdout } = await execAsync('pm2 jlist');
    const processes = JSON.parse(stdout);
    const summary = processes
      .filter((p: any) => ALLOWED_PROCESSES.includes(p.name))
      .map((p: any) => ({
        name: p.name,
        status: p.pm2_env?.status,
        restarts: p.pm2_env?.restart_time,
        uptime: p.pm2_env?.pm_uptime,
        memory: p.monit?.memory,
        cpu: p.monit?.cpu,
      }));
    res.json({ processes: summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/restart/:botName', async (req, res) => {
  const { botName } = req.params;

  if (!ALLOWED_PROCESSES.includes(botName)) {
    return res.status(400).json({
      error: `Unknown process: ${botName}. Allowed: ${ALLOWED_PROCESSES.join(', ')}`,
    });
  }

  try {
    console.log(`[supervisor] Restarting ${botName}...`);
    const { stdout, stderr } = await execAsync(`pm2 restart ${botName}`);
    console.log(`[supervisor] ${botName} restarted.`);
    res.json({
      success: true,
      message: `${botName} restarted`,
      stdout: stdout.trim(),
    });
  } catch (err: any) {
    console.error(`[supervisor] Failed to restart ${botName}:`, err.message);
    res.status(500).json({
      success: false,
      error: `Failed to restart ${botName}: ${err.message}`,
    });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🔧 VPS Supervisor running on port ${PORT}`);
  console.log(
    `   API Secret: ${API_SECRET === 'changeme' ? '⚠️  DEFAULT (set API_SECRET env var!)' : '✓ set'}`
  );
  console.log(`   Managed processes: ${ALLOWED_PROCESSES.join(', ')}`);
  console.log('');
});

export default app;
