import fs from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { requireAuth } from '../../../lib/auth';
import { arcadeUnits } from '../../../lib/arcade/units';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// The arcade page (arcade/src/Main.dc.html) with live tenant-level data filled
// into unitsData(). The repo is public, so that data only ever leaves through
// this authenticated route — never in the committed source or the JS bundle.
const PAGE = path.join(process.cwd(), 'arcade/src/Main.dc.html');
const PLACEHOLDER = 'return {} /* @units: filled in by scripts/build.mjs from data/units.app.json */;';

export async function GET(request) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const [template, units] = await Promise.all([fs.readFile(PAGE, 'utf8'), arcadeUnits(auth.supabase)]);
    if (!template.includes(PLACEHOLDER)) throw new Error('unitsData() placeholder missing from arcade/src/Main.dc.html');
    const page = template.replace(PLACEHOLDER, () => 'return ' + JSON.stringify(units) + ';');
    return NextResponse.json({ page }, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (err) {
    console.error('arcade:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
