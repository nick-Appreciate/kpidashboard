# Billing/AP Automation — Deployment Guide

## Overview

The billing automation system:
1. **Syncs** billing@appreciate.io Front inbox → front_conversations + front_messages tables
2. **Parses** invoice PDFs with Claude AI intelligence
3. **Stores** PDFs in Supabase Storage + parsed data in ops_bills table
4. **Displays** tape feed on /dashboard/billing for manual approval

---

## Architecture

```
Front Inbox (billing@appreciate.io)
  ↓
front-billing-sync.js (Node.js, runs hourly via cron)
  ↓
front_conversations + front_messages tables (Supabase)
  ↓
parse-invoice-pdf Edge Function (Deno, triggered hourly)
  ↓
Download PDF → Claude AI parsing → Extract vendor/amount/date
  ↓
Upload PDF to Storage + Insert into ops_bills table
  ↓
/dashboard/billing (React) ← fetch pending bills
  ↓
Mark as Entered → add Front comment + update status
```

---

## Setup Steps

### 1. Database Schema

Ensure these tables exist in Supabase:

```sql
-- front_conversations
CREATE TABLE front_conversations (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  front_id TEXT NOT NULL UNIQUE,
  inbox_id TEXT,
  inbox_name TEXT,
  subject TEXT,
  status TEXT,
  status_category TEXT,
  sender_name TEXT,
  sender_email TEXT,
  sender_role TEXT,
  tags TEXT[],
  assignee_email TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  last_message_id TEXT,
  synced_at TIMESTAMP
);

-- front_messages
CREATE TABLE front_messages (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  front_id TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL REFERENCES front_conversations(front_id),
  subject TEXT,
  is_inbound BOOLEAN,
  message_type TEXT,
  sender_name TEXT,
  sender_email TEXT,
  body_text TEXT,
  blurb TEXT,
  has_attachments BOOLEAN,
  attachment_count INT DEFAULT 0,
  attachment_ids TEXT[],
  created_at TIMESTAMP,
  synced_at TIMESTAMP,
  vendor_name TEXT,
  invoice_number TEXT,
  invoice_amount NUMERIC,
  invoice_date DATE,
  due_date DATE,
  ap_extracted BOOLEAN DEFAULT FALSE,
  ap_approved BOOLEAN,
  ap_notes TEXT
);

-- ops_bills
CREATE TABLE ops_bills (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  vendor_name TEXT,
  amount NUMERIC,
  invoice_date DATE,
  invoice_number TEXT,
  front_conversation_id TEXT REFERENCES front_conversations(front_id),
  front_message_id TEXT REFERENCES front_messages(front_id),
  front_email_subject TEXT,
  front_email_from TEXT,
  attachments_json JSONB,
  status TEXT DEFAULT 'pending',
  due_date DATE,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_ops_bills_status ON ops_bills(status);
CREATE INDEX idx_ops_bills_created ON ops_bills(created_at);
```

### 2. Supabase Storage Bucket

Create a bucket for invoice PDFs:

```bash
# In Supabase dashboard:
# Storage → New bucket → billing-invoices
# Public access: Yes
```

### 3. Environment Variables

Set these in Supabase project settings (for Edge Functions):

```
ANTHROPIC_API_KEY=sk-ant-... (from https://console.anthropic.com/keys)
FRONT_API_KEY=... (already have this)
```

Set these in Vercel (for Next.js):

```
NEXT_PUBLIC_SUPABASE_URL=https://...supabase.co
SUPABASE_KEY=... (service_role key)
ANTHROPIC_API_KEY=sk-ant-... (same as above)
```

### 4. Deploy Edge Function

```bash
cd /root/.openclaw/workspace/kpidashboard

# Deploy parse-invoice-pdf function
supabase functions deploy parse-invoice-pdf --project-ref <your-project-id>

# Or use Supabase CLI locally:
supabase start
supabase functions deploy parse-invoice-pdf
```

### 5. Deploy Next.js App

```bash
git add .
git commit -m "feat: billing automation with PDF parsing and Claude"
git push origin feature/billing-dashboard

# Then merge to main and deploy to Vercel
```

