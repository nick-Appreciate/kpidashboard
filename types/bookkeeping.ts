// ─── Shared types for the unified Bookkeeping page ─────────────────────────

export interface BrexExpense {
  id: number;
  brex_id: string;
  expense_id: string | null;
  amount: number;
  currency: string;
  merchant_name: string;
  merchant_raw_descriptor: string;
  initiated_at: string | null;
  posted_at: string | null;
  transaction_type: string | null;
  memo: string | null;
  receipt_ids: string[] | null;
  receipt_urls: string[] | null;
  match_status: "unmatched" | "matched" | "corporate";
  match_confidence: "high" | "low" | null;
  matched_bill_id: number | null;
  matched_at: string | null;
  matched_by: string | null;
  is_corporate: boolean;
  corporate_note: string | null;
  corporate_at: string | null;
  synced_at: string;
  af_vendor_name: string | null;
  af_property_input: string | null;
  af_gl_account_input: string | null;
  af_unit_input: string | null;
  af_approved_by: string | null;
  af_approved_at: string | null;
  appfolio_synced: boolean;
  appfolio_checked_at: string | null;
  appfolio_bill_id: number | null;
  bill_vendor_name: string | null;
  bill_amount: number | null;
  bill_invoice_date: string | null;
  bill_invoice_number: string | null;
  bill_status: string | null;
  bill_payment_status: string | null;
  bill_appfolio_bill_id: number | null;
}

export interface Bill {
  id: number;
  vendor_name: string;
  amount: number;
  invoice_date: string;
  invoice_number: string | null;
  front_conversation_id: string | null;
  front_email_subject: string | null;
  front_email_from: string | null;
  attachments_json: any;
  created_at: string;
  due_date: string | null;
  description: string | null;
  document_type: "invoice" | "estimate" | "receipt" | "payment" | "credit_memo" | "other";
  status: string | null;
  payment_status: "paid" | "unpaid" | "unknown";
  is_hidden: boolean;
  hidden_note: string | null;
  hidden_at: string | null;
  af_bill_id: string | null;
  af_status: string | null;
  af_property_name: string | null;
  af_gl_account_name: string | null;
  af_paid_date: string | null;
  af_memo: string | null;
  af_match_status: "matched" | "unmatched";
  front_message_id: string | null;
  af_property_input: string | null;
  af_gl_account_input: string | null;
  af_unit_input: string | null;
  af_approved_by: string | null;
  af_approved_at: string | null;
}

export interface GLAccount {
  id: string;
  name: string;
}

export interface ExpenseDraft {
  vendor_name: string;
  amount: string;
  invoice_date: string;
  due_date: string;
  description: string;
  af_property_input: string;
  af_gl_account_input: string;
  af_unit_input: string;
}

export interface BillDraft {
  vendor_name: string;
  amount: string;
  invoice_date: string;
  due_date: string;
  invoice_number: string;
  description: string;
  af_property_input: string;
  af_gl_account_input: string;
  af_unit_input: string;
}

export interface PotentialMatch {
  id: number | string;
  vendor_name: string;
  amount: number;
  invoice_date: string | null;
  invoice_number: string | null;
  status: string | null;
  payment_status: string | null;
  score: number;
  match_reason: string;
  source?: 'ops_bills' | 'af_bill_detail';
  property_name?: string | null;
}

export interface BrexQueueItem {
  expenseId: number;
  vendorName: string;
  amount: number;
  status: 'queued' | 'uploading' | 'success' | 'failed';
  message?: string;
  queuedAt: Date;
  completedAt?: Date;
}

export interface BillQueueItem {
  billId: number;
  vendorName: string;
  amount: number;
  status: 'queued' | 'uploading' | 'success' | 'failed';
  message?: string;
  queuedAt: Date;
  completedAt?: Date;
}

export type UnifiedQueueItem =
  | ({ itemType: 'brex' } & BrexQueueItem)
  | ({ itemType: 'bill' } & BillQueueItem);

export type FeedItem =
  | { type: 'brex'; data: BrexExpense; sortDate: Date }
  | { type: 'bill'; data: Bill; sortDate: Date };

export type UnifiedFilterOption = "all" | "action_needed" | "completed" | "corporate" | "hidden" | "payments";
export type SourceFilter = "all" | "brex" | "invoices";
export type UnifiedSortOption = "action_first" | "date_newest" | "date_oldest" | "amount_high" | "amount_low";

export interface PrefillData {
  vendor_name: string;
  property: string;
  gl_account: string;
  description: string;
}

export interface DuplicateGroup {
  id: number;
  group_key: string;
  vendor_name: string;
  amount: number;
  property: string | null;
  unit: string | null;
  bill_month: string;
  bill_ids: string[];
  dup_count: number;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  resolved_note: string | null;
  bills: DuplicateBillDetail[];
}

export interface DuplicateBillDetail {
  bill_id: string;
  bill_date: string;
  bill_number: string | null;
  status: string | null;
  description: string | null;
}

export interface CorporateMerchantRule {
  merchant_name_normalized: string;
  display_name: string;
  is_corporate_merchant: boolean;
  expense_count: number;
  corporate_count: number;
  non_corporate_count: number;
}
