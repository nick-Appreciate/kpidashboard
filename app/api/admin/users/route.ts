import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/users
 * Returns all users from app_users ordered by name.
 */
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;
  try {
    const { data: users, error } = await supabase
      .from("app_users")
      .select("id, email, name, role, is_active, auth_user_id, created_at, updated_at")
      .order("name", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ users: users || [] });
  } catch (err) {
    console.error("Error fetching users:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/users
 * Creates a new user in app_users.
 * Body: { email: string, name: string, role?: string }
 */
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;
  try {
    const body = await request.json();
    const { email, name, role } = body;

    if (!email || !name) {
      return NextResponse.json(
        { error: "email and name are required" },
        { status: 400 }
      );
    }

    // Check for duplicate email
    const { data: existing } = await supabase
      .from("app_users")
      .select("id")
      .eq("email", email.toLowerCase().trim())
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: "A user with this email already exists" },
        { status: 409 }
      );
    }

    const { data: user, error } = await supabase
      .from("app_users")
      .insert({
        email: email.toLowerCase().trim(),
        name: name.trim(),
        role: role || "user",
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ user });
  } catch (err) {
    console.error("Error creating user:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/users
 * Updates a user in app_users.
 * Body: { id: string, name?: string, role?: string, is_active?: boolean }
 */
export async function PATCH(request: Request) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const supabase = auth.supabase;
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    // Only allow specific fields
    const allowed: Record<string, unknown> = {};
    if (updates.name !== undefined) allowed.name = updates.name.trim();
    if (updates.role !== undefined) allowed.role = updates.role;
    if (updates.is_active !== undefined) allowed.is_active = updates.is_active;
    allowed.updated_at = new Date().toISOString();

    const { data: user, error } = await supabase
      .from("app_users")
      .update(allowed)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ user });
  } catch (err) {
    console.error("Error updating user:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
