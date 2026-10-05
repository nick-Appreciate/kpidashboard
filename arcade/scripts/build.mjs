// Builds the publishable arcade into arcade/dist/project/.
//   node arcade/scripts/build.mjs
// 1. Syncs the dashboard's property-group rules into src/Main.dc.html.
// 2. Copies src/ to dist/project/, filling unitsData() with data/units.app.json.
// Tenant names, phones and balances live only in data/ and dist/, which are
// gitignored: the repo is public. Refresh the data first with
//   node arcade/scripts/fetch-units.js && node arcade/scripts/build-units.js
//   node arcade/scripts/fetch-dq.js && node arcade/scripts/merge-units.js
import fs from 'node:fs';
import { syncPropertyGroups } from './sync-property-groups.mjs';

const at = (p) => new URL('../' + p, import.meta.url);
const PLACEHOLDER = 'return {} /* @units: filled in by scripts/build.mjs from data/units.app.json */;';

await syncPropertyGroups();
if (!fs.existsSync(at('data/units.app.json'))) throw new Error('data/units.app.json is missing; run the data refresh in this file\'s header first');
const units = fs.readFileSync(at('data/units.app.json'), 'utf8');
fs.mkdirSync(at('dist/project'), { recursive: true });
for (const f of fs.readdirSync(at('src'))) {
  let text = fs.readFileSync(at('src/' + f), 'utf8');
  if (f === 'Main.dc.html') {
    if (!text.includes(PLACEHOLDER)) throw new Error('unitsData() placeholder not found in src/Main.dc.html');
    text = text.replace(PLACEHOLDER, 'return ' + units + ';');
  }
  fs.writeFileSync(at('dist/project/' + f), text);
}
console.log('built dist/project:', fs.readdirSync(at('dist/project')).join(', '));
