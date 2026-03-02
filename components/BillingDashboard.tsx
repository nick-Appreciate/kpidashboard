'use client';

import React, { useEffect, useState } from "react";
import { ExternalLink, FileText, CheckCircle2, AlertCircle } from "lucide-react";
import { LogoLoader } from "./Logo";

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
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <LogoLoader text="Loading bills..." />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4">
      <div className="max-w-full mx-auto">
        {/* Header Card */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">Billing / AP</h1>
              <p className="text-sm text-slate-500">
                {bills.length} bills total · <span className="text-yellow-600">{unmatchedCount} unmatched</span> · <span className="text-green-600">{matchedCount} matched</span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortOption)}
                className="px-2 py-1 border border-slate-300 rounded text-sm bg-white"
              >
                <option value="unmatched_first">Unmatched first</option>
                <option value="matched_first">Matched first</option>
                <option value="date_newest">Date (newest)</option>
                <option value="date_oldest">Date (oldest)</option>
              </select>
            </div>
          </div>

          {/* Filter Chips */}
          <div className="flex gap-1.5 mt-3 pt-3 border-t border-slate-100">
            {(["all", "unmatched", "matched"] as FilterOption[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-sm rounded font-medium transition-colors ${
                  filter === f
                    ? f === "unmatched"
                      ? "bg-yellow-100 text-yellow-800"
                      : f === "matched"
                      ? "bg-green-100 text-green-800"
                      : "bg-slate-800 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {f === "all" ? `All (${bills.length})` : f === "unmatched" ? `Unmatched (${unmatchedCount})` : `Matched (${matchedCount})`}
              </button>
            ))}
          </div>
        </div>

        {/* Bill Cards */}
        {sortedBills.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-8 text-center text-slate-500">
            No bills found for the current filter.
          </div>
        ) : (
          <div className="space-y-3">
            {sortedBills.map((bill) => {
              const pdfUrl = getAttachmentUrl(bill.attachments_json);
              const isMatched = bill.af_match_status === "matched";

              return (
                <div
                  key={bill.id}
                  className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden"
                >
                  <div className="grid grid-cols-2 divide-x divide-slate-200">
                    {/* LEFT PANEL: Front / Parsed Invoice */}
                    <div className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Front / Parsed</span>
                      </div>
                      <h2 className="text-base font-semibold text-slate-800 mb-0.5">{bill.vendor_name}</h2>
                      <p className="text-xs text-slate-500 mb-3">
                        {bill.front_email_from} · {new Date(bill.created_at).toLocaleDateString()}
                      </p>

                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-3">
                        <div>
                          <span className="text-xs text-slate-400">Amount</span>
                          <p className="font-bold text-slate-900 text-base">${Number(bill.amount).toFixed(2)}</p>
                        </div>
                        <div>
                          <span className="text-xs text-slate-400">Invoice Date</span>
                          <p className="font-mono text-sm text-slate-700">{bill.invoice_date}</p>
                        </div>
                        {bill.invoice_number && (
                          <div>
                            <span className="text-xs text-slate-400">Invoice #</span>
                            <p className="font-mono text-sm text-slate-700">{bill.invoice_number}</p>
                          </div>
                        )}
                        {bill.due_date && (
                          <div>
                            <span className="text-xs text-slate-400">Due Date</span>
                            <p className="font-mono text-sm text-slate-700">{bill.due_date}</p>
                          </div>
                        )}
                      </div>

                      {bill.front_email_subject && (
                        <p className="text-xs text-slate-500 mb-2 line-clamp-1">
                          <span className="text-slate-400">Subject: </span>{bill.front_email_subject}
                        </p>
                      )}

                      {bill.description && (
                        <p className="text-xs text-slate-500 mb-2 line-clamp-2">
                          <span className="text-slate-400">Description: </span>{bill.description}
                        </p>
                      )}

                      {/* Badges */}
                      <div className="flex gap-1.5 mb-3 flex-wrap">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                          bill.document_type === "invoice" ? "bg-blue-100 text-blue-800" :
                          bill.document_type === "estimate" ? "bg-purple-100 text-purple-800" :
                          "bg-slate-100 text-slate-700"
                        }`}>
                          {bill.document_type}
                        </span>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                          bill.payment_status === "paid" ? "bg-green-100 text-green-800" :
                          bill.payment_status === "unpaid" ? "bg-yellow-100 text-yellow-800" :
                          "bg-slate-100 text-slate-700"
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
                            className="flex items-center gap-1 text-xs px-2 py-1 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            PDF
                          </a>
                        )}
                        {bill.front_conversation_id && (
                          <a
                            href={`https://app.frontapp.com/conversations/${bill.front_conversation_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs px-2 py-1 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Front
                          </a>
                        )}
                      </div>
                    </div>

                    {/* RIGHT PANEL: AppFolio */}
                    <div className={`p-4 ${isMatched ? "bg-green-50" : "bg-yellow-50"}`}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">AppFolio</span>
                        {isMatched ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-green-200 text-green-800">
                            <CheckCircle2 className="w-3 h-3" />
                            Matched
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-yellow-200 text-yellow-800">
                            <AlertCircle className="w-3 h-3" />
                            Unmatched
                          </span>
                        )}
                      </div>

                      {isMatched ? (
                        <div className="space-y-2 text-sm">
                          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                            <div>
                              <span className="text-xs text-slate-400">AF Status</span>
                              <p className={`font-semibold text-sm ${
                                bill.af_status === "Paid" ? "text-green-700" : "text-yellow-700"
                              }`}>{bill.af_status}</p>
                            </div>
                            {bill.af_property_name && (
                              <div>
                                <span className="text-xs text-slate-400">Property</span>
                                <p className="font-medium text-sm text-slate-700">{bill.af_property_name}</p>
                              </div>
                            )}
                            {bill.af_gl_account_name && (
                              <div className="col-span-2">
                                <span className="text-xs text-slate-400">GL Account</span>
                                <p className="font-medium text-sm text-slate-700">{bill.af_gl_account_name}</p>
                              </div>
                            )}
                            {bill.af_paid_date && (
                              <div>
                                <span className="text-xs text-slate-400">Paid Date</span>
                                <p className="font-mono text-sm text-slate-700">{bill.af_paid_date}</p>
                              </div>
                            )}
                            {bill.af_memo && (
                              <div className="col-span-2">
                                <span className="text-xs text-slate-400">Memo</span>
                                <p className="text-sm text-slate-600">{bill.af_memo}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-sm text-yellow-800 font-medium">
                            Not yet in AppFolio. Enter this bill:
                          </p>
                          <div className="bg-white border border-yellow-200 rounded-lg p-3 space-y-1.5 text-sm">
                            <div className="flex justify-between">
                              <span className="text-slate-500 text-xs">Vendor</span>
                              <span className="font-semibold text-slate-800 text-xs">{bill.vendor_name}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500 text-xs">Amount</span>
                              <span className="font-semibold text-slate-800 text-xs">${Number(bill.amount).toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500 text-xs">Invoice Date</span>
                              <span className="font-mono text-slate-700 text-xs">{bill.invoice_date}</span>
                            </div>
                            {bill.invoice_number && (
                              <div className="flex justify-between">
                                <span className="text-slate-500 text-xs">Invoice #</span>
                                <span className="font-mono text-slate-700 text-xs">{bill.invoice_number}</span>
                              </div>
                            )}
                            {bill.due_date && (
                              <div className="flex justify-between">
                                <span className="text-slate-500 text-xs">Due Date</span>
                                <span className="font-mono text-slate-700 text-xs">{bill.due_date}</span>
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
    </div>
  );
}
