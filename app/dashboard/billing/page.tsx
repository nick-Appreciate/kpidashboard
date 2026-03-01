'use client';

import React, { useEffect, useState } from "react";
import { Loader2, ExternalLink, CheckCircle2 } from "lucide-react";

interface Bill {
  id: number;
  vendor_name: string;
  amount: number;
  invoice_date: string;
  invoice_number: string | null;
  front_conversation_id: string;
  front_message_id: string;
  front_email_subject: string;
  front_email_from: string;
  attachments_json: any;
  status: "pending" | "entered" | "skipped" | "error";
  created_at: string;
}

export default function BillingDashboard() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<number | null>(null);

  useEffect(() => {
    const fetchBills = async () => {
      setLoading(true);
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
    const interval = setInterval(fetchBills, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleEntered = async (bill: Bill) => {
    setProcessingId(bill.id);

    try {
      const response = await fetch("/api/billing/add-front-comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billId: bill.id,
          conversationId: bill.front_conversation_id,
          vendorName: bill.vendor_name,
          amount: bill.amount,
          invoiceDate: bill.invoice_date,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Error: ${response.statusText}`);
      }

      setBills((prev) => prev.filter((b) => b.id !== bill.id));
    } catch (error) {
      console.error("Error:", error);
      alert(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setProcessingId(null);
    }
  };

  const getAttachments = (attachmentsJson: string | null) => {
    if (!attachmentsJson) return [];
    try {
      return JSON.parse(attachmentsJson);
    } catch {
      return [];
    }
  };

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
      <div>
        <h1 className="text-3xl font-bold">Billing / AP</h1>
        <p className="text-gray-500">
          {bills.length} pending bills waiting to be entered into Appfolio
        </p>
      </div>

      {bills.length === 0 ? (
        <div className="border rounded-lg p-6 text-center text-gray-500">
          No pending bills. All caught up! ✓
        </div>
      ) : (
        <div className="space-y-4">
          {bills.map((bill) => (
            <div
              key={bill.id}
              className="border-l-4 border-l-yellow-400 border rounded-lg p-6 bg-white shadow-sm"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h2 className="text-xl font-bold">{bill.vendor_name}</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {bill.front_email_from} • {new Date(bill.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold">${bill.amount.toFixed(2)}</div>
                  <span className="inline-block mt-2 px-2 py-1 text-xs font-semibold rounded bg-yellow-100 text-yellow-800">
                    {bill.status}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                <div>
                  <span className="text-gray-500">Invoice Date</span>
                  <p className="font-mono">{bill.invoice_date}</p>
                </div>
                {bill.invoice_number && (
                  <div>
                    <span className="text-gray-500">Invoice #</span>
                    <p className="font-mono">{bill.invoice_number}</p>
                  </div>
                )}
                <div className="col-span-2">
                  <span className="text-gray-500">Email Subject</span>
                  <p className="line-clamp-2">{bill.front_email_subject}</p>
                </div>
              </div>

              {getAttachments(bill.attachments_json).length > 0 && (
                <div className="mb-4">
                  <p className="text-sm text-gray-500 mb-2">Attachments</p>
                  <div className="space-y-1">
                    {getAttachments(bill.attachments_json).map((att: any, idx: number) => (
                      <a
                        key={idx}
                        href={att.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                      >
                        <ExternalLink className="w-4 h-4" />
                        {att.filename}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => handleEntered(bill)}
                  disabled={processingId === bill.id}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-2 px-4 rounded flex items-center justify-center gap-2"
                >
                  {processingId === bill.id ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Mark as Entered
                    </>
                  )}
                </button>
                <button
                  onClick={() =>
                    window.open(
                      `https://app.frontapp.com/conversations/${bill.front_conversation_id}`,
                      "_blank"
                    )
                  }
                  className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded"
                >
                  View in Front
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
