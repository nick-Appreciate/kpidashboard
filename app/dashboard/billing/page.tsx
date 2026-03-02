'use client';

import React, { useEffect, useState } from "react";
import { Loader2, ExternalLink, FileText, CheckCircle2, AlertCircle } from "lucide-react";

interface Bill {
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
  document_type: "invoice" | "estimate" | "other";
  payment_status: "paid" | "unpaid" | "unknown";
  af_bill_id: string | null;
  af_status: string | null;
  af_property_name: string | null;
  af_gl_account_name: string | null;
  af_paid_date: string | null;
  af_memo: string | null;
  af_match_status: "matched" | "unmatched";
}

type SortOption = "unmatched_first" | "matched_first" | "date_newest" | "date_oldest";
type FilterOption = "all" | "unmatched" | "matched";

export default function BillingDashboard() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortOption>("unmatched_first");
  const [filter, setFilter] = useState<FilterOption>("all");

  useEffect(() => {
    const fetchBills = async () => {
      try {
        const response = await fetch("/api/billing/get-bills");
        if (!response.ok) throw new Error("Failed to fetch bills");
        const data = await response.json();
        setBills(data || []);
      } catch (error) {
        console.error("Error fetching bills:", error);
      }
      setLoading(false);
    };

    fetchBills();
    const interval = setInterval(fetchBills, 15000);
    return () => clearInterval(interval);
  }, []);

  const getAttachmentUrl = (attachmentsJson: any): string | null => {
    if (!attachmentsJson) return null;
    try {
      const arr = typeof attachmentsJson === "string" ? JSON.parse(attachmentsJson) : attachmentsJson;
      return arr?.[0]?.url || null;
    } catch {
      return null;
    }
  };

  const filteredBills = bills.filter((bill) => {
    if (filter === "unmatched") return bill.af_match_status === "unmatched";
    if (filter === "matched") return bill.af_match_status === "matched";
    return true;
  });

  const sortedBills = [...filteredBills].sort((a, b) => {
    if (sort === "unmatched_first") {
      if (a.af_match_status !== b.af_match_status) {
        return a.af_match_status === "unmatched" ? -1 : 1;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    if (sort === "matched_first") {
      if (a.af_match_status !== b.af_match_status) {
        return a.af_match_status === "matched" ? -1 : 1;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    if (sort === "date_newest") {
      return new Date(b.invoice_date).getTime() - new Date(a.invoice_date).getTime();
    }
    return new Date(a.invoice_date).getTime() - new Date(b.invoice_date).getTime();
  });

  const unmatchedCount = bills.filter((b) => b.af_match_status === "unmatched").length;
  const matchedCount = bills.filter((b) => b.af_match_status === "matched").length;

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-32 bg-gray-200 animate-pulse rounded" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Billing / AP</h1>
        <p className="text-gray-500">
          {bills.length} bills total &middot;{" "}
          <span className="text-yellow-700">{unmatchedCount} unmatched</span> &middot;{" "}
          <span className="text-green-700">{matchedCount} matched</span>
        </p>
      </div>

      {/* Sort & Filter Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Sort:</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="text-sm border rounded px-2 py-1 bg-white"
          >
            <option value="unmatched_first">Unmatched first</option>
            <option value="matched_first">Matched first</option>
            <option value="date_newest">Date (newest)</option>
            <option value="date_oldest">Date (oldest)</option>
          </select>
        </div>
        <div className="flex gap-1">
          {(["all", "unmatched", "matched"] as FilterOption[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-sm rounded-full font-medium transition-colors ${
                filter === f
                  ? f === "unmatched"
                    ? "bg-yellow-200 text-yellow-900"
                    : f === "matched"
                    ? "bg-green-200 text-green-900"
                    : "bg-gray-800 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f === "all" ? `All (${bills.length})` : f === "unmatched" ? `Unmatched (${unmatchedCount})` : `Matched (${matchedCount})`}
            </button>
          ))}
        </div>
      </div>

      {/* Bill Cards */}
      {sortedBills.length === 0 ? (
        <div className="border rounded-lg p-6 text-center text-gray-500">
          No bills found for the current filter.
        </div>
      ) : (
        <div className="space-y-4">
          {sortedBills.map((bill) => {
            const pdfUrl = getAttachmentUrl(bill.attachments_json);
            const isMatched = bill.af_match_status === "matched";

            return (
              <div
                key={bill.id}
                className="border rounded-lg bg-white shadow-sm overflow-hidden"
              >
                <div className="grid grid-cols-2 divide-x">
                  {/* LEFT PANEL: Front / Parsed Invoice */}
                  <div className="p-5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Front / Parsed</span>
                    </div>
                    <h2 className="text-lg font-bold mb-1">{bill.vendor_name}</h2>
                    <p className="text-sm text-gray-500 mb-3">
                      {bill.front_email_from} &middot; {new Date(bill.created_at).toLocaleDateString()}
                    </p>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-3">
                      <div>
                        <span className="text-gray-400">Amount</span>
                        <p className="font-semibold text-lg">${Number(bill.amount).toFixed(2)}</p>
                      </div>
                      <div>
                        <span className="text-gray-400">Invoice Date</span>
                        <p className="font-mono">{bill.invoice_date}</p>
                      </div>
                      {bill.invoice_number && (
                        <div>
                          <span className="text-gray-400">Invoice #</span>
                          <p className="font-mono">{bill.invoice_number}</p>
                        </div>
                      )}
                      {bill.due_date && (
                        <div>
                          <span className="text-gray-400">Due Date</span>
                          <p className="font-mono">{bill.due_date}</p>
                        </div>
                      )}
                    </div>

                    {bill.front_email_subject && (
                      <p className="text-sm text-gray-500 mb-3 line-clamp-1">
                        <span className="text-gray-400">Subject: </span>{bill.front_email_subject}
                      </p>
                    )}

                    {bill.description && (
                      <p className="text-sm text-gray-500 mb-3 line-clamp-2">
                        <span className="text-gray-400">Description: </span>{bill.description}
                      </p>
                    )}

                    {/* Badges */}
                    <div className="flex gap-1 mb-3 flex-wrap">
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded ${
                        bill.document_type === "invoice" ? "bg-blue-100 text-blue-800" :
                        bill.document_type === "estimate" ? "bg-purple-100 text-purple-800" :
                        "bg-gray-100 text-gray-800"
                      }`}>
                        {bill.document_type}
                      </span>
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded ${
                        bill.payment_status === "paid" ? "bg-green-100 text-green-800" :
                        bill.payment_status === "unpaid" ? "bg-yellow-100 text-yellow-800" :
                        "bg-gray-100 text-gray-800"
                      }`}>
                        {bill.payment_status}
                      </span>
                    </div>

                    {/* Action Links */}
                    <div className="flex gap-3">
                      {pdfUrl && (
                        <a
                          href={pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-sm text-blue-600 hover:underline"
                        >
                          <FileText className="w-4 h-4" />
                          View PDF
                        </a>
                      )}
                      {bill.front_conversation_id && (
                        <a
                          href={`https://app.frontapp.com/conversations/${bill.front_conversation_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-sm text-blue-600 hover:underline"
                        >
                          <ExternalLink className="w-4 h-4" />
                          View in Front
                        </a>
                      )}
                    </div>
                  </div>

                  {/* RIGHT PANEL: AppFolio */}
                  <div className={`p-5 ${isMatched ? "bg-green-50" : "bg-yellow-50"}`}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">AppFolio</span>
                      {isMatched ? (
                        <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded bg-green-200 text-green-900">
                          <CheckCircle2 className="w-3 h-3" />
                          Matched
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded bg-yellow-200 text-yellow-900">
                          <AlertCircle className="w-3 h-3" />
                          Unmatched
                        </span>
                      )}
                    </div>

                    {isMatched ? (
                      <div className="space-y-2 text-sm">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                          <div>
                            <span className="text-gray-400">AF Status</span>
                            <p className={`font-semibold ${
                              bill.af_status === "Paid" ? "text-green-700" : "text-yellow-700"
                            }`}>{bill.af_status}</p>
                          </div>
                          {bill.af_property_name && (
                            <div>
                              <span className="text-gray-400">Property</span>
                              <p className="font-medium">{bill.af_property_name}</p>
                            </div>
                          )}
                          {bill.af_gl_account_name && (
                            <div className="col-span-2">
                              <span className="text-gray-400">GL Account</span>
                              <p className="font-medium">{bill.af_gl_account_name}</p>
                            </div>
                          )}
                          {bill.af_paid_date && (
                            <div>
                              <span className="text-gray-400">Paid Date</span>
                              <p className="font-mono">{bill.af_paid_date}</p>
                            </div>
                          )}
                          {bill.af_memo && (
                            <div className="col-span-2">
                              <span className="text-gray-400">Memo</span>
                              <p className="text-gray-700">{bill.af_memo}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm text-yellow-800 font-medium">
                          Not yet in AppFolio. Enter this bill:
                        </p>
                        <div className="bg-white border border-yellow-200 rounded p-3 space-y-1 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-500">Vendor</span>
                            <span className="font-semibold">{bill.vendor_name}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Amount</span>
                            <span className="font-semibold">${Number(bill.amount).toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Invoice Date</span>
                            <span className="font-mono">{bill.invoice_date}</span>
                          </div>
                          {bill.invoice_number && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Invoice #</span>
                              <span className="font-mono">{bill.invoice_number}</span>
                            </div>
                          )}
                          {bill.due_date && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Due Date</span>
                              <span className="font-mono">{bill.due_date}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
