'use client';

import Sidebar from './Sidebar';

export default function AppLayout({ children }) {
  return (
    <div className="min-h-screen bg-slate-100">
      <Sidebar />
      <main className="ml-16 min-h-screen">
        {children}
      </main>
    </div>
  );
}
