/**
 * POST /api/admin/simmons/launch-chrome
 *
 * Spawns a Chrome window with the CDP debug port + the dedicated debug profile
 * directory, so simmons-bot/capture.mjs can connect to it. Local-dev only —
 * fails gracefully on serverless hosts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { rm } from 'fs/promises';
import { requireAdmin } from '../../../../../lib/auth';

const pexec = promisify(exec);

const CDP_PORT = 9222;
const USER_DATA_DIR = `${process.env.HOME}/.chrome-debug-profile`;
const SIMMONS_LOGIN = 'https://login.simmonsbank.com/login';

// Kill any Chrome process holding the debug profile, then wipe the directory.
// Targeted by the unique --user-data-dir flag so we never touch the user's
// normal Chrome. Returns silently if nothing to clean.
async function wipeDebugProfile(): Promise<void> {
  try {
    // pkill -f matches the full command line; the user-data-dir path is unique
    // enough that no other process should match. `|| true` so non-zero exit
    // (= no matching process) doesn't throw.
    await pexec(`pkill -f "user-data-dir=${USER_DATA_DIR}" || true`);
  } catch { /* non-fatal */ }
  // Give Chrome a moment to release file locks
  await new Promise(r => setTimeout(r, 800));
  try {
    await rm(USER_DATA_DIR, { recursive: true, force: true });
  } catch { /* non-fatal */ }
}

async function isChromeRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${CDP_PORT}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;

  // Always nuke the debug profile first — Banno aggressively flags devices
  // after repeated session deaths. A fresh profile every launch sidesteps
  // any cached device-trust state that might trigger "verify your info".
  await wipeDebugProfile();

  // Launch Chrome with the dedicated debug profile, opening Simmons login.
  try {
    const cmd = `open -na "Google Chrome" --args --remote-debugging-port=${CDP_PORT} --user-data-dir="${USER_DATA_DIR}" "${SIMMONS_LOGIN}"`;
    await pexec(cmd);
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Could not launch Chrome: ' + (e?.message || String(e)) },
      { status: 500 }
    );
  }

  // Wait up to 7 seconds for CDP to come up
  for (let i = 0; i < 14; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await isChromeRunning()) {
      return NextResponse.json({ ok: true, fresh: true, port: CDP_PORT });
    }
  }

  return NextResponse.json(
    { error: 'Chrome launched but CDP did not start on port ' + CDP_PORT },
    { status: 500 }
  );
}
