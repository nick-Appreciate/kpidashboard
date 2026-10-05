# Appreciate Arcade

A gamified view of the portfolio for the Property Manager and Virtual Admin
roles: every property drawn building by building on a map, a scorecard per
role, a to-do list ranked by score impact, and a property leaderboard.

It runs in two places from the same source, `src/Main.dc.html`:

- **appreciate.io/arcade** — behind the dashboard login, not in the sidebar
  (direct link only). `app/arcade/page.js` renders the page with
  `components/arcade/DcPage.js`, a small runtime for the canvas format, and
  `/api/arcade` fills in live tenant data for the signed-in user.
- **The claude.ai artifact** — built into `dist/` and published by hand.

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

## Tenant data

`lib/arcade/units.js` builds the per-unit data (tenants, phones, leases,
balances, work orders) from Supabase. `/api/arcade` calls it live; for the
artifact, `scripts/refresh-data.mjs` writes the same thing to
`data/units.app.json`.

## Build the artifact

From the repo root (needs `.env.local` with the Supabase service-role key):

```bash
node arcade/scripts/refresh-data.mjs && node arcade/scripts/build.mjs
```

`build.mjs` first runs `sync-property-groups.mjs`, which copies
`lib/propertyGroups.js` into `src/Main.dc.html` verbatim and rebuilds the
portfolio dropdown from `PRESET_PROPERTY_OPTIONS`. The page can't import from
the repo at runtime, so this is how it stays on the dashboard's rules. Commit
the resulting `src/` diff: the /arcade route serves `src/` as committed.

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
