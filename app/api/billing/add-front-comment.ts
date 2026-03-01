/**
 * API Handler: /api/billing/add-front-comment
 * 
 * Triggered when user clicks "Entered" on a bill
 * Adds a comment to the Front conversation
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const FRONT_API_KEY = process.env.FRONT_API_KEY;

interface AddCommentRequest {
  conversationId: string;
  messageId: string;
  vendorName: string;
  amount: number;
  invoiceDate: string;
}

export async function POST(request: NextRequest) {
  try {
    if (!FRONT_API_KEY) {
      return NextResponse.json(
        { error: "FRONT_API_KEY not configured" },
        { status: 500 }
      );
    }

    const body: AddCommentRequest = await request.json();
    const { conversationId, messageId, vendorName, amount, invoiceDate } = body;

    if (!conversationId || !vendorName || !amount) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Construct comment text
    const commentText = `✓ Entered into Appfolio
      
Vendor: ${vendorName}
Amount: $${amount.toFixed(2)}
Invoice Date: ${invoiceDate}

Bill marked as processed and removed from AP queue.`;

    // Add comment via Front API
    const response = await fetch(
      `https://api2.frontapp.com/conversations/${conversationId}/comments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${FRONT_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          author_id: "alt:email:elise@appreciate.io", // Elise as author
          body: commentText,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("Front API error:", error);
      return NextResponse.json(
        { error: `Failed to add comment: ${error}` },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("Error adding comment:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
