'use client';

import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabaseBrowser } from '../lib/supabase-browser';

const AuthContext = createContext(null);

// Helper to fetch/create app_user - wrapped in try-catch to never block auth
async function getOrCreateAppUser(session) {
  if (!session?.user) return null;
  
  const email = session.user.email;
  
  try {
    // Fetch existing app_user
    let { data: appUserData, error: fetchError } = await supabaseBrowser
      .from('app_users')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    
    if (fetchError) {
      console.error('Error fetching app_user:', fetchError);
      return null;
    }
    
    // Auto-create for @appreciate.io emails
    if (!appUserData && email?.endsWith('@appreciate.io')) {
      const userName = session.user.user_metadata?.full_name || 
                      session.user.user_metadata?.name || 
                      email.split('@')[0];
      
      const { data: newUser, error: insertError } = await supabaseBrowser
        .from('app_users')
        .insert({
          email: email,
          name: userName,
          role: 'user',
          is_active: true,
          auth_user_id: session.user.id
        })
        .select()
        .single();
      
      if (insertError) {
        console.error('Error creating app_user:', insertError);
        // Don't block - user can still use the app without app_user record
      } else if (newUser) {
        appUserData = newUser;
      }
    }
    
    return appUserData;
  } catch (error) {
    console.error('getOrCreateAppUser error:', error);
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [appUser, setAppUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const initialCheckDone = useRef(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Only run initial check once
    if (initialCheckDone.current) return;
    initialCheckDone.current = true;

    const initAuth = async () => {
      try {
        const { data: { session } } = await supabaseBrowser.auth.getSession();
        
        if (session?.user) {
          setUser(session.user);
          setLoading(false); // Set loading false immediately once we have a user
          
          // Fetch app_user in background - don't block
          getOrCreateAppUser(session).then(appUserData => {
            setAppUser(appUserData);
          }).catch(err => {
            console.error('Error fetching app_user:', err);
          });
        } else {
          setLoading(false);
        }
      } catch (error) {
        console.error('Auth init error:', error);
        setLoading(false);
      }
    };

    initAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange(
      (event, session) => {
        if (session?.user) {
          setUser(session.user);
          setLoading(false);
          // Fetch app_user in background - don't block
          getOrCreateAppUser(session).then(appUserData => {
            setAppUser(appUserData);
          }).catch(err => {
            console.error('Error fetching app_user:', err);
          });
        } else {
          setUser(null);
          setAppUser(null);
          setLoading(false);
        }
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

  const signOut = () => {
    console.log('Signing out...');
    setUser(null);
    setAppUser(null);
    
    // Fire and forget - don't wait for signOut to complete
    supabaseBrowser.auth.signOut().catch(err => console.error('Sign out error:', err));
    
    // Force redirect immediately using window.location
    window.location.href = '/login';
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
