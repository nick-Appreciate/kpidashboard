# Billing/AP Automation — Implementation Summary

**Feature Branch:** `feature/billing-dashboard` (commit `4d1f7ed`)  
**Status:** ✅ Ready for deployment

---

## What This Does

Automates invoice extraction from billing@appreciate.io inbox:

1. **Emails arrive** with PDF invoices
2. **Front Sync** (hourly) fetches them into Supabase
3. **Claude Parsing** (hourly) reads PDFs, extracts vendor/amount/date
4. **Dashboard** shows pending bills for manual approval
5. **One-click entry** marks bill as entered in Front

---

## Three Components Built

### 1️⃣ Parse Invoice PDF Edge Function
**File:** `supabase/functions/parse-invoice-pdf/index.ts`

What it does:
- Finds unprocessed messages in `front_messages` table
- Downloads PDF attachments from Front API
- Sends to Claude for intelligent parsing
- Stores PDF in Supabase Storage
- Creates entry in `ops_bills` table

Claude extracts:
- `vendor_name` (company name)
- `invoice_number` (INV-12345)
- `invoice_amount` ($5,000.00)
- `invoice_date` (2026-03-01)
- `due_date` (2026-04-01)
- `description` (what was purchased)

**Language:** TypeScript (Deno runtime)  
**Dependencies:** @supabase/supabase-js, @anthropic-ai/sdk (imported from esm.sh)  
**Trigger:** Cron job (hourly) or manual API call  

---

### 2️⃣ API Trigger Route
**File:** `app/api/billing/parse-invoices.ts`

What it does:
- Provides HTTP endpoint to trigger parsing
- Called from dashboard, cron, or manually
- Returns success/error with processing results

**Usage:**
```bash
POST /api/billing/parse-invoices

Response:
{
  "success": true,
  "processed": 5,
  "inserted": 5,
  "results": [...]
}
```

**Language:** TypeScript (Next.js)  

---

### 3️⃣ Deployment & Setup Guide
**File:** `BILLING_SETUP.md`

Complete guide including:
- Database schema (SQL for all 3 tables)
- Environment variables needed
- Cron scheduling options
- Troubleshooting steps

---

## Data Flow

```
billing@appreciate.io
        ↓
[Daily] Front API ← front-billing-sync.js
        ↓
front_messages table
  - front_id, conversation_id, subject, sender
  - body_text, attachment_ids, has_attachments
  - ap_extracted: false (unparsed)
        ↓
[Hourly] parse-invoice-pdf Edge Function
        ↓
① Download PDF from Front API
② Send to Claude: "Extract vendor, amount, date from this invoice"
③ Claude returns JSON: {vendor_name, amount, date, ...}
④ Upload PDF to Storage: https://...billing-invoices/conv_id/att_id.pdf
⑤ Insert into ops_bills table
        ↓
ops_bills table (status: pending)
  - vendor_name, amount, invoice_date
  - front_conversation_id (link back to Front)
  - attachments_json (PDF URL)
        ↓
/dashboard/billing (React)
  - Polls ops_bills every 10s
  - Shows tape feed of pending bills
  - "Mark as Entered" button
        ↓
User clicks → POST /api/billing/add-front-comment
  - Updates ops_bills: status → entered
  - Adds comment to Front conversation
  - Bill disappears from dashboard
```

---

## Database Schema

**Three tables needed:**

1. **front_conversations** (from Front API)
   - front_id (unique), subject, sender, status, tags, created_at

2. **front_messages** (from Front API)
   - front_id (unique), conversation_id, body_text, attachment_ids
   - **NEW:** vendor_name, ap_extracted (boolean)

3. **ops_bills** (parsed invoices)
   - vendor_name, amount, invoice_date, invoice_number, due_date
   - front_conversation_id, attachments_json (PDF URL)
   - status (pending/entered/skipped)

See `BILLING_SETUP.md` for full SQL.

---

## Environment Variables

**Supabase Edge Functions:**
```
ANTHROPIC_API_KEY=sk-ant-...
FRONT_API_KEY=... (already configured)
```

**Vercel / Next.js:**
```
NEXT_PUBLIC_SUPABASE_URL=https://...supabase.co
SUPABASE_KEY=... (service_role key)
```

---

## Deployment Checklist

- [ ] Create tables (SQL in BILLING_SETUP.md)
- [ ] Create `billing-invoices` storage bucket (Public: Yes)
- [ ] Add ANTHROPIC_API_KEY to Supabase Edge Functions
- [ ] Deploy Edge Function: `supabase functions deploy parse-invoice-pdf`
- [ ] Merge feature branch to main
- [ ] Deploy to Vercel
- [ ] Set up cron (GitHub Actions or Supabase Cron)
- [ ] Test with invoice email to billing@appreciate.io

---

## Testing

1. Send an invoice email to billing@appreciate.io with PDF
2. Wait 1-2 minutes (sync + parsing)
3. Visit https://appreciate.io/dashboard/billing
4. See bill appear with vendor, amount, date
5. Click attachment link to verify PDF
6. Click "Mark as Entered" to approve

---

## Key Design Decisions

| Decision | Why |
|----------|-----|
| Claude, not Ollama | PDFs need strong OCR. Claude reliable. Cost: $0.01/invoice |
| Edge Function, not Vercel | Consistent architecture, direct Supabase access, easier scheduling |
| Hourly cron, not real-time | Batching reduces API calls. 1h latency acceptable for AP |
| Service role key, not RLS | Needs full table access. OK for backend-only function |
| Supabase Storage | Built-in, accessible from dashboard. PDF links don't expire |

---

## Cost

- **Claude API:** ~$0.01 per invoice (vision token parsing)
- **Supabase Storage:** ~$0.001 per invoice (~1KB PDF metadata + storage fees)
- **Total:** ~$0.02/invoice = **$60/year** at 3000 invoices/year

---

## What's NOT in Scope

- ✗ Receipt OCR (invoices only)
- ✗ Multi-page invoice extraction (uses first PDF only)
- ✗ Automatic Appfolio entry (manual approval required)
- ✗ Payment status tracking (billing only, not payments)
- ✗ Vendor deduplication (AI parses, human approves name)

---

## Files Changed

```
supabase/functions/parse-invoice-pdf/
  ├── index.ts              ← Main Edge Function (206 lines)
  └── deno.json             ← Deno imports

app/api/billing/
  ├── parse-invoices.ts     ← Trigger route
  ├── get-bills.ts          ← Existing (no changes)
  └── add-front-comment.ts  ← Existing (no changes)

app/dashboard/billing/
  └── page.tsx              ← Existing (shows ops_bills)

BILLING_SETUP.md            ← 300-line deployment guide
BILLING_IMPLEMENTATION_SUMMARY.md ← This file
```

---

## Next Phase

Once deployed and stable:
- **Vendor deduplication** — AI suggests matches, human confirms
- **Duplicate detection** — Skip already-entered invoices
- **Appfolio auto-sync** — Push entered bills to GL
- **Invoice line items** — Extract line-level detail
- **Multi-page PDFs** — Extract from all pages

