const fs = require('fs');
process.chdir(require('path').join(__dirname, '../data/osm')); // reads the .osm extracts, writes ../sites.json
const { parse } = require('./parse.js');
const cache = {};
const load = (f) => (cache[f] = cache[f] || (() => { const x = fs.readFileSync(f, 'utf8'); const p = parse(f);
  // highways need node coords too
  const nodes = new Map(); for (const m of x.matchAll(/<node id="(\d+)"[^>]*?lat="([-\d.]+)" lon="([-\d.]+)"/g)) nodes.set(m[1], [+m[2], +m[3]]);
  return { ...p, nodes }; })());
const wayLL = (f, id) => { const w = load(f).ways.find((w) => w.id === String(id)); if (!w) throw new Error('missing way ' + id + ' in ' + f); return w.nds.slice(0, -1); };

// Hilltop: traced from Esri World Imagery z19, tile centre (124287.5, 200101.5), 0.232 m/px, 1280px mosaic centred on that tile.
const tile2ll = (x, y, z) => { const n = 2 ** z; const lng = (x / n) * 360 - 180; const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI; return [lat, lng]; };
const HC = { tx: 124287.5, ty: 200101.5 };
const px2ll = (px, py) => tile2ll(HC.tx + (px - 640) / 256, HC.ty + (py - 640) / 256, 19);
const rectLL = (x0, y0, x1, y1) => [px2ll(x0, y0), px2ll(x1, y0), px2ll(x1, y1), px2ll(x0, y1)];
const WG = (() => { const z = 19, n = 2 ** z, lat = 38.96780, lng = -92.30200; const fx = ((lng + 180) / 360) * n; const fy = ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n; return { tx0: Math.floor(fx) - 2, ty0: Math.floor(fy) - 2 }; })();
const pxW = (px, py) => tile2ll(WG.tx0 + px / 256, WG.ty0 + py / 256, 19);
const rectW = (x0, y0, x1, y1) => [pxW(x0, y0), pxW(x1, y0), pxW(x1, y1), pxW(x0, y1)];
const seq = (from, to, step, suf) => { const o = []; for (let n = from; step > 0 ? n <= to : n >= to; n += step) o.push(n + suf); return o; };

