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
  
  // TEMPORARILY DISABLED: Auth loading/check - allow access without login
  // Combine auth user and app user data for sidebar (use defaults if no user)
  const sidebarUser = {
    email: user?.email || 'guest@appreciate.io',
    name: appUser?.name || user?.user_metadata?.name || 'Guest',
    role: appUser?.role || 'admin'
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
