'use client';

import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabaseBrowser } from '../lib/supabase-browser';

const AuthContext = createContext(null);

// Set/clear a same-origin cookie with the Supabase access token.
// This ensures API routes can read the token from the cookie header
// even when the SWR fetcher's async getSession() hasn't resolved yet.
function syncAccessTokenCookie(session) {
  if (session?.access_token) {
    const maxAge = session.expires_in || 3600;
    document.cookie = `sb-access-token=${session.access_token}; path=/; max-age=${maxAge}; SameSite=Lax`;
  } else {
    document.cookie = 'sb-access-token=; path=/; max-age=0; SameSite=Lax';
  }
}

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

const DEV_BYPASS_AUTH = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === 'true';
const DEV_USER = {
  id: 'dev-user',
  email: 'dev@appreciate.io',
  user_metadata: { full_name: 'Dev User' },
};

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
      // Dev bypass - skip Supabase auth entirely
      if (DEV_BYPASS_AUTH) {
        setUser(DEV_USER);
        setAppUser({ email: DEV_USER.email, name: 'Dev User', role: 'admin', is_active: true });
        setLoading(false);
        return;
      }

      try {
        // Step 1: read the cached session from localStorage (no network call).
        // This used to run AFTER getUser(), which meant a transient network
        // failure on boot (DNS blip, flaky wifi, proxy hiccup) would clear
        // the session and bounce the user through a fresh OAuth flow — which
        // is exactly where the Supabase-hostname DNS issue is most likely to
        // surface again. Reading the cache first lets us unblock the UI
        // without any network roundtrip.
        const { data: { session: cachedSession } } = await supabaseBrowser.auth.getSession();

        if (!cachedSession) {
          // Genuinely no session in storage — normal unauthenticated state.
          setUser(null);
          setAppUser(null);
          setLoading(false);
          return;
        }

        // Step 2: optimistically trust the cached session and unblock the UI.
        setUser(cachedSession.user);
        setLoading(false);
        syncAccessTokenCookie(cachedSession);

        // Step 3: fetch app_user in background — don't block rendering.
        getOrCreateAppUser(cachedSession).then(appUserData => {
          setAppUser(appUserData);
        }).catch(err => {
          console.error('Error fetching app_user:', err);
        });

        // Step 4: verify the session is still valid on the server, in the
        // background. We only clear session on definitive auth failures
        // (401/403 from the server). Network errors, aborts, and timeouts
        // preserve the optimistic session — autoRefreshToken and
        // onAuthStateChange handle real expiry/invalidation.
        supabaseBrowser.auth.getUser().then(({ data: { user: verifiedUser }, error }) => {
          if (error) {
            const status = error.status ?? 0;
            const isDefinitiveAuthFailure = status === 401 || status === 403;
            if (isDefinitiveAuthFailure) {
              supabaseBrowser.auth.signOut().catch(() => {});
              setUser(null);
              setAppUser(null);
              syncAccessTokenCookie(null);
            }
            // Otherwise: probable transient network issue. Keep the session;
            // the SDK will auto-refresh or onAuthStateChange will fire if
            // anything genuinely changes.
            return;
          }
          if (verifiedUser) {
            setUser(verifiedUser);
          }
        }).catch(() => {
          // Swallow — almost always a network/abort error. Keep cached session.
        });
      } catch (error) {
        console.error('Auth init error:', error);
        setLoading(false);
      }
    };

    initAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange(
      (event, session) => {
        syncAccessTokenCookie(session);
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
    // Path-based admin gate. Public paths render without auth; admin paths
    // (anything not in the public list) bounce unauthenticated visitors to
    // /login. After login, the auth callback returns them to /dashboard.
    const authPages = ['/login', '/auth/callback', '/auth/reset-password', '/auth/set-password'];
    const isPublic =
      pathname === '/' || // middleware redirects this to /listings; defensive
      pathname === '/privacy' ||
      pathname === '/terms' ||
      authPages.includes(pathname) ||
      pathname?.startsWith('/listings');
    if (!loading && !user && !isPublic) {
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
    syncAccessTokenCookie(null);
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
