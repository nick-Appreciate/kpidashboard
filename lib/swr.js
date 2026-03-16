'use client';

import { SWRConfig } from 'swr';

/**
 * Global SWR fetcher — handles JSON responses and errors.
 */
export const fetcher = async (url) => {
  const res = await fetch(url);
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
