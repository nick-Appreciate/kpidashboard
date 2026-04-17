# Project Memory

## Infrastructure
- **Simmons Bot** runs on Hostinger VPS, accessible via SSH. The bot scrapes Simmons bank for check deposits and images, writes directly to Supabase `simmons_deposits` and `simmons_check_images` tables.
- **Supabase project ID**: `hkmfsnhmxhhndzfxqmhp`
- **Vercel** auto-deploys from `main` branch on GitHub (`nick-Appreciate/kpidashboard`)

## Git Workflow
- **Always deploy to the worktree branch first.** Never merge to main until the user explicitly confirms the merge.

## UI Conventions
- **Always freeze table column headers** in components using `sticky top-0 z-10` on `<thead>` so headers stay visible when scrolling.
- **Public listings site has English + Spanish mirrors.** `/listings` and `/es/listings` (plus their `/[id]` pages) share all components in `components/public/*` and the clients under `app/listings/`. When you edit those components or add a user-facing string, you MUST:
  1. Add the matching key to BOTH the `en` and `es` sections of `lib/i18n/dictionaries.ts`.
  2. Build listings links with `getListingPath(locale, id?)` from `lib/i18n/index.ts` — never hardcode `/listings/...` string literals in shared components.
  3. Propagate the `locale: Locale` prop through any new component that renders chrome.

  AppFolio-sourced data (property names, addresses, unit numbers, prices, marketing descriptions) stays in the language AppFolio provides. Common amenity labels are mapped in `translateAmenity()` in `lib/i18n/dictionaries.ts` — extend that map when AppFolio emits a new amenity that should be localized.