### 6. Set Up Cron Scheduling

#### Option A: Supabase Cron (Scheduled SQL)
Go to Supabase dashboard → SQL Editor → Create new query:

```sql
-- Run hourly: parse unparsed invoices
SELECT
  http_post(
    'https://<your-project-id>.supabase.co/functions/v1/parse-invoice-pdf',
    '{}',
    'application/json',
    'Bearer ' || current_setting('app.supabase_key')
  );
```

Then create a cron schedule in Supabase to run this hourly.

#### Option B: External Cron (e.g., Vercel Crons, GitHub Actions, EasyCron)

Create a GitHub Actions workflow (`.github/workflows/billing-sync.yml`):

```yaml
name: Billing Invoice Sync
on:
  schedule:
    - cron: '0 * * * *'  # Every hour

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Sync billing inbox
        run: |
          node scripts/front-billing-sync.js
        env:
          FRONT_TOKEN: ${{ secrets.FRONT_API_KEY }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}

      - name: Parse invoices
        run: |
          curl -X POST https://${{ secrets.SUPABASE_URL }}/functions/v1/parse-invoice-pdf \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" \
            -H "Content-Type: application/json"
```

#### Option C: Vercel Crons
Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/billing/sync-front",
      "schedule": "0 * * * *"
    },
    {
      "path": "/api/billing/parse-invoices",
      "schedule": "15 * * * *"
    }
  ]
}
```

---

## Usage

### Manual Trigger

Trigger parsing from dashboard:

```bash
curl -X POST https://appreciate.io/api/billing/parse-invoices \
  -H "Content-Type: application/json"
```

### Dashboard

1. Navigate to https://appreciate.io/dashboard/billing
2. See pending bills (vendor, amount, date, email from, attachment link)
3. Click "Mark as Entered" → adds comment to Front email, removes from pending
4. Click "View in Front" → opens conversation in Front app

### Data Flow

```
Email arrives → billing@appreciate.io
  ↓ (hourly)
front-billing-sync.js fetches messages
  ↓
front_messages table populated
  ↓ (15 min later)
parse-invoice-pdf Edge Function runs
  ↓
Download PDF from Front API → Claude AI → parse vendor/amount/date
  ↓
Upload PDF to Storage
  ↓
ops_bills table gets new row (status: pending)
  ↓
Dashboard shows pending bill
  ↓
User clicks "Mark as Entered"
  ↓
ops_bills status → "entered"
  ↓
Front comment added
```

---

## Troubleshooting

### PDFs Not Parsing

1. Check Supabase logs → Edge Functions → parse-invoice-pdf
2. Verify ANTHROPIC_API_KEY is set
3. Ensure FRONT_API_KEY is valid
4. Check that front_messages has `attachment_count > 0` and `ap_extracted = false`

### Storage Upload Fails

1. Verify bucket exists: Storage → billing-invoices
2. Check bucket is public
3. Test with manual upload: `supabase storage upload billing-invoices test.pdf`

### API Errors

1. Verify ops_bills table exists
2. Check Vercel env vars are set
3. Test Edge Function directly: `supabase functions serve`

---

## Files

- `supabase/functions/parse-invoice-pdf/index.ts` — Edge Function (Claude parsing)
- `supabase/functions/parse-invoice-pdf/deno.json` — Deno imports
- `app/api/billing/parse-invoices.ts` — API route to trigger parsing
- `app/dashboard/billing/page.tsx` — Dashboard UI
- `app/api/billing/get-bills.ts` — Fetch pending bills
- `app/api/billing/add-front-comment.ts` — Mark as entered
- `scripts/front-billing-sync.js` — Sync Front inbox (Node.js)

---

## Next Steps

- [ ] Create tables in Supabase
- [ ] Create billing-invoices storage bucket
- [ ] Set ANTHROPIC_API_KEY in Supabase
- [ ] Deploy parse-invoice-pdf Edge Function
- [ ] Deploy Next.js app
- [ ] Set up cron scheduling
- [ ] Test with manual invoice email
- [ ] Monitor logs + iterate on Claude prompt

---

_Last updated: 2026-03-02_
