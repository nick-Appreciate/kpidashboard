'use client';

import { SWRConfig } from 'swr';
import { supabaseBrowser } from './supabase-browser';

/**
 * Global SWR fetcher — handles JSON responses and errors.
 * Includes Supabase auth token in all API requests.
 */
export const fetcher = async (url) => {
  const headers = {};
  try {
    const { data: { session } } = await supabaseBrowser.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
  } catch {
    // If session retrieval fails, proceed without auth header
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const error = new Error(`HTTP error! status: ${res.status}`);
    error.status = res.status;
    throw error;
  }
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return data;
};

/**
 * Multi-key fetcher — fetches multiple URLs in parallel and returns an array of results.
 * Usage: useSWR([url1, url2, ...], multiFetcher)
 */
export const multiFetcher = (...urls) => Promise.all(urls.map(fetcher));

/**
 * Global SWR configuration defaults.
 * - dedupingInterval: 30s — deduplicate identical requests within this window
 * - revalidateOnFocus: true — refresh when user tabs back to the app
 * - revalidateOnReconnect: true — refresh after network reconnect
 * - keepPreviousData: true — show stale data while revalidating (prevents flash)
 * - errorRetryCount: 2 — retry failed requests twice
 */
export const swrConfig = {
  fetcher,
  dedupingInterval: 30000,
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  keepPreviousData: true,
  errorRetryCount: 2,
  // Cache persists across page navigations since SWRConfig is in the layout
};

/**
 * SWR Provider wrapper — mount this in the root layout so the cache is shared
 * across all pages and survives client-side navigation.
 */
export function SWRProvider({ children }) {
  return <SWRConfig value={swrConfig}>{children}</SWRConfig>;
}
