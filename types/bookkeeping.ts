// ─── Shared types for the unified Bookkeeping page ─────────────────────────

export interface GLAccount {
  id: string;
  name: string;
}

export type UnifiedFilterOption = "all" | "action_needed" | "completed" | "duplicates" | "corporate" | "hidden" | "payments";
export type SourceFilter = "all" | "brex" | "invoices";
export type UnifiedSortOption = "action_first" | "date_newest" | "date_oldest" | "amount_high" | "amount_low";

// ─── Unified Bills types ────────────────────────────────────────────────────

export interface UnifiedBill {
  id: number;
  source: 'brex' | 'front' | 'manual';
  brex_expense_id: number | null;
  front_message_id: string | null;
  vendor_name: string;
  amount: number;
  invoice_number: string | null;
  invoice_date: string;
  due_date: string | null;
  description: string | null;
  af_property_input: string | null;
  af_gl_account_input: string | null;
  af_unit_input: string | null;
  document_type: string;
  attachments_json: any;
  dedup_key: string | null;
  is_duplicate: boolean;
  duplicate_of_id: number | null;
  status: string;
  appfolio_bill_id: number | null;
  appfolio_synced_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  is_hidden: boolean;
  hidden_note: string | null;
  hidden_at: string | null;
  front_email_subject: string | null;
  front_email_from: string | null;
  front_conversation_id: string | null;
  payment_status: string;
  created_at: string;
  updated_at: string;
  // Brex source data (joined from brex_expenses when source='brex')
  brex_merchant_name: string | null;
  brex_merchant_raw: string | null;
  brex_posted_at: string | null;
  brex_initiated_at: string | null;
  brex_transaction_type: string | null;
  brex_memo: string | null;
  brex_receipt_ids: string[] | null;
  brex_expense_id_str: string | null;
}

export interface UnifiedBillDraft {
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

export interface UnifiedQueueItemV2 {
  billId: number;
  source: 'brex' | 'front' | 'manual';
  vendorName: string;
  amount: number;
  status: 'queued' | 'uploading' | 'success' | 'failed';
  message?: string;
  afBillId?: number;
  queuedAt: Date;
  completedAt?: Date;
}

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
