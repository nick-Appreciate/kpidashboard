// Counts windows whose centre is covered by any building painted after it.
const fs = require('fs');
module.exports = function occlusion(src, angles, override) {
  let s = src;
  if (override) for (const [a, b] of override) { if (!s.includes(a)) throw new Error('no ' + a); s = s.replace(a, b); }
  const js = s.split('data-dc-script')[1].split('>').slice(1).join('>').split('</script>')[0];
  global.DCLogic = class { constructor(p) { this.props = p || {}; } setState(u) { this.state = { ...this.state, ...u }; } };
  global.setTimeout = () => 0; global.clearTimeout = () => {};
  const Component = eval('(' + js.trim().replace(/^class Component/, 'class') + ')');
  const c = new Component({});
  const polys = (d, dx, dy) => (d || '').split('Z').map((p) => p.trim()).filter(Boolean).map((p) => p.replace(/^M/, '').split('L').map((pt) => { const [x, y] = pt.trim().split(/\s+/).map(Number); return [x + dx, y + dy]; }));
  const inside = (pt, poly) => { let r = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) r = !r; } return r; };
  const out = [];
  for (const ang of angles) {
    c.state.ang = ang;
    const v = c.renderVals();
    const b = v.objects.filter((o) => o.isB);
    let total = 0, hidden = 0; const where = {};
    b.forEach((o, i) => {
      const wins = ['wO', 'wN', 'wB', 'wR', 'wS'].flatMap((k) => polys(o[k], o.left, o.top));
      const later = b.slice(i + 1).flatMap((q) => ['wallD', 'wallM', 'wallL', 'roof'].flatMap((k) => polys(q[k], q.left, q.top)));
      wins.forEach((w) => {
        total++;
        const cx = w.reduce((t, p) => t + p[0], 0) / w.length, cy = w.reduce((t, p) => t + p[1], 0) / w.length;
        if (later.some((poly) => inside([cx, cy], poly))) { hidden++; where[o.title.split(' ·')[0]] = (where[o.title.split(' ·')[0]] || 0) + 1; }
      });
    });
    out.push({ ang: ang * 45, total, hidden, where, world: v.worldW + 'x' + v.worldH });
  }
  return out;
};
if (require.main === module) {
  const src = fs.readFileSync(process.argv[2] || require('path').join(__dirname, '../dist/project/Main.dc.html'), 'utf8');
  for (const r of module.exports(src, [0, 1, 2, 3, 4, 5, 6, 7])) console.log(String(r.ang).padStart(3) + '°', 'windows', r.total, 'hidden', r.hidden, JSON.stringify(r.where));
}
