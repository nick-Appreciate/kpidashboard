import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Anon client for token verification — auth.getUser() doesn't need
// elevated privileges, just a valid apikey.
const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);

interface AppUser {
  id: string;
  email: string;
  role: string;
  name: string | null;
}

interface AuthSuccess {
  user: { id: string; email: string };
  appUser: AppUser;
  supabase: SupabaseClient;
}

interface AuthFailure {
  error: NextResponse;
}

type AuthResult = AuthSuccess | AuthFailure;

function extractToken(request: Request): string | null {
  // Try Authorization header first
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Fallback: read our custom sb-access-token cookie (set by AuthContext)
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    if (cookie.startsWith('sb-access-token=')) {
      const value = cookie.split('=').slice(1).join('=');
      if (value) return value;
    }
  }

  // Fallback: parse Supabase native auth cookie (sb-<ref>-auth-token)
  for (const cookie of cookies) {
    if (cookie.startsWith('sb-') && cookie.includes('-auth-token=')) {
      const value = cookie.split('=').slice(1).join('=');
      try {
        const decoded = JSON.parse(decodeURIComponent(value));
        if (Array.isArray(decoded) && decoded[0]) {
          return decoded[0];
        }
        if (decoded?.access_token) {
          return decoded.access_token;
        }
      } catch {
        // Not valid JSON, skip
      }
    }
  }

  return null;
}

/**
 * Create a Supabase client authenticated as the given user.
 * Queries made with this client respect RLS policies for the
 * 'authenticated' role — the user's JWT is passed as Authorization.
 */
function createUserClient(token: string): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/**
 * Verify the request comes from an authenticated user.
 * Returns the Supabase auth user, app_users record, and an
 * authenticated Supabase client that routes can use for queries.
 */
export async function requireAuth(request: Request): Promise<AuthResult> {
  const token = extractToken(request);
  if (!token) {
    return {
      error: NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      ),
    };
  }

  // Verify the JWT with Supabase Auth
  const {
    data: { user },
    error: authError,
  } = await supabaseAuth.auth.getUser(token);

  if (authError || !user) {
    return {
      error: NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      ),
    };
  }

  // Create an authenticated client for this request
  const supabaseUser = createUserClient(token);

  const { data: appUser, error: dbError } = await supabaseUser
    .from('app_users')
    .select('id, email, role, name')
    .eq('email', user.email)
    .single();

  if (dbError || !appUser) {
    return {
      error: NextResponse.json(
        { error: 'User not found in application' },
        { status: 403 }
      ),
    };
  }

  return {
    user: { id: user.id, email: user.email! },
    appUser,
    supabase: supabaseUser,
  };
}

/**
 * Verify the request comes from an authenticated admin user.
 * Checks both JWT validity and app_users.role = 'admin'.
 */
export async function requireAdmin(request: Request): Promise<AuthResult> {
  const result = await requireAuth(request);
  if ('error' in result) return result;

  if (result.appUser.role !== 'admin') {
    return {
      error: NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      ),
    };
  }

  return result;
}

/**
 * Type guard to check if auth result is an error.
 */
export function isAuthError(result: AuthResult): result is AuthFailure {
  return 'error' in result;
}
