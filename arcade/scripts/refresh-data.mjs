// Refreshes data/units.app.json (tenant-level, gitignored) for publishing the
// artifact, using the same builder as the live /api/arcade route.
//   node arcade/scripts/refresh-data.mjs [envFile]   (default: the repo's .env.local)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { arcadeUnits } from '../../lib/arcade/units.js';

const envFile = process.argv[2] || fileURLToPath(new URL('../../.env.local', import.meta.url));
const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const units = await arcadeUnits(supabase);
const out = new URL('../data/units.app.json', import.meta.url);
fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
fs.writeFileSync(out, JSON.stringify(units));
const flat = Object.entries(units).filter(([k]) => !k.startsWith('__')).flatMap(([, p]) => Object.entries(p).filter(([k]) => !k.startsWith('__')).map(([, v]) => v));
console.log('units', flat.length, '| open WOs', flat.reduce((t, v) => t + (v.wo || []).length, 0), '| past due', flat.filter((v) => v.due).length,
  '| delinquency', units.__dq.prior, '→', units.__dq.latest, '|', fs.statSync(out).size, 'bytes');
