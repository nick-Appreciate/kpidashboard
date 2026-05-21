/**
 * GET /api/admin/simmons/totp
 *
 * Generates the current 6-digit TOTP for the Simmons login, using the secret
 * stored in simmons-bot/.env (SIMMONS_TOTP_SECRET). Pure server-side — the
 * secret itself never leaves the server. Returns { code, secondsLeft }.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';
import { requireAdmin } from '../../../../../lib/auth';

let cachedSecret: string | null | undefined;

async function loadSecret(): Promise<string | null> {
  if (cachedSecret !== undefined) return cachedSecret;

  // Already in process env? (works in deployed environments)
  if (process.env.SIMMONS_TOTP_SECRET) {
    cachedSecret = process.env.SIMMONS_TOTP_SECRET;
    return cachedSecret;
  }

  // Local dev: read from simmons-bot/.env
  try {
    const envPath = path.join(process.cwd(), 'simmons-bot', '.env');
    const text = await readFile(envPath, 'utf8');
    const match = text.match(/^SIMMONS_TOTP_SECRET\s*=\s*(.+)$/m);
    cachedSecret = match ? match[1].trim().replace(/^["']|["']$/g, '') : null;
  } catch {
    cachedSecret = null;
  }
  return cachedSecret;
}

function generateTotp(secret: string, atUnixSeconds = Math.floor(Date.now() / 1000)) {
  let s = secret.replace(/\s/g, '').toUpperCase();
  const padding = 8 - (s.length % 8);
  if (padding !== 8) s += '='.repeat(padding);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s) {
    if (c === '=') break;
    const val = alphabet.indexOf(c);
    if (val === -1) throw new Error(`bad base32 char: ${c}`);
    bits += val.toString(2).padStart(5, '0');
  }
  const key = Buffer.from((bits.match(/.{1,8}/g) || []).map(b => parseInt(b, 2)));
  const counter = Math.floor(atUnixSeconds / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (
    ((hmac[offset]   & 0x7f) << 24) |
    ((hmac[offset+1] & 0xff) << 16) |
    ((hmac[offset+2] & 0xff) <<  8) |
     (hmac[offset+3] & 0xff)
  ) % 1000000;
  return code.toString().padStart(6, '0');
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ('error' in auth) return auth.error;

  const secret = await loadSecret();
  if (!secret) {
    return NextResponse.json(
      { error: 'SIMMONS_TOTP_SECRET not configured' },
      { status: 503 }
    );
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const code = generateTotp(secret, now);
    const secondsLeft = 30 - (now % 30);
    return NextResponse.json({ code, secondsLeft, generatedAt: new Date().toISOString() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
