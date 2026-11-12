import { redirect } from 'next/navigation';

// Renamed to Leasing Automations; keep old links and bookmarks working
// (including the query string, e.g. ?q=<phone> from Slack alerts).
export default function SpeedToLeadRedirect({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams || {})) if (typeof v === 'string') q.set(k, v);
  redirect(`/leasing/automations${q.toString() ? `?${q}` : ''}`);
}
