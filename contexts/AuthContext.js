'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabaseBrowser } from '../lib/supabase-browser';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [appUser, setAppUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Check current session
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabaseBrowser.auth.getSession();
        
        if (session?.user) {
          setUser(session.user);
          // Fetch app user data
          const { data: appUserData } = await supabaseBrowser
            .from('app_users')
            .select('*')
            .eq('email', session.user.email)
            .single();
          setAppUser(appUserData);
        }
      } catch (error) {
        console.error('Session check error:', error);
      } finally {
        setLoading(false);
      }
    };

    checkSession();

    // Listen for auth changes
    const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          setUser(session.user);
          // Fetch app user data
          const { data: appUserData } = await supabaseBrowser
            .from('app_users')
            .select('*')
            .eq('email', session.user.email)
            .single();
          setAppUser(appUserData);
        } else {
          setUser(null);
          setAppUser(null);
        }
        setLoading(false);
      }
    );

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    // Redirect to login if not authenticated (except on auth pages)
    const authPages = ['/login', '/auth/callback', '/auth/reset-password', '/auth/set-password'];
    if (!loading && !user && !authPages.includes(pathname)) {
      router.push('/login');
    }
  }, [user, loading, pathname, router]);

  const signIn = async (email, password) => {
    const { data, error } = await supabaseBrowser.auth.signInWithPassword({
      email,
      password
    });
    if (error) throw error;
    return data;
  };

  const signOut = async () => {
    await supabaseBrowser.auth.signOut();
    setUser(null);
    setAppUser(null);
    router.push('/login');
  };

  const resetPassword = async (email) => {
    const { error } = await supabaseBrowser.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`
    });
    if (error) throw error;
  };

  const updatePassword = async (newPassword) => {
    const { error } = await supabaseBrowser.auth.updateUser({
      password: newPassword
    });
    if (error) throw error;
  };

  const isAdmin = appUser?.role === 'admin';

  return (
    <AuthContext.Provider value={{ 
      user, 
      appUser,
      signIn, 
      signOut, 
      resetPassword,
      updatePassword,
      loading, 
      isAdmin 
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
