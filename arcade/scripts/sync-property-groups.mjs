// Copies the dashboard's property-grouping rules (lib/propertyGroups.js) into
// the arcade page, verbatim, plus the filter dropdown options built from them.
// The arcade runs on claude.ai and can't import from the repo at runtime, so
// this is the import step. build.mjs runs it on every build; it rewrites
// src/Main.dc.html in place, so a change to the dashboard rules shows up as
// a diff here too.
//   node arcade/scripts/sync-property-groups.mjs
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LIB = fileURLToPath(new URL('../../lib/propertyGroups.js', import.meta.url));
const PAGE = new URL('../src/Main.dc.html', import.meta.url);
const SITES = new URL('../data/sites.json', import.meta.url);

export async function syncPropertyGroups() {
const G = await import(pathToFileURL(LIB).href);         // proves the module loads as-is
const src = fs.readFileSync(LIB, 'utf8');
if (/^\s*import\s/m.test(src)) throw new Error('propertyGroups.js now imports other modules; inline them before syncing');
const body = src.replace(/^export\s+(?=const|function|async function|let|class)/gm, '');
const exported = Object.keys(G).sort();

const method = [
  '  // <property-groups> GENERATED from lib/propertyGroups.js by sync-property-groups.mjs.',
  '  // Do not edit here; change the dashboard file and re-run the sync.',
  '  propertyGroups() {',
  ...body.trimEnd().split('\n').map((l) => (l ? '    ' + l : '')),
  `    return { ${exported.join(', ')} };`,
  '  }',
  '  // </property-groups>',
].join('\n');

const esc = (t) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const opt = (v, l) => `<option value="${esc(v)}">${esc(l)}</option>`;
const presets = G.PRESET_PROPERTY_OPTIONS;
const regions = presets.filter((o) => o.value.startsWith('region_'));
const props = JSON.parse(fs.readFileSync(SITES, 'utf8')).flatMap((site) => site.props).sort((a, b) => a.localeCompare(b));
const select = [
  '<select class="pfsel" aria-label="Filter by portfolio" value="{{pf}}" onChange="{{setPf}}">',
  '        ' + opt('portfolio', 'Portfolio'),
  ...presets.filter((o) => !o.value.startsWith('region_')).map((o) => '        ' + opt(o.value, o.label)),
  `        <optgroup label="Regions">${regions.map((o) => opt(o.value, o.label)).join('')}</optgroup>`,
  `        <optgroup label="Properties">${props.map((p) => opt(p, p)).join('')}</optgroup>`,
  '      </select>',
].join('\n');

let page = fs.readFileSync(PAGE, 'utf8');
const startTag = '  // <property-groups>', endTag = '  // </property-groups>';
if (page.includes(startTag)) {
  const a = page.indexOf(startTag), b = page.indexOf(endTag) + endTag.length;
  page = page.slice(0, a) + method + page.slice(b);
} else {
  const anchor = '  renderVals() {';
  if (!page.includes(anchor)) throw new Error('renderVals() not found');
  page = page.replace(anchor, method + '\n\n' + anchor);
}
const sel = /<select class="pfsel"[\s\S]*?<\/select>/;
if (!sel.test(page)) throw new Error('filter <select> not found');
page = page.replace(sel, select);
fs.writeFileSync(PAGE, page);
console.log('synced', exported.length, 'exports,', presets.length, 'presets,', props.length, 'properties from lib/propertyGroups.js');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await syncPropertyGroups();
