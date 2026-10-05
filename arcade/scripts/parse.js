const fs = require('fs');
function parse(file) {
  const x = fs.readFileSync(file, 'utf8');
  const nodes = new Map();
  for (const m of x.matchAll(/<node id="(\d+)"[^>]*?lat="([-\d.]+)" lon="([-\d.]+)"/g)) nodes.set(m[1], [+m[2], +m[3]]);
  const ways = [];
  for (const m of x.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
    const body = m[2];
    const tags = {};
    for (const t of body.matchAll(/<tag k="([^"]+)" v="([^"]*)"/g)) tags[t[1]] = t[2];
    const nds = [...body.matchAll(/<nd ref="(\d+)"/g)].map((n) => nodes.get(n[1])).filter(Boolean);
    ways.push({ id: m[1], tags, nds });
  }
  // address points (nodes with addr tags)
  const addrNodes = [];
  for (const m of x.matchAll(/<node id="(\d+)"[^>]*?lat="([-\d.]+)" lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/node>/g)) {
    const tags = {};
    for (const t of m[4].matchAll(/<tag k="([^"]+)" v="([^"]*)"/g)) tags[t[1]] = t[2];
    if (tags['addr:housenumber']) addrNodes.push({ lat: +m[2], lon: +m[3], hn: tags['addr:housenumber'], st: tags['addr:street'] || '' });
  }
  return { ways, addrNodes };
}
module.exports = { parse };
if (require.main === module) {
  const [file, lat, lon, radius] = process.argv.slice(2);
  const { ways, addrNodes } = parse(file);
  const M_LAT = 111320, M_LON = 111320 * Math.cos((+lat * Math.PI) / 180);
  const toXY = ([la, lo]) => [(lo - +lon) * M_LON, (+lat - la) * M_LAT]; // x east, y south (m)
  const out = [];
  for (const w of ways) {
    if (!w.tags.building || w.nds.length < 4) continue;
    const pts = w.nds.map(toXY);
    let A = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length - 1; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[i + 1]; const c = x1 * y2 - x2 * y1; A += c; cx += (x1 + x2) * c; cy += (y1 + y2) * c; }
    A /= 2; cx /= 6 * A; cy /= 6 * A;
    const d = Math.hypot(cx, cy);
    if (d > +radius) continue;
    out.push({ id: w.id, d: Math.round(d), area: Math.round(Math.abs(A)), cx: Math.round(cx), cy: Math.round(cy), nv: pts.length - 1, b: w.tags.building, addr: (w.tags['addr:housenumber'] || '') + ' ' + (w.tags['addr:street'] || ''), name: w.tags.name || '' });
  }
  out.sort((a, b) => a.d - b.d);
  for (const o of out) console.log(`way ${o.id}  d=${String(o.d).padStart(4)}m  area=${String(o.area).padStart(5)}m2  centre(E${o.cx},S${o.cy})  v=${o.nv}  ${o.b}  ${o.addr.trim()} ${o.name}`);
  const near = addrNodes.map((a) => ({ ...a, xy: toXY([a.lat, a.lon]) })).filter((a) => Math.hypot(...a.xy) < +radius);
  if (near.length) console.log('addr nodes:', near.map((a) => a.hn + ' ' + a.st + ' @E' + Math.round(a.xy[0]) + ',S' + Math.round(a.xy[1])).join(' | '));
}
