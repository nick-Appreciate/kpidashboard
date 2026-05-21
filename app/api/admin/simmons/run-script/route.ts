/**
 * /api/admin/simmons/run-script
 *
 * POST { script: 'capture' | 'extract', args?: string[] } → starts a job
 *   { id, started }
 *
 * GET ?id=<jobId>&since=<lineCount> → returns
 *   { status: 'running' | 'done' | 'failed', exitCode, lines: string[], totalLines }
 *
 * GET (no id) → returns the most recent job state
 *
 * Jobs are tracked in-memory per dev-server process. Only one job per
 * script type may run at a time.
 */

import { NextRequest, NextResponse } from 'next/server';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import { requireAdmin } from '../../../../../lib/auth';

type ScriptName = 'capture' | 'extract';

interface Job {
  id: string;
  script: ScriptName;
  args: string[];
  pid: number;
  startedAt: string;
  endedAt: string | null;
  status: 'running' | 'done' | 'failed';
  exitCode: number | null;
  lines: string[];
  proc: ChildProcessWithoutNullStreams;
}

// Module-level state (lives for the lifetime of the dev-server process)
declare global {
  // eslint-disable-next-line no-var
  var __simmonsJobs: Map<string, Job> | undefined;
  // eslint-disable-next-line no-var
  var __simmonsActiveByScript: Map<ScriptName, string> | undefined;
}
const jobs = globalThis.__simmonsJobs ??= new Map<string, Job>();
const activeByScript = globalThis.__simmonsActiveByScript ??= new Map<ScriptName, string>();

const MAX_LINES = 2000;
const SIMMONS_BOT_DIR = path.join(process.cwd(), 'simmons-bot');

function pushLine(job: Job, line: string) {
  job.lines.push(`${new Date().toISOString().slice(11, 19)}  ${line}`);
  if (job.lines.length > MAX_LINES) job.lines.splice(0, job.lines.length - MAX_LINES);
}

function spawnScript(script: ScriptName, args: string[]): Job {
  const id = `${script}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const file = script === 'capture' ? 'capture.mjs' : 'extract.mjs';

  const proc = spawn('node', [file, ...args], {
    cwd: SIMMONS_BOT_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  }) as ChildProcessWithoutNullStreams;

  const job: Job = {
    id, script, args,
    pid: proc.pid || 0,
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: 'running',
    exitCode: null,
    lines: [],
    proc,
  };
  jobs.set(id, job);
  activeByScript.set(script, id);

  pushLine(job, `▶ node ${file} ${args.join(' ')}`.trim());

  proc.stdout.on('data', (buf: Buffer) => {
    for (const line of buf.toString().split(/\r?\n/)) {
      if (line.trim()) pushLine(job, line);
    }
  });
  proc.stderr.on('data', (buf: Buffer) => {
    for (const line of buf.toString().split(/\r?\n/)) {
      if (line.trim()) pushLine(job, `⚠ ${line}`);
    }
  });
  proc.on('close', (code) => {
    job.exitCode = code;
    job.endedAt = new Date().toISOString();
    job.status = code === 0 ? 'done' : 'failed';
    pushLine(job, `── exited with code ${code} ──`);
    if (activeByScript.get(script) === id) activeByScript.delete(script);
  });
  proc.on('error', (err) => {
    pushLine(job, `spawn error: ${err.message}`);
    job.status = 'failed';
    job.endedAt = new Date().toISOString();
    if (activeByScript.get(script) === id) activeByScript.delete(script);
  });

  return job;
}

function snapshot(job: Job, sinceLine: number) {
  const tail = sinceLine > 0 ? job.lines.slice(sinceLine) : job.lines.slice(-200);
  return {
    id: job.id,
    script: job.script,
    args: job.args,
    pid: job.pid,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    status: job.status,
    exitCode: job.exitCode,
    totalLines: job.lines.length,
    lines: tail,
  };
}

// ── POST: start a job ─────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const script: ScriptName = body?.script;
  const args: string[] = Array.isArray(body?.args) ? body.args.map(String) : [];

  if (script !== 'capture' && script !== 'extract') {
    return NextResponse.json({ error: 'script must be "capture" or "extract"' }, { status: 400 });
  }

  // Don't allow two of the same script to run concurrently
  const existingId = activeByScript.get(script);
  if (existingId) {
    const existing = jobs.get(existingId);
    if (existing && existing.status === 'running') {
      return NextResponse.json(
        { error: `A ${script} job is already running`, jobId: existingId },
        { status: 409 }
      );
    }
  }

  // Whitelist args to prevent shell injection (we're using spawn so no shell,
  // but still — limit to known flags)
  const allowed = new Set(['--force', '--dry-run', '--limit', '--since']);
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i]) && !/^[0-9-]+$/.test(args[i]) && !/^\d{4}-\d{2}-\d{2}$/.test(args[i])) {
      return NextResponse.json({ error: `disallowed arg: ${args[i]}` }, { status: 400 });
    }
  }

  const job = spawnScript(script, args);
  return NextResponse.json({ id: job.id, started: true });
}

// ── GET: poll status / read log tail ──────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const since = parseInt(searchParams.get('since') || '0', 10);

  // No id → return the most recent job per script
  if (!id) {
    const recent: Record<string, any> = {};
    for (const script of ['capture', 'extract'] as ScriptName[]) {
      const activeId = activeByScript.get(script);
      const j = activeId ? jobs.get(activeId) : null;
      if (j) recent[script] = snapshot(j, 0);
    }
    return NextResponse.json({ active: recent });
  }

  const job = jobs.get(id);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });
  return NextResponse.json(snapshot(job, since));
}

// ── DELETE: kill a running job ────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const job = jobs.get(id);
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 });
  if (job.status === 'running') {
    try {
      job.proc.kill('SIGTERM');
      pushLine(job, '── killed by user ──');
    } catch {}
  }
  return NextResponse.json({ ok: true });
}
