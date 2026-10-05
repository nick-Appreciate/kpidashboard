# Appreciate Arcade

A gamified view of the portfolio for the Property Manager and Virtual Admin
roles: every property drawn building by building on a map, a scorecard per
role, a to-do list ranked by score impact, and a property leaderboard. It is
published as a claude.ai design-canvas artifact, not served by the Next app.

## Layout

| Path | What |
|---|---|
| `src/` | The canvas: `Main.dc.html` (the app), `Rules.dc.html`, `Architecture.dc.html`, `canvas.json` |
| `scripts/` | Data refresh, the property-groups sync and the build |
| `data/sites.json` | Building footprints and roads (OpenStreetMap plus hand traces in `build-sites.js`) |
| `data/*.json` (other) | Tenant-level data. **Gitignored**: the repo is public |
| `dist/` | Build output that gets published. **Gitignored** |
| `tests/` | Node checks of the page logic; they read `dist/project/Main.dc.html` |

`src/Main.dc.html` ships with an empty `unitsData()`. Tenant names, phones,
balances and work orders are filled in only at build time.

## Refresh and build

From the repo root (needs `.env.local` with the Supabase service-role key):

```bash
node arcade/scripts/fetch-units.js && node arcade/scripts/build-units.js
node arcade/scripts/fetch-dq.js && node arcade/scripts/merge-units.js
node arcade/scripts/build.mjs
```

`build.mjs` first runs `sync-property-groups.mjs`, which copies
`lib/propertyGroups.js` into `src/Main.dc.html` verbatim and rebuilds the
portfolio dropdown from `PRESET_PROPERTY_OPTIONS`. The arcade can't import
from the repo at runtime, so this is how it stays on the dashboard's rules.
Commit the resulting `src/` diff when that file changes.

Then publish `dist/` as the artifact root (files under `project/`).

## Checks

```bash
node arcade/tests/calib.js   # portfolio and per-property scores, both roles
node arcade/tests/test2.js   # template holes, drill-down and actions
node arcade/tests/pf.js      # portfolio filter
node arcade/tests/todo.js    # scorecard components and to-do ranking
```

## Rebuilding footprints

`scripts/build-sites.js` reads OpenStreetMap extracts from `data/osm/`
(gitignored, ~10 MB), downloaded per site from
`https://api.openstreetmap.org/api/0.6/map?bbox=…`. Site centres are in
`data/props.tsv`. `scripts/overlay.py` and `scripts/tiles.py` draw footprints
over Esri imagery to check traces by eye.
