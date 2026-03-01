'use client';

/**
 * Billing Dashboard Page
 * Route: /dashboard/billing
 * Displays tape feed of pending bills with "Entered" action
 */

import React, { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";

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

const statusColors = {
  pending: "bg-yellow-100 text-yellow-800",
  entered: "bg-green-100 text-green-800",
  skipped: "bg-gray-100 text-gray-800",
  error: "bg-red-100 text-red-800",
};

export default function BillingDashboard() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<number | null>(null);

  // Fetch pending bills
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

    // Poll for updates every 10 seconds (until we have proper subscriptions)
    const interval = setInterval(fetchBills, 10000);
    return () => clearInterval(interval);
  }, []);

  // Handle "Entered" button click
  const handleEntered = async (bill: Bill) => {
    setProcessingId(bill.id);

    try {
      // Call API handler which calls Supabase Edge Function
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

      // Update UI
      setBills((prev) =>
        prev.filter((b) => b.id !== bill.id)
      );
    } catch (error) {
      console.error("Error marking bill as entered:", error);
      alert(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setProcessingId(null);
    }
  };

  // Parse attachments
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
          <Skeleton key={i} className="h-32" />
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
        <Card>
          <CardContent className="pt-6 text-center text-gray-500">
            No pending bills. All caught up! ✓
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {bills.map((bill) => (
            <Card key={bill.id} className="border-l-4 border-l-yellow-400">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-xl">
                      {bill.vendor_name}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {bill.front_email_from} • {new Date(bill.created_at).toLocaleDateString()}
                    </CardDescription>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold">${bill.amount.toFixed(2)}</div>
                    <Badge className={statusColors[bill.status]}>
                      {bill.status}
                    </Badge>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Bill details grid */}
                <div className="grid grid-cols-2 gap-4 text-sm">
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
                  <div>
                    <span className="text-gray-500">Email Subject</span>
                    <p className="line-clamp-2">{bill.front_email_subject}</p>
                  </div>
                </div>

                {/* Attachments */}
                {getAttachments(bill.attachments_json).length > 0 && (
                  <div>
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

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => handleEntered(bill)}
                    disabled={processingId === bill.id}
                    className="flex-1 gap-2"
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
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      window.open(`https://app.frontapp.com/conversations/${bill.front_conversation_id}`, "_blank")
                    }
                  >
                    View in Front
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
