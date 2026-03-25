# Project Memory

## Infrastructure
- **Simmons Bot** runs on Hostinger VPS, accessible via SSH. The bot scrapes Simmons bank for check deposits and images, writes directly to Supabase `simmons_deposits` and `simmons_check_images` tables.
- **Supabase project ID**: `hkmfsnhmxhhndzfxqmhp`
- **Vercel** auto-deploys from `main` branch on GitHub (`nick-Appreciate/kpidashboard`)

## Git Workflow
- **Always deploy to the worktree branch first.** Never merge to main until the user explicitly confirms the merge.

## UI Conventions
- **Always freeze table column headers** in components using `sticky top-0 z-10` on `<thead>` so headers stay visible when scrolling.
