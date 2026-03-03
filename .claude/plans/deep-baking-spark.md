# UI/UX Refactor Plan

## Design System
- Dark theme: `surface-base #0a0e1a`, `surface-raised #111827`, `surface-overlay #1e293b`, `accent #06b6d4` (cyan)
- Glassmorphism: `backdrop-blur-[16px]`, glass-card, glass-stat
- Reusable classes: `dark-input`, `dark-select`, `dark-thead`, `btn-accent`
- Chart.js dark defaults in `lib/chartTheme.js`
- Inter font via `next/font/google`

## Phases

### Phase 1: Design System Foundation [DONE]
- CSS variables, glass classes, chart theme, ReactBits components

### Phase 2: Shell [DONE]
- AppLayout, Sidebar (parent/child nav, admin gating), Login page

### Phase 3: Leasing Dashboard [IN PROGRESS]
- Dark theme restyle for Dashboard.js, SourcesChart.js, LeadsPerUnitChart.js
- Funnel redesigned with brand gradient bars (cyan→blue→violet→amber→emerald)
- **3b: Unify all colors to brand palette** — chart lines, sources, filters, fallout

### Phase 4: Occupancy Dashboard
- OccupancyDashboard.js (1465 lines, 9 Chart.js instances, tables)

### Phase 5: Collections
- CollectionsKanban.js, CollectionsDashboard.js

### Phase 6: Billing + Inspections

### Phase 7: Rehabs

### Phase 8: Polish & Performance

### Phase 9: Mobile Responsiveness
- Refactor each page for mobile-friendly layouts
- Responsive filter sections, collapsible cards
- Touch-friendly funnel stages and chart interactions
- Mobile sidebar behavior (drawer/overlay)
- Responsive table layouts (horizontal scroll or stacked cards)

## Cleanup
- Remove `NEXT_PUBLIC_DEV_BYPASS_AUTH=true` from `.env.local` before final merge

## Brand Color Palette
| Name | Hex | Usage |
|------|-----|-------|
| Cyan | #06b6d4 | Accent, Inquiries stage |
| Blue | #60a5fa | Showings Scheduled |
| Violet | #8b5cf6 | Showings Completed |
| Amber | #fbbf24 | Applications |
| Emerald | #34d399 | Leases |
| Rose | #fb7185 | Errors, fallout |
| Orange | #fb923c | Warnings |
| Teal | #2dd4bf | Secondary accent |
| Pink | #f472b6 | Tertiary |
| Lime | #a3e635 | Success alt |
