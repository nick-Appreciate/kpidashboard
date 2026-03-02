# Billing Automation — Quick Start Deployment

**TL;DR:** 5 steps to get invoices parsing

---

## Step 1: Create Tables (5 min)

Go to Supabase Dashboard → SQL Editor → New Query

Copy-paste this entire SQL block:

```sql
-- front_conversations
CREATE TABLE IF NOT EXISTS front_conversations (
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
CREATE TABLE IF NOT EXISTS front_messages (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  front_id TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL,
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
  ap_notes TEXT,
  FOREIGN KEY (conversation_id) REFERENCES front_conversations(front_id)
);

-- ops_bills
CREATE TABLE IF NOT EXISTS ops_bills (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  vendor_name TEXT,
  amount NUMERIC,
  invoice_date DATE,
  invoice_number TEXT,
  front_conversation_id TEXT,
  front_message_id TEXT,
  front_email_subject TEXT,
  front_email_from TEXT,
  attachments_json JSONB,
  status TEXT DEFAULT 'pending',
  due_date DATE,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (front_conversation_id) REFERENCES front_conversations(front_id),
  FOREIGN KEY (front_message_id) REFERENCES front_messages(front_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ops_bills_status ON ops_bills(status);
CREATE INDEX IF NOT EXISTS idx_ops_bills_created ON ops_bills(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_front_messages_ap_extracted ON front_messages(ap_extracted);
```

Click "Run" ✓

---

## Step 2: Create Storage Bucket (2 min)

Go to Supabase Dashboard → Storage

1. Click "New bucket"
2. Name: `billing-invoices`
3. Public: **YES**
4. Click "Create bucket"

✓

---

## Step 3: Set Environment Variable (2 min)

Go to Supabase Dashboard → Project Settings → Edge Functions

Scroll down to "Secrets"

Add:
- **Key:** `ANTHROPIC_API_KEY`
- **Value:** `sk-ant-...` (from https://console.anthropic.com/keys)

Click "Save" ✓

---

## Step 4: Deploy Edge Function (3 min)

In terminal:

```bash
cd /root/.openclaw/workspace/kpidashboard

# Authenticate
supabase login

# Deploy function
supabase functions deploy parse-invoice-pdf --project-ref <your-project-id>

# Verify it deployed
supabase functions list
```

Should see:
```
parse-invoice-pdf    200     GET, POST
```

✓

---

## Step 5: Merge & Deploy App (5 min)

```bash
cd /root/.openclaw/workspace/kpidashboard

# Merge to main
git checkout main
git merge feature/billing-dashboard
git push origin main

# Vercel will auto-deploy (check dashboard)
# Or push to trigger if using GitHub Actions
```

✓

---

## That's It! 🎉

Now test:

1. **Trigger parsing manually** (optional):
   ```bash
   curl -X POST https://appreciate.io/api/billing/parse-invoices \
     -H "Content-Type: application/json"
   ```

2. **Send test invoice** to billing@appreciate.io with PDF attachment

3. **Wait 1-2 minutes** (sync + parsing)

4. **Check dashboard:** https://appreciate.io/dashboard/billing

5. **See pending bill** with vendor, amount, date, PDF link

6. **Click "Mark as Entered"** to approve

---

## Optional: Set Up Cron Scheduling

Pick one:

### Option A: GitHub Actions (Easiest)

Create `.github/workflows/billing-sync.yml`:

```yaml
name: Billing Sync
on:
  schedule:
    - cron: '0 * * * *'
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: node-setup@v3
      - run: node scripts/front-billing-sync.js
        env:
          FRONT_TOKEN: ${{ secrets.FRONT_API_KEY }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      - run: |
          curl -X POST \
            https://${{ secrets.SUPABASE_URL }}/functions/v1/parse-invoice-pdf \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" \
            -H "Content-Type: application/json"
```

Commit & push ✓

### Option B: Vercel Crons

Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/billing/parse-invoices",
      "schedule": "0 * * * *"
    }
  ]
}
```

Deploy ✓

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "ANTHROPIC_API_KEY not set" | Add to Supabase secrets (Step 3) |
| "billing-invoices bucket not found" | Create it in Storage (Step 2) |
| "Edge Function deployment failed" | Check Supabase project ID in command |
| "No bills showing" | Check front-billing-sync.js ran first |
| "PDFs not uploading" | Verify bucket is public (Step 2) |

---

## What's Next

Once working:

1. **Set up daily sync** (automated inbox pulls)
2. **Monitor Claude costs** (should be <$5/month)
3. **Train team** on dashboard (vendor → click approve)
4. **Add vendor dedup** (suggest matches for future phase)

---

**Questions?** Check `BILLING_SETUP.md` for detailed guide.

**Stuck?** Check Supabase logs: Edge Functions → parse-invoice-pdf

