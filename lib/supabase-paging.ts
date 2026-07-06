/**
 * fetchAllRows — page through a Supabase query in 1000-row chunks.
 *
 * PostgREST (what supabase-js talks to) enforces a server-side max-rows
 * cap — Supabase's managed default is 1000. `.range(0, 49999)` requests
 * the full range but the server silently truncates the response at the
 * cap, so any row past position 1000 is invisible to the client.
 *
 * That silent truncation caused a bug on Speed to Lead where 346 of the
 * 1,346 justcall_calls rows in a 30-day window were being dropped, so
 * ~26% of recent calls (including today's) never made it onto the
 * timeline. Every route reading > 1000 rows from a table had the same
 * latent bug.
 *
 * Usage:
 *   const { data, error } = await fetchAllRows(() =>
 *     supabase.from('justcall_calls')
 *       .select('call_sid, contact_number_norm, direction, call_at')
 *       .gte('call_at', sinceIso)
 *   );
 *
 * The builder callback returns a Supabase query BEFORE .range() — this
 * helper appends the range per page.
 */
export async function fetchAllRows<T = any>(
  build: () => any,
  pageSize = 1000,
): Promise<{ data: T[]; error: any }> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) return { data: out, error };
    const batch = (data || []) as T[];
    out.push(...batch);
    if (batch.length < pageSize) break;
  }
  return { data: out, error: null };
}