const H = 'hilltop.osm';
const sites = [
  { id: 'hilltop', props: ['Hilltop Townhomes'], osm: H, buildings: [
    { prop: 'Hilltop Townhomes', addr: '2621–2637 Farrow Ave', ll: rectLL(500, 546, 678, 598), floors: 2, mode: 'town', units: seq(2621, 2637, 2, 'F') },
    { prop: 'Hilltop Townhomes', addr: '2601–2615 Farrow Ave', ll: rectLL(696, 546, 855, 598), floors: 2, mode: 'town', units: seq(2601, 2615, 2, 'F') },
    { prop: 'Hilltop Townhomes', addr: '2620–2636 Delavan Ave', ll: rectLL(498, 743, 676, 795), floors: 2, mode: 'town', units: seq(2620, 2636, 2, 'D') },
    { prop: 'Hilltop Townhomes', addr: '2600–2614 Delavan Ave', ll: rectLL(690, 743, 852, 795), floors: 2, mode: 'town', units: seq(2600, 2614, 2, 'D') },
    { prop: 'Hilltop Townhomes', addr: '2621–2637 Delavan Ave', ll: rectLL(497, 912, 676, 968), floors: 2, mode: 'town', units: seq(2621, 2637, 2, 'D') },
    { prop: 'Hilltop Townhomes', addr: '2601–2615 Delavan Ave', ll: rectLL(693, 912, 857, 968), floors: 2, mode: 'town', units: seq(2601, 2615, 2, 'D') },
  ] },
  { id: 'oakwood', props: ['Oakwood Gardens'], osm: 'oakwood.osm', buildings: [
    { prop: 'Oakwood Gardens', addr: '3301 Wood Ave', way: 985686301, floors: 3, units: ['1','2','3','4','5','6','7','8','9','10','11'] },
    { prop: 'Oakwood Gardens', addr: '3303 Wood Ave', way: 985686314, floors: 3, units: ['12','14','15','16','17','18','19','20','21','22','23','24','25','26'] },
    { prop: 'Oakwood Gardens', addr: '3305 Wood Ave', way: 985685910, floors: 3, units: ['27','28','29','30','31','32','33','34','35','36','37'] },
    { prop: 'Oakwood Gardens', addr: '3307 Wood Ave', way: 985685759, floors: 3, units: seq(38, 51, 1, '') },
  ] },
  { id: 'maple', props: ['Maple Manor Apartments'], osm: 'maple.osm', buildings: [
    { prop: 'Maple Manor Apartments', addr: '1409 W Maple Ave', way: 545531168, floors: 2, units: 'ABCDEFGH'.split('').map((c) => '1409' + c) },
    { prop: 'Maple Manor Apartments', addr: '1411 W Maple Ave', way: 545531167, floors: 2, units: 'ABCDEFGH'.split('').map((c) => '1411' + c) },
    { prop: 'Maple Manor Apartments', addr: '1413 W Maple Ave', way: 545531166, floors: 3, units: 'ABCDEFGHIJKL'.split('').map((c) => '1413' + c) },
    { prop: 'Maple Manor Apartments', addr: '1415 W Maple Ave', way: 545531165, floors: 3, units: 'ABCDEFGHIJKL'.split('').map((c) => '1415' + c) },
  ] },
  { id: 'glenoaks', props: ['Glen Oaks'], osm: 'glenoaks.osm', buildings: [
    { prop: 'Glen Oaks', addr: '3050 N 58th St', way: 1120472388, floors: 3, units: seq(13, 24, 1, '') },
    { prop: 'Glen Oaks', addr: '3052 N 58th St', way: 1120472389, floors: 3, units: seq(25, 36, 1, '') },
    { prop: 'Glen Oaks', addr: '3054 N 58th St', way: 1120472387, floors: 3, units: seq(1, 12, 1, '') },
  ] },
  { id: 'normandy', props: ['Normandy Apartments'], osm: 'normandy.osm', buildings: [
    { prop: 'Normandy Apartments', addr: '1900 & 1904 N 77th St', way: 1221601203, floors: 3, units: ['1900-1','1900-2','1900-3','1900-4','1900-5','1900-6','1904-7','1904-8','1904-9','1904-10','1904-11'] },
    { prop: 'Normandy Apartments', addr: '1906 & 1908 N 77th St', way: 984827569, floors: 3, units: ['1906-6','1906-7','1906-8','1906-9','1906-10','1906-11','1908-1','1908-2','1908-3','1908-4','1908-5'] },
  ] },
  { id: 'ide', props: ['Ide Lofts'], osm: 'ide.osm', buildings: [
    { prop: 'Ide Lofts', addr: '920 Broadway Blvd', way: 365909301, floors: 3, base: 4, units: ['101','102','103','104','105','201','202','203','204','205','301','302','303','304','305'] },
  ] },
  { id: 'whitegate', props: ['Pioneer Apartments', '1511 Sylvan Lane'], osm: 'pioneer.osm', buildings: [
    // Not in OpenStreetMap — traced from Esri World Imagery (see pxW / rectW).
    { prop: 'Pioneer Apartments', addr: '2404 Whitegate Dr', ll: rectW(567, 562, 730, 617), floors: 2, units: seq(11, 20, 1, '') },
    { prop: 'Pioneer Apartments', addr: '2406 Whitegate Dr', ll: rectW(512, 665, 565, 837), floors: 2, units: seq(21, 30, 1, '') },
    { prop: 'Pioneer Apartments', addr: '2408 Whitegate Dr', ll: rectW(597, 667, 647, 837), floors: 2, units: seq(1, 10, 1, '') },
    { prop: '1511 Sylvan Lane', addr: '1511 Sylvan Ln', ll: rectW(775, 660, 820, 735), floors: 2, units: ['A','B','C','D'] },
  ] },
  { id: 'oakland', props: ['3909 North Oakland Gravel Road'], osm: 'oakland2.osm', buildings: [
    { prop: '3909 North Oakland Gravel Road', addr: '3909 N Oakland Gravel Rd', way: 1137596182, floors: 3, units: ['1','2','101','102','201','202'] },
  ] },
  { id: 'downtown', props: ['407 Pecan Street', '801-803 Washington Avenue'], osm: 'pecan.osm', buildings: [
    { prop: '407 Pecan Street', addr: '407 Pecan St', way: 556543267, floors: 3, units: ['1','101','102','201','202'] },
    { prop: '801-803 Washington Avenue', addr: '801–803 Washington Ave', way: 556543266, floors: 2, units: ['801','803'] },
  ] },
  { id: 'fairview', props: ['811 South Fairview Road'], osm: 'fairview.osm', buildings: [
    { prop: '811 South Fairview Road', addr: '811 S Fairview Rd', way: 547374910, floors: 2, units: ['A','B'] },
  ] },
];

