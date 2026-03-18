import { NextResponse } from "next/server";
import { requireAdmin } from '../../../../../lib/auth';

/**
 * GET /api/admin/brex/receipt?receipt_id=xxx
 *
 * Proxies receipt image download from the Brex API.
 * Used to display receipt images inline in the Brex Expenses dashboard.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;

    const { searchParams } = new URL(request.url);
    const receiptId = searchParams.get('receipt_id');

    if (!receiptId) {
      return NextResponse.json({ error: "receipt_id is required" }, { status: 400 });
    }

    const brexApiToken = process.env.BREX_API_KEY;
    if (!brexApiToken) {
      return NextResponse.json({ error: "BREX_API_KEY not configured" }, { status: 500 });
    }

    // Fetch receipt download URI from Brex API
    const receiptRes = await fetch(
      `https://platform.brexapis.com/v2/expenses/card/receipt_match/${receiptId}`,
      {
        headers: {
          'Authorization': `Bearer ${brexApiToken}`,
        },
      }
    );

    if (!receiptRes.ok) {
      // Try alternative endpoint: direct receipt URI
      const altRes = await fetch(
        `https://platform.brexapis.com/v2/expenses/card/receipts/${receiptId}/download`,
        {
          headers: {
            'Authorization': `Bearer ${brexApiToken}`,
          },
        }
      );

      if (!altRes.ok) {
        return NextResponse.json(
          { error: `Failed to fetch receipt: ${altRes.status}` },
          { status: altRes.status }
        );
      }

      // Return the image directly
      const imageData = await altRes.arrayBuffer();
      const contentType = altRes.headers.get('content-type') || 'image/jpeg';
      return new NextResponse(imageData, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    const receiptData = await receiptRes.json();
    const downloadUri = receiptData.download_uri || receiptData.uri;

    if (!downloadUri) {
      return NextResponse.json({ error: "No download URI found" }, { status: 404 });
    }

    // Fetch the actual image
    const imageRes = await fetch(downloadUri);
    if (!imageRes.ok) {
      return NextResponse.json(
        { error: `Failed to download receipt image: ${imageRes.status}` },
        { status: imageRes.status }
      );
    }

    const imageData = await imageRes.arrayBuffer();
    const contentType = imageRes.headers.get('content-type') || 'image/jpeg';

    return new NextResponse(imageData, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error("Error fetching receipt:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
