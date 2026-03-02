# Claude Invoice Parsing Prompt

This is the exact prompt sent to Claude 3.5 Sonnet for each invoice PDF.

---

## Current Prompt (in parse-invoice-pdf/index.ts)

```
You are an invoice parsing expert. Extract the following information from this invoice PDF:
- Vendor/Company name
- Invoice number
- Invoice amount (total, as a number)
- Invoice date (YYYY-MM-DD format)
- Due date (YYYY-MM-DD format, if available)
- Brief description of what was invoiced

Email Subject: ${emailSubject}
Sender Name: ${senderName}
Email Body Preview: ${emailBody.slice(0, 500)}

Return ONLY valid JSON (no markdown, no code blocks) with these exact keys:
{
  "vendor_name": "string or null",
  "invoice_number": "string or null",
  "invoice_amount": number or null,
  "invoice_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null",
  "description": "string or null"
}
```

---

## How It Works

1. **Input to Claude:**
   - PDF file (as base64 image)
   - Email subject
   - Sender name
   - Email body preview (first 500 chars)

2. **Claude processes:**
   - Reads PDF visually (Claude can read text from images/PDFs)
   - Considers email context (subject + sender helps identify vendor)
   - Extracts structured data

3. **Output:**
   - Raw JSON (no markdown)
   - null for missing fields
   - Amounts as numbers (not strings)
   - Dates in YYYY-MM-DD format

---

## Why This Approach Works

✅ **Context-aware** — Email subject + sender helps identify vendor
✅ **Flexible** — Handles varied invoice formats (no hardcoded fields)
✅ **Structured** — Returns JSON, not free text
✅ **Fallback** — Returns nulls for unparseable fields
✅ **Fast** — Single Claude call per invoice
✅ **Cheap** — ~0.02 cents per invoice

---

## Edge Cases Handled

| Scenario | Result |
|----------|--------|
| No due date | due_date = null |
| Amount in words | parsed as null (can't reliably convert) |
| Missing invoice number | invoice_number = null |
| Corrupted PDF | returns nulls, marked as error |
| Multiple vendors | returns first vendor found |

---

## Tweaking the Prompt

Want to change what Claude extracts? Edit the prompt in:

**File:** `supabase/functions/parse-invoice-pdf/index.ts`
**Lines:** 67-88

Example tweaks:

```typescript
// Add line items extraction
`- Line items: JSON array with [description, quantity, unit_price, amount]`

// Add PO number
`- Purchase Order number`

// Add account coding
`- Cost center or GL account (if visible)`
```

After editing, redeploy:
```bash
supabase functions deploy parse-invoice-pdf
```

---

## Model Choice: Claude 3.5 Sonnet

Why this model?

| Model | Cost | Speed | Quality | Note |
|-------|------|-------|---------|------|
| Haiku | Cheaper | Faster | Lower | Not strong enough for PDFs |
| **Sonnet 3.5** | **Mid** | **Fast** | **Best** | **Sweet spot for this task** |
| Opus | Expensive | Slower | Highest | Overkill, not needed |

Cost breakdown:
- Input: $3/MTok
- Output: $15/MTok
- Per invoice: ~$0.003 (mostly images)
- Batch 100/day: ~$0.30

---

## What Claude Sees

Claude receives:
1. **PDF as image** (base64 encoded)
2. **Email metadata** (subject, sender, preview)

It does NOT receive:
- ❌ Filename or attachment name
- ❌ Full email body (only 500 char preview)
- ❌ Email headers
- ❌ Multiple pages (only first PDF)

---

## Common Parsing Issues & Solutions

| Issue | Solution |
|-------|----------|
| Extracting extra fields | Remove from prompt, redeploy |
| Missing due date | Check if invoice has it; may legitimately be null |
| Wrong vendor name | Adjust prompt to prioritize email sender |
| Amount parsed wrong | Check PDF has readable numbers (not scanned image) |
| Null for all fields | PDF likely corrupted; check in Supabase logs |

---

## Testing Claude Directly

Want to test the prompt before deploying?

```bash
# Use Anthropic CLI or API
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 1024,
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "Extract: vendor_name, invoice_number, amount, invoice_date from this invoice..."
          },
          {
            "type": "image",
            "source": {
              "type": "base64",
              "media_type": "application/pdf",
              "data": "..."
            }
          }
        ]
      }
    ]
  }'
```

---

## Future Enhancements

Planned (Phase 2):

- [ ] Extract line items (desc, qty, price, amount)
- [ ] Multi-page PDFs (extract from all pages)
- [ ] GL code suggestion (based on vendor + description)
- [ ] Duplicate detection (amount + date + vendor match)
- [ ] Vendor reconciliation (suggest vs master list)

