import { NextResponse } from "next/server";
import { supabase } from '../../../../../lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeCorporate = searchParams.get('include_corporate') === 'true';

    const { data, error } = await supabase.rpc('get_brex_expenses_with_match', {
      include_corporate: includeCorporate,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching brex expenses:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
