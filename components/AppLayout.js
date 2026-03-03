'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Sidebar from './Sidebar';
import { AuthProvider, useAuth } from '../contexts/AuthContext';

const Particles = dynamic(() => import('./reactbits/Particles'), { ssr: false });

function LayoutContent({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, appUser, loading, signOut } = useAuth();
  const [isDesktop, setIsDesktop] = useState(false);

  // Don't show sidebar on auth pages
  const authPages = ['/login', '/auth/callback', '/auth/reset-password', '/auth/set-password'];
  const isAuthPage = authPages.includes(pathname);

  useEffect(() => {
    setIsDesktop(window.innerWidth >= 1024);
    const handleResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Redirect to login if not authenticated (after loading completes)
  useEffect(() => {
    if (!loading && !user && !isAuthPage) {
      router.push('/login');
    }
  }, [loading, user, isAuthPage, router]);

  // Show auth pages without auth check
  if (isAuthPage) {
    return <>{children}</>;
  }

  // Show loading state while checking auth OR if not authenticated (waiting for redirect)
  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent"></div>
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
    <div className="min-h-screen">
      <Sidebar user={sidebarUser} onLogout={signOut} />
      <main className="ml-12 min-h-screen relative">
        {/* Ambient particle background — desktop only */}
        {isDesktop && (
          <div className="fixed inset-0 ml-12 pointer-events-none -z-10">
            <Particles count={40} color="#06b6d4" speed={0.2} opacity={0.08} size={1} />
          </div>
        )}
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
