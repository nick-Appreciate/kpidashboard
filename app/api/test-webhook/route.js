import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const body = await request.text();
    console.log('=== WEBHOOK RECEIVED ===');
    console.log('Headers:', Object.fromEntries(request.headers.entries()));
    console.log('Body:', body);
    console.log('Content-Type:', request.headers.get('content-type'));
    
    // Try to parse as JSON
    try {
      const jsonBody = JSON.parse(body);
      console.log('Parsed JSON:', jsonBody);
    } catch (e) {
      console.log('Not JSON, raw body length:', body.length);
    }
    
    return NextResponse.json({ 
      success: true, 
      message: 'Webhook received',
      timestamp: new Date().toISOString(),
      bodyLength: body.length
    });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request) {
  return NextResponse.json({ 
    message: 'Webhook endpoint is active',
    timestamp: new Date().toISOString()
  });
}
