'use client';

import useSWR from 'swr';
import DcPage from '../../components/arcade/DcPage';

// Appreciate Arcade. Deliberately not in the sidebar: reached by direct link.
export default function ArcadePage() {
  const { data, error } = useSWR('/api/arcade', {
    // The page keeps game state in memory; a refetch would rebuild it and reset that.
    revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false,
  });
  if (error) return <div className="p-8 text-red-400">Couldn't load the arcade: {error.message}</div>;
  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0b0820' }}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent"></div>
      </div>
    );
  }
  return <DcPage page={data.page} />;
}