const ROAD = { motorway: 14, trunk: 13, primary: 12, secondary: 11, tertiary: 10, residential: 8, unclassified: 8, living_street: 7, service: 5 };
const r1 = (v) => Math.round(v * 10) / 10;
const out = [];
for (const s of sites) {
  const polysLL = s.buildings.map((b) => b.ll || wayLL(b.osmFile || s.osm, b.way));
  const all = polysLL.flat();
  const lat0 = all.reduce((a, p) => a + p[0], 0) / all.length;
  const lng0 = all.reduce((a, p) => a + p[1], 0) / all.length;
  const MLAT = 111320, MLON = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const toXY = ([la, lo]) => [r1((lo - lng0) * MLON), r1((lat0 - la) * MLAT)];
  const blds = s.buildings.map((b, i) => ({ prop: b.prop, addr: b.addr, floors: b.floors, base: b.base || 0, mode: b.mode || 'apt', units: b.units, poly: polysLL[i].map(toXY) }));
  const xs = blds.flatMap((b) => b.poly.map((p) => p[0])), ys = blds.flatMap((b) => b.poly.map((p) => p[1]));
  const M = 22;
  const lot = [Math.floor(Math.min(...xs) - M), Math.floor(Math.min(...ys) - M), Math.ceil(Math.max(...xs) + M), Math.ceil(Math.max(...ys) + M)];
  // roads: every highway way in the file, clipped to the lot (Liang–Barsky per segment)
  const clip = (a, b) => { let t0 = 0, t1 = 1; const dx = b[0] - a[0], dy = b[1] - a[1];
    for (const [p, q] of [[-dx, a[0] - lot[0]], [dx, lot[2] - a[0]], [-dy, a[1] - lot[1]], [dy, lot[3] - a[1]]]) {
      if (p === 0) { if (q < 0) return null; continue; } const r = q / p; if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; } }
    return [[r1(a[0] + t0 * dx), r1(a[1] + t0 * dy)], [r1(a[0] + t1 * dx), r1(a[1] + t1 * dy)]]; };
  const roads = [];
  const files = [...new Set([s.osm, ...s.buildings.map((b) => b.osmFile).filter(Boolean)])];
  const seen = new Set();
  for (const f of files) for (const w of load(f).ways) {
    const k = w.tags.highway; if (!k || !ROAD[k] || seen.has(w.id)) continue; seen.add(w.id);
    if (w.tags.service === 'driveway' && false) continue;
    const pts = w.nds.map(toXY);
    for (let i = 0; i < pts.length - 1; i++) { const c = clip(pts[i], pts[i + 1]); if (c && Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) > 0.5) roads.push({ w: ROAD[k], n: w.tags.name || '', a: c[0], b: c[1] }); }
  }
  out.push({ id: s.id, props: s.props, lat: +lat0.toFixed(6), lng: +lng0.toFixed(6), lot, buildings: blds, roads });
}
fs.writeFileSync('../sites.json', JSON.stringify(out));
for (const s of out) {
  const names = [...new Set(s.roads.map((r) => r.n).filter(Boolean))];
  console.log(s.id.padEnd(10), 'lot', (s.lot[2] - s.lot[0]) + 'x' + (s.lot[3] - s.lot[1]) + 'm', '| bldgs', s.buildings.map((b) => b.units.length + 'u/' + b.poly.length + 'v').join(' '), '| road segs', s.roads.length, names.slice(0, 4).join(', '));
}
console.log('bytes', fs.statSync('../sites.json').size);
