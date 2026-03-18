import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'public-anon-key';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.warn('Supabase env vars are missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
}

// Client for browser/client-side operations and server-side API routes
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Admin client for server-side operations requiring elevated access
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (typeof window === 'undefined' && !supabaseServiceKey) {
  console.error('CRITICAL: SUPABASE_SERVICE_ROLE_KEY is not set. Admin operations will fail.');
}
export const supabaseAdmin = supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

// Lazy-loading helper (for contexts where module-level init is problematic)
export function getSupabaseClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for server-side operations');
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey);
}
