'use client';

import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import { AuthProvider, useAuth } from '../contexts/AuthContext';

function LayoutContent({ children }) {
  const pathname = usePathname();
  const { user, appUser, loading, signOut } = useAuth();
  
  // Don't show sidebar on auth pages
  const authPages = ['/login', '/auth/callback', '/auth/reset-password', '/auth/set-password'];
  if (authPages.includes(pathname)) {
    return <>{children}</>;
  }
  
  // Show loading state while checking auth
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  // Combine auth user and app user data for sidebar
  const sidebarUser = {
    email: user?.email || '',
    name: appUser?.name || user?.user_metadata?.name || user?.email?.split('@')[0] || '',
    role: appUser?.role || 'user'
  };
  
  return (
    <div className="min-h-screen bg-slate-100">
      <Sidebar user={sidebarUser} onLogout={signOut} />
      <main className="ml-16 min-h-screen">
        {children}
      </main>
    </div>
  );
}

export default function AppLayout({ children }) {
  return (
    <AuthProvider>
      <LayoutContent>{children}</LayoutContent>
    </AuthProvider>
  );
}
