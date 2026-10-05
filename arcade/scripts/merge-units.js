// Folds the delinquency snapshot (fetch-dq.js) into the per-unit data
// (build-units.js): due = balance today, pd = balance on the same day last
// month, __other = balances on units the map doesn't draw, __dq = the dates.
// Writes data/units.app.json, the object the page's unitsData() returns.
const fs = require('fs');
const path = require('path');
const D = (f) => path.join(__dirname, '../data', f);
const U = JSON.parse(fs.readFileSync(D('units.json'), 'utf8'));
const Q = JSON.parse(fs.readFileSync(D('dq.json'), 'utf8'));
for (const p of Object.keys(U)) {
  const cur = Q.cur[p] || {}, pri = Q.pri[p] || {};
  const units = Object.keys(U[p]).filter((k) => !k.startsWith('__'));
  for (const u of units) {
    const x = U[p][u];
    if (u in cur) x.due = cur[u]; else delete x.due;
    if (pri[u]) x.pd = pri[u];
  }
  const rest = (o) => Object.entries(o).filter(([u]) => !units.includes(u)).reduce((t, [, v]) => t + v, 0);
  const oc = rest(cur), op = rest(pri);
  if (oc || op) U[p].__other = { due: oc, pd: op };
}
U.__dq = { latest: Q.latest, prior: Q.prior };
fs.writeFileSync(D('units.app.json'), JSON.stringify(U));
console.log('units.app.json', fs.statSync(D('units.app.json')).size, 'bytes · delinquency', Q.prior, '→', Q.latest);
