import { NextResponse } from "next/server";
import { supabase } from '../../../../lib/supabase';

export async function GET() {
  try {
    const { data, error } = await supabase.rpc('get_bills_with_af_match');

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching bills:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
