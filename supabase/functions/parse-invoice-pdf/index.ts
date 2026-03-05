/**
 * Supabase Edge Function: Parse Invoice PDFs from Front
 *
 * Workflow:
 * 1. Query front_messages table for messages with attachments not yet parsed
 * 2. Check for duplicates in ops_bills by front_message_id
 * 3. Download PDF from Front API
 * 4. Send PDF to Claude for intelligent invoice parsing
 * 5. Store PDF in Supabase Storage
 * 6. Insert parsed data into ops_bills table (with conflict handling)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { Anthropic } from 'https://esm.sh/@anthropic-ai/sdk@0.24.0';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const frontApiKey = Deno.env.get('FRONT_API_KEY')!;
const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')!;

const supabase = createClient(supabaseUrl, supabaseKey);
const anthropic = new Anthropic({ apiKey: anthropicApiKey });

interface FrontMessage {
  front_id: string;
  conversation_id: string;
  subject: string;
  sender_name: string;
  sender_email: string;
  body_text: string;
  attachment_ids: string[];
  attachment_count: number;
  created_at: string;
}

interface ParsedInvoice {
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_amount: number | null;
  invoice_date: string | null;
  due_date: string | null;
  description: string | null;
  document_type: string | null;
  payment_status: string | null;
}

// Fetch a PDF from Front API
async function downloadPdfFromFront(attachmentId: string): Promise<Uint8Array> {
  const url = `https://api2.frontapp.com/download/${attachmentId}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${frontApiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download PDF (${response.status}): ${response.statusText}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

// Convert PDF to base64 for Claude
function bufferToBase64(buffer: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}

// Check if a bill already exists for this front_message_id
async function billAlreadyExists(frontMessageId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('ops_bills')
    .select('id')
    .eq('front_message_id', frontMessageId)
    .limit(1);

  if (error) {
    console.error('Error checking for duplicate:', error);
    return false; // Proceed on error, let the unique constraint catch it
  }

  return data !== null && data.length > 0;
}

// Strip common prefixes/suffixes for better vendor matching
function normalizeVendorName(name: string): string {
  let n = name.trim();
  // Strip leading "The "
  n = n.replace(/^The\s+/i, '');
  // Strip trailing legal suffixes
  n = n.replace(/,?\s*(Inc\.?|LLC\.?|L\.?L\.?C\.?|Corp\.?|Co\.?|Ltd\.?)$/i, '');
  return n.trim();
}

// Try to match vendor name against AppFolio vendor directory
async function matchAppfolioVendor(vendorName: string): Promise<string> {
  if (!vendorName) return vendorName;

  // 1. Exact match (case-insensitive)
  const { data: exact } = await supabase
    .from('af_vendor_directory')
    .select('company_name')
    .ilike('company_name', vendorName)
    .limit(1);

  if (exact && exact.length > 0) return exact[0].company_name;

  // 2. Try normalized name (strip "The ", ", Inc.", ", LLC" etc.)
  const normalized = normalizeVendorName(vendorName);
  if (normalized !== vendorName) {
    const { data: normMatch } = await supabase
      .from('af_vendor_directory')
      .select('company_name')
      .ilike('company_name', normalized)
      .limit(1);

    if (normMatch && normMatch.length > 0) return normMatch[0].company_name;
  }

  // 3. Fuzzy: first word match (skip common words like "The")
  const firstWord = normalized.split(' ')[0];
  if (firstWord && firstWord.length > 2) {
    const { data: fuzzy } = await supabase
      .from('af_vendor_directory')
      .select('company_name')
      .or(`company_name.ilike.%${normalized}%,company_name.ilike.${firstWord}%`)
      .limit(1);

    if (fuzzy && fuzzy.length > 0) return fuzzy[0].company_name;
  }

  // 4. Broader fuzzy: match all significant words individually
  // Catches misspellings like "Janssen Glass" -> "Jansen Glass"
  const words = normalized.split(/\s+/).filter(w => w.length > 2);
  if (words.length >= 2) {
    // Try matching the last word (often the distinctive part: "Glass", "Plumbing", etc.)
    const lastWord = words[words.length - 1];
    const { data: wordMatch } = await supabase
      .from('af_vendor_directory')
      .select('company_name')
      .ilike('company_name', `%${lastWord}%`)
      .limit(20);

    if (wordMatch && wordMatch.length > 0) {
      // Score each candidate by how many words match
      let bestMatch: string | null = null;
      let bestScore = 0;
      for (const candidate of wordMatch) {
        const cLower = candidate.company_name.toLowerCase();
        let score = 0;
        for (const w of words) {
          if (cLower.includes(w.toLowerCase())) score++;
          // Also check first 3 chars for typo tolerance (e.g., "jan" matches "jansen" and "janssen")
          else if (w.length >= 4 && cLower.includes(w.substring(0, 3).toLowerCase())) score += 0.5;
        }
        if (score > bestScore) {
          bestScore = score;
          bestMatch = candidate.company_name;
        }
      }
      // Require at least half the words to match
      if (bestMatch && bestScore >= words.length * 0.5) return bestMatch;
    }
  }

  // No match — return original name
  return vendorName;
}

// Look up historical AppFolio bill data for a vendor to suggest property, GL account, and unit
async function suggestBillDefaults(vendorName: string, description: string | null, emailSubject: string | null = null): Promise<{
  property: string | null;
  gl_account: string | null;
  unit: string | null;
}> {
  const defaults = { property: null as string | null, gl_account: null as string | null, unit: null as string | null };

  if (!vendorName) return defaults;

  try {
    // Query af_bill_detail for the most recent bills from this vendor
    const { data: recentBills } = await supabase
      .from('af_bill_detail')
      .select('property_name, gl_account_name, gl_account_id')
      .ilike('vendor_name', `%${vendorName}%`)
      .order('bill_date', { ascending: false })
      .limit(10);

    if (!recentBills || recentBills.length === 0) {
      // Try fuzzy match with first word
      const firstWord = normalizeVendorName(vendorName).split(' ')[0];
      if (firstWord && firstWord.length > 2) {
        const { data: fuzzyBills } = await supabase
          .from('af_bill_detail')
          .select('property_name, gl_account_name, gl_account_id')
          .ilike('vendor_name', `${firstWord}%`)
          .order('bill_date', { ascending: false })
          .limit(10);

        if (fuzzyBills && fuzzyBills.length > 0) {
          return extractMostCommon(fuzzyBills, description, emailSubject);
        }
      }
      return defaults;
    }

    return extractMostCommon(recentBills, description, emailSubject);
  } catch (err: any) {
    console.error(`suggestBillDefaults error for ${vendorName}:`, err.message);
    return defaults;
  }
}

// From a list of historical bills, pick the most common property and GL account
// If description or email subject mentions a specific property, prefer that match
function extractMostCommon(
  bills: Array<{ property_name: string | null; gl_account_name: string | null; gl_account_id: string | null }>,
  description: string | null,
  emailSubject: string | null = null
): { property: string | null; gl_account: string | null; unit: string | null } {
  // Count occurrences of each GL account (usually consistent per vendor)
  const glCounts: Record<string, { count: number; id: string }> = {};
  for (const b of bills) {
    if (b.gl_account_id) {
      // Extract just the number part (e.g., "5050.9" from "5050.9 - Pest Control")
      const glNum = b.gl_account_id.split(' ')[0];
      glCounts[glNum] = glCounts[glNum] || { count: 0, id: glNum };
      glCounts[glNum].count++;
    }
  }

  // Pick most common GL account
  let bestGl: string | null = null;
  let maxGlCount = 0;
  for (const [id, info] of Object.entries(glCounts)) {
    if (info.count > maxGlCount) {
      bestGl = id;
      maxGlCount = info.count;
    }
  }

  // For property: check description AND email subject for property name hints
  // Combine all text sources for matching
  const textToSearch = [description, emailSubject].filter(Boolean).join(' ').toLowerCase();

  let bestProperty: string | null = null;
  if (textToSearch) {
    for (const b of bills) {
      if (b.property_name) {
        // Check if the property name appears in description or email subject
        const propWords = b.property_name.toLowerCase().split(/\s+/);
        const significantWords = propWords.filter(w => w.length > 2);
        const matchCount = significantWords.filter(w => textToSearch.includes(w)).length;
        if (matchCount >= Math.min(2, significantWords.length)) {
          bestProperty = b.property_name;
          break;
        }
      }
    }
  }

  // Fallback: most common property for this vendor
  if (!bestProperty) {
    const propCounts: Record<string, number> = {};
    for (const b of bills) {
      if (b.property_name) {
        propCounts[b.property_name] = (propCounts[b.property_name] || 0) + 1;
      }
    }
    let maxPropCount = 0;
    for (const [name, count] of Object.entries(propCounts)) {
      if (count > maxPropCount) {
        bestProperty = name;
        maxPropCount = count;
      }
    }
  }

  return { property: bestProperty, gl_account: bestGl, unit: null };
}

// Use Claude to intelligently parse invoice data
async function parseInvoiceWithClaude(
  pdfBase64: string,
  emailSubject: string,
  emailBody: string,
  senderName: string
): Promise<ParsedInvoice> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `You are an accounts payable document classifier and parser for a property management company. Your job is to determine what kind of document this is, then extract relevant data.

STEP 1 — CLASSIFY THE DOCUMENT TYPE. This is the most important step.
Read the PDF, email subject, and email body carefully. Classify as one of:
- "invoice" — A bill requesting payment FROM us to a vendor. Must show an amount due, balance due, or similar language demanding payment.
- "estimate" — A quote, proposal, bid, or estimate. Often from Docusign, marked "Proposal", "Quote", "Estimate", or "Bid". No payment is due yet.
- "receipt" — Proof of a purchase already completed and paid (e.g., Home Depot receipts, store receipts, credit card transaction confirmations). The money has already left our account.
- "payment" — Someone is paying US. Look for: "payment remittance", "ACH payment", "rent payment", "deposit", "remittance advice", "payment confirmation" in the subject/body. Entities like Salvation Army, Housing Authority, or tenants sending money TO us are payments.
- "credit_memo" — A refund, credit, or return from a vendor. The vendor owes US money. Look for: "credit memo", "refund", "return", "credit note", negative amounts, or return merchandise.
- "other" — Thank-you notes for paying a bill, account statements, marketing, subscription confirmations, or anything that is NOT a bill requiring action.

KEY CLASSIFICATION RULES:
- If the email subject contains "remittance", "payment", "ACH", "deposit", or "rent" — it is almost certainly a "payment" (money coming to us), NOT an invoice.
- If the document is a store receipt or electronic receipt (Home Depot, Lowe's, etc.) — classify as "receipt" with payment_status "paid".
- If the document comes from Docusign or contains "proposal", "quote", "bid" — classify as "estimate".
- If the email body thanks us for a payment or confirms a payment we made — classify as "other".
- If the document shows a REFUND, CREDIT, or RETURN — classify as "credit_memo". The amount should be NEGATIVE.
- ONLY classify as "invoice" if you are confident this is a genuine bill requesting payment from us.

STEP 2 — EXTRACT DATA:
- Vendor/Company name: Use the actual vendor or company that provided goods/services, as shown on the document. Do NOT use the email sender if it is a payment processor, bank, or notification service (e.g. Mercury, PayPal, Stripe, Square).
- Invoice number (or reference number, receipt number, etc.)
- Amount (total, as a number). For credit memos and refunds, use a NEGATIVE number.
- Date (YYYY-MM-DD format)
- Due date (YYYY-MM-DD format, if available)
- Brief description of what the document is about
- Payment status: "paid", "unpaid", or "unknown"

Email Subject: ${emailSubject}
Sender Name: ${senderName}
Email Body Preview: ${(emailBody || '').slice(0, 500)}

Return ONLY valid JSON (no markdown, no code blocks) with these exact keys:
{
  "vendor_name": "string or null",
  "invoice_number": "string or null",
  "invoice_amount": number or null,
  "invoice_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null",
  "description": "string or null",
  "document_type": "invoice or estimate or receipt or payment or credit_memo or other",
  "payment_status": "paid or unpaid or unknown"
}`,
          },
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64,
            },
          },
        ],
      },
    ],
  });

  try {
    const content = message.content[0];
    if (content.type !== 'text') throw new Error('Unexpected response type');

    // Extract JSON from response (handle markdown code blocks if present)
    let jsonStr = content.text.trim();
    if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
    if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);

    const parsed = JSON.parse(jsonStr.trim());
    return parsed as ParsedInvoice;
  } catch (error) {
    console.error('Failed to parse Claude response:', error);
    return {
      vendor_name: null,
      invoice_number: null,
      invoice_amount: null,
      invoice_date: null,
      due_date: null,
      description: null,
      document_type: null,
      payment_status: null,
    };
  }
}

// Upload PDF to Supabase Storage
async function uploadPdfToStorage(
  pdfBuffer: Uint8Array,
  conversationId: string,
  attachmentId: string
): Promise<string> {
  const filename = `${conversationId}/${attachmentId}.pdf`;

  const { error } = await supabase.storage
    .from('billing-invoices')
    .upload(filename, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) {
    console.error('Storage upload error:', error);
    throw error;
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from('billing-invoices')
    .getPublicUrl(filename);

  return urlData.publicUrl;
}

// Main handler using Deno.serve
Deno.serve(async (req: Request) => {
  try {
    console.log('Starting invoice PDF parsing...');

    // Query front_messages with attachments that haven't been parsed
    const { data: messages, error } = await supabase
      .from('front_messages')
      .select('*')
      .eq('ap_extracted', false)
      .gt('attachment_count', 0)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      throw new Error(`Supabase query error: ${error.message}`);
    }

    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ message: 'No messages to process' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${messages.length} messages to process...`);

    const results: Array<Record<string, unknown>> = [];
    const opsBillsInserts: Array<Record<string, unknown>> = [];

    for (const msg of messages as FrontMessage[]) {
      try {
        if (!msg.attachment_ids || msg.attachment_ids.length === 0) {
          // Mark as extracted since there are no actual attachment IDs to process
          await supabase
            .from('front_messages')
            .update({ ap_extracted: true })
            .eq('front_id', msg.front_id);
          continue;
        }

        // Duplicate check: skip if bill already exists for this message
        const exists = await billAlreadyExists(msg.front_id);
        if (exists) {
          console.log(`Skipping ${msg.front_id} — bill already exists`);
          // Mark as extracted so we don't check it again
          await supabase
            .from('front_messages')
            .update({ ap_extracted: true })
            .eq('front_id', msg.front_id);
          results.push({
            frontMessageId: msg.front_id,
            status: 'skipped',
            reason: 'duplicate',
          });
          continue;
        }

        const attachmentId = msg.attachment_ids[0]; // Use first attachment
        console.log(`Processing message ${msg.front_id}, attachment ${attachmentId}...`);

        // Download PDF
        const pdfBuffer = await downloadPdfFromFront(attachmentId);

        // Parse with Claude
        const invoice = await parseInvoiceWithClaude(
          bufferToBase64(pdfBuffer),
          msg.subject || '',
          msg.body_text || '',
          msg.sender_name || 'Unknown'
        );

        // Try to match vendor name against AppFolio vendor directory
        if (invoice.vendor_name) {
          invoice.vendor_name = await matchAppfolioVendor(invoice.vendor_name);
        }

        // Validate required fields — ops_bills requires vendor_name, amount, invoice_date as NOT NULL
        if (!invoice.vendor_name || invoice.invoice_amount === null || !invoice.invoice_date) {
          console.warn(`Incomplete parse for ${msg.front_id}: vendor=${invoice.vendor_name}, amount=${invoice.invoice_amount}, date=${invoice.invoice_date}`);

          // Still mark as extracted but record the partial data on front_messages
          await supabase
            .from('front_messages')
            .update({
              ap_extracted: true,
              vendor_name: invoice.vendor_name,
              invoice_number: invoice.invoice_number,
              invoice_amount: invoice.invoice_amount,
              invoice_date: invoice.invoice_date,
              due_date: invoice.due_date,
              ap_notes: 'Incomplete parse — missing required fields for ops_bills',
            })
            .eq('front_id', msg.front_id);

          results.push({
            frontMessageId: msg.front_id,
            attachmentId,
            status: 'incomplete',
            invoice,
            reason: 'Missing required fields (vendor_name, amount, or invoice_date)',
          });
          continue;
        }

        // Upload to Storage
        const pdfUrl = await uploadPdfToStorage(pdfBuffer, msg.conversation_id, attachmentId);

        // Suggest Property, GL Account from historical Appfolio data
        const suggestions = await suggestBillDefaults(
          invoice.vendor_name!,
          invoice.description,
          msg.subject
        );
        console.log(`  Bill defaults for ${invoice.vendor_name}: property=${suggestions.property}, gl=${suggestions.gl_account}`);

        // Flag credit memos / refunds for manual entry
        const isCredit = invoice.document_type === 'credit_memo' || (invoice.invoice_amount !== null && invoice.invoice_amount < 0);
        const billStatus = isCredit ? 'manual_entry' : 'pending';
        const billDescription = isCredit
          ? `⚠️ CREDIT/REFUND — Manual entry required. ${invoice.description || ''}`
          : invoice.description;

        // Prepare ops_bills entry
        opsBillsInserts.push({
          vendor_name: invoice.vendor_name,
          amount: invoice.invoice_amount,
          invoice_date: invoice.invoice_date,
          invoice_number: invoice.invoice_number,
          front_conversation_id: msg.conversation_id,
          front_message_id: msg.front_id,
          front_email_subject: msg.subject,
          front_email_from: msg.sender_email,
          attachments_json: [{ filename: `${attachmentId}.pdf`, url: pdfUrl }],
          status: billStatus,
          due_date: invoice.due_date,
          description: billDescription,
          document_type: invoice.document_type || 'invoice',
          payment_status: invoice.payment_status || 'unpaid',
          af_property_input: suggestions.property,
          af_gl_account_input: suggestions.gl_account,
          af_unit_input: suggestions.unit,
        });

        // Mark message as extracted with parsed data
        await supabase
          .from('front_messages')
          .update({
            ap_extracted: true,
            vendor_name: invoice.vendor_name,
            invoice_number: invoice.invoice_number,
            invoice_amount: invoice.invoice_amount,
            invoice_date: invoice.invoice_date,
            due_date: invoice.due_date,
          })
          .eq('front_id', msg.front_id);

        results.push({
          frontMessageId: msg.front_id,
          attachmentId,
          status: 'success',
          invoice,
          pdfUrl,
          is_credit: isCredit,
        });

        console.log(`Parsed ${invoice.vendor_name}: $${invoice.invoice_amount}${isCredit ? ' (CREDIT — flagged for manual entry)' : ''}`);
      } catch (error) {
        console.error(`Error processing message ${msg.front_id}:`, error);
        results.push({
          frontMessageId: msg.front_id,
          attachmentId: msg.attachment_ids?.[0],
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Insert into ops_bills one at a time for proper error handling
    // Dedup is handled by billAlreadyExists() check above; partial unique indexes are a safety net
    let actualInserted = 0;
    const insertErrors: Array<{ vendor: string; error: string }> = [];

    for (const bill of opsBillsInserts) {
      const { error: insertError } = await supabase
        .from('ops_bills')
        .insert(bill);

      if (insertError) {
        console.error(`ops_bills insert error for ${bill.vendor_name}:`, insertError.message);
        insertErrors.push({
          vendor: bill.vendor_name as string,
          error: insertError.message,
        });
      } else {
        actualInserted++;
        console.log(`Inserted bill: ${bill.vendor_name} $${bill.amount}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        inserted: actualInserted,
        insertErrors: insertErrors.length > 0 ? insertErrors : undefined,
        skipped: results.filter(r => r.status === 'skipped').length,
        incomplete: results.filter(r => r.status === 'incomplete').length,
        errors: results.filter(r => r.status === 'error').length,
        results,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in invoice parser:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
});
