# Appreciate Brain — Design System

## Color Palette

### Surfaces (dark theme hierarchy)
| Token | Value | CSS Variable | Usage |
|---|---|---|---|
| Surface Base | `#0a0e1a` | `--surface-base` | Page backgrounds |
| Surface Raised | `#111827` | `--surface-raised` | Cards, sidebar, panels |
| Surface Overlay | `#1e293b` | `--surface-overlay` | Modals, dropdowns, table headers |

### Accent
| Token | Value | CSS Variable | Usage |
|---|---|---|---|
| Accent | `#06b6d4` (cyan-500) | `--accent` | Primary actions, links, highlights |
| Accent Light | `#22d3ee` (cyan-400) | `--accent-light` | Hover states |
| Accent Muted | `rgba(6, 182, 212, 0.15)` | `--accent-muted` | Subtle backgrounds, badges |

### Status Colors
| Status | Color | Tailwind | Usage |
|---|---|---|---|
| Success | `#34d399` | `text-emerald-400` | Positive metrics, occupancy up |
| Warning | `#fbbf24` | `text-amber-400` | Caution states, aging 30-60 |
| Danger | `#f87171` | `text-red-400` | Negative metrics, overdue 90+ |
| Info | `#60a5fa` | `text-blue-400` | Neutral data, aging 0-30 |

### Glass Effects
| Token | Value | CSS Variable |
|---|---|---|
| Glass BG | `rgba(17, 24, 39, 0.6)` | `--glass-bg` |
| Glass Border | `rgba(255, 255, 255, 0.08)` | `--glass-border` |
| Glass Border Hover | `rgba(255, 255, 255, 0.15)` | `--glass-border-hover` |

### Text
| Token | Value | CSS Variable | Tailwind |
|---|---|---|---|
| Primary | `#f1f5f9` | `--text-primary` | `text-slate-100` |
| Secondary | `#94a3b8` | `--text-secondary` | `text-slate-400` |
| Tertiary | `#64748b` | `--text-tertiary` | `text-slate-500` |

---

## Typography

**Font:** Inter (loaded via `next/font/google`)

| Element | Size | Weight | Class |
|---|---|---|---|
| Page title | `text-2xl` | `font-semibold` | `text-2xl font-semibold text-slate-100` |
| Section heading | `text-lg` | `font-semibold` | `text-lg font-semibold text-slate-100` |
| Card label | `text-sm` | `font-medium` | `text-sm font-medium text-slate-400` |
| Stat number (large) | `text-3xl` | `font-bold` | `text-3xl font-bold tabular-nums` |
| Stat number (medium) | `text-xl` | `font-bold` | `text-xl font-bold tabular-nums` |
| Body text | `text-sm` | `font-normal` | `text-sm text-slate-300` |
| Small/meta | `text-xs` | `font-normal` | `text-xs text-slate-500` |

Use `tabular-nums` on all numeric displays for alignment.

---

## Component Patterns

### Cards
```
glass-card       — Standard card (glass bg, blur, border, shadow)
glass-stat       — Stat card (glass-card + glow on hover)
```

Usage:
```html
<div className="glass-card p-6">...</div>
<div className="glass-stat p-4">...</div>
```

### Buttons
```
btn-accent       — Primary action (cyan bg, dark text)
```

Secondary/ghost buttons:
```html
<button className="px-4 py-2 text-slate-400 hover:text-slate-200 hover:bg-white/5 rounded-lg transition-colors">
```

Destructive:
```html
<button className="px-4 py-2 bg-red-500/15 text-red-400 rounded-lg hover:bg-red-500/25 transition-colors">
```

### Form Inputs
```
dark-input       — Text inputs, textareas
dark-select      — Select dropdowns
```

Always add appropriate padding: `px-3 py-2` for standard, `px-2 py-1` for compact.

### Tables
```
dark-thead       — Table header row (sticky, dark bg, uppercase labels)
```

Table rows:
```html
<tr className="border-b border-[var(--glass-border)] hover:bg-white/5 transition-colors">
```

Per CLAUDE.md: **Always freeze table headers** with `sticky top-0 z-10`.

---

## Badges & Status Indicators

**Dark-friendly badge pattern:**
```
bg-{color}-500/10 text-{color}-300 border border-{color}-500/20
```

Examples:
- Success: `bg-emerald-500/10 text-emerald-300`
- Warning: `bg-amber-500/10 text-amber-300`
- Danger: `bg-red-500/10 text-red-300`
- Info: `bg-blue-500/10 text-blue-300`
- Accent: `bg-accent/15 text-accent-light`

**Filter chips (active/inactive):**
- Active: `bg-accent text-surface-base`
- Inactive: `bg-surface-overlay text-slate-400 hover:bg-surface-overlay/80`

---

## Animation Conventions

### Entrance Animations
- Content sections: `animate-fade-in-up opacity-0` with stagger classes
- Stagger delays: `.stagger-1` (50ms) through `.stagger-6` (300ms)
- Modals: `animate-fade-in`

### Micro-interactions
- Cards: `transition-all duration-300` (built into `glass-card`)
- Kanban cards: `hover:-translate-y-0.5`
- Table rows: `hover:bg-white/5 transition-colors`
- Buttons: `active:scale-[0.98]`
- Sidebar nav: `hover:translate-x-0.5`

### Performance
- Background effects (Particles, Aurora): wrap in `dynamic(() => import(...), { ssr: false })`, desktop only
- Number animations (CountUp): trigger on viewport entry via IntersectionObserver
- Always respect `@media (prefers-reduced-motion: reduce)`

---

## Charts

Import theme from `lib/chartTheme.js`:
```javascript
import { DARK_CHART_DEFAULTS, DARK_DOUGHNUT_DEFAULTS, CHART_COLORS, CHART_PALETTE } from '@/lib/chartTheme';
```

- **Chart.js:** Merge `DARK_CHART_DEFAULTS` into every chart options object
- **Recharts:** Use `RECHARTS_THEME` for grid, axis, and tooltip styling
- **Color palette:** Use `CHART_PALETTE` array for dataset colors
- **Gradient fills:** Use `createGradientFill()` for line chart area fills

---

## Spacing Conventions

| Context | Padding | Gap |
|---|---|---|
| Page container | `p-6` | — |
| Card interior | `p-4` (compact) or `p-6` (standard) | — |
| Stats grid | — | `gap-4` |
| Section spacing | — | `mb-6` between sections |
| Form elements | `px-3 py-2` | `gap-3` between fields |

---

## Responsive Breakpoints

- Mobile first: default styles target small screens
- `md:` (768px): tablet and desktop layouts
- `lg:` (1024px): wide desktop (enable background effects)
- Background animations: hidden on `< lg` screens for performance

---

## Modal Pattern

```html
<!-- Overlay -->
<div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
  <!-- Content -->
  <div className="glass-card max-w-2xl w-full max-h-[90vh] overflow-hidden">
    <!-- Header -->
    <div className="p-4 border-b border-[var(--glass-border)]">...</div>
    <!-- Body -->
    <div className="p-4 overflow-y-auto">...</div>
  </div>
</div>
```

---

## Loading States

Use inline skeleton screens matching each page's actual layout:
```html
<div className="skeleton h-8 w-48 mb-2"></div>  <!-- title -->
<div className="skeleton h-4 w-72"></div>         <!-- subtitle -->
<div className="skeleton h-64 w-full"></div>      <!-- chart area -->
```

The `.skeleton` class provides a dark shimmer animation automatically.
