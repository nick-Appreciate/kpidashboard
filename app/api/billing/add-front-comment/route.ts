import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

interface MarkBillEnteredRequest {
  billId: number;
  conversationId: string;
  vendorName: string;
  amount: number;
  invoiceDate: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: MarkBillEnteredRequest = await request.json();
    const { billId, conversationId, vendorName, amount, invoiceDate } = body;

    if (!billId || !conversationId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: "Supabase configuration missing" },
        { status: 500 }
      );
    }

    const response = await fetch(
      `${supabaseUrl}/functions/v1/mark-bill-entered`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          billId,
          conversationId,
          vendorName,
          amount,
          invoiceDate,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("Edge Function error:", error);
      return NextResponse.json(
        { error: `Failed to mark bill as entered: ${error}` },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
