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
          // Fetch app user data - use maybeSingle() to avoid error when no row found
          let { data: appUserData, error: fetchError } = await supabaseBrowser
            .from('app_users')
            .select('*')
            .eq('email', session.user.email)
            .maybeSingle();
          
          if (fetchError) {
            console.error('Error fetching app_user:', fetchError);
          }
          
          // Auto-create app_user for new Google OAuth users with @appreciate.io email
          if (!appUserData && session.user.email?.endsWith('@appreciate.io')) {
            const userName = session.user.user_metadata?.full_name || 
                            session.user.user_metadata?.name || 
                            session.user.email.split('@')[0];
            
            const { data: newUser, error: createError } = await supabaseBrowser
              .from('app_users')
              .insert({
                email: session.user.email,
                name: userName,
                role: 'user',
                is_active: true,
                auth_user_id: session.user.id
              })
              .select()
              .single();
            
            if (!createError && newUser) {
              appUserData = newUser;
              console.log('Created new app_user for:', session.user.email);
            } else if (createError) {
              console.error('Error creating app_user:', createError);
            }
          }
          
          setAppUser(appUserData);
        }
      } catch (error) {
        console.error('Session check error:', error);
      } finally {
        setLoading(false);
      }
    };

    checkSession();

    // Timeout fallback - if still loading after 5 seconds, set loading to false
    const timeout = setTimeout(() => {
      if (loading) {
        console.warn('Auth check timed out, setting loading to false');
        setLoading(false);
      }
    }, 5000);

    // Listen for auth changes
    const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          setUser(session.user);
          // Fetch app user data - use maybeSingle() to avoid error when no row found
          let { data: appUserData, error: fetchError } = await supabaseBrowser
            .from('app_users')
            .select('*')
            .eq('email', session.user.email)
            .maybeSingle();
          
          if (fetchError) {
            console.error('Error fetching app_user:', fetchError);
          }
          
          // Auto-create app_user for new Google OAuth users with @appreciate.io email
          if (!appUserData && session.user.email?.endsWith('@appreciate.io')) {
            const userName = session.user.user_metadata?.full_name || 
                            session.user.user_metadata?.name || 
                            session.user.email.split('@')[0];
            
            const { data: newUser, error: createError } = await supabaseBrowser
              .from('app_users')
              .insert({
                email: session.user.email,
                name: userName,
                role: 'user',
                is_active: true,
                auth_user_id: session.user.id
              })
              .select()
              .single();
            
            if (!createError && newUser) {
              appUserData = newUser;
              console.log('Created new app_user for:', session.user.email);
            } else if (createError) {
              console.error('Failed to create app_user:', createError);
            }
          }
          
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
      clearTimeout(timeout);
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
    try {
      console.log('Signing out...');
      await supabaseBrowser.auth.signOut();
      setUser(null);
      setAppUser(null);
      router.push('/login');
    } catch (error) {
      console.error('Sign out error:', error);
      // Force redirect even if signOut fails
      setUser(null);
      setAppUser(null);
      router.push('/login');
    }
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
