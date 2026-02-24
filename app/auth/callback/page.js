'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '../../../lib/supabase-browser';
import Logo from '../../../components/Logo';

export default function AuthCallbackPage() {
  const [status, setStatus] = useState('Processing...');
  const [error, setError] = useState(null);
  const router = useRouter();

  useEffect(() => {
    let isMounted = true;

    const handleCallback = async () => {
      try {
        // Small delay to let Supabase Auth initialize properly
        await new Promise(resolve => setTimeout(resolve, 200));

        // Check for OAuth code in URL params (PKCE flow)
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');

        // Get the hash fragment from the URL (implicit flow)
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        const type = hashParams.get('type');

        console.log('Auth callback - code:', !!code, 'accessToken:', !!accessToken);

        if (code) {
          // OAuth PKCE flow - exchange code for session
          const { data, error: exchangeError } = await supabaseBrowser.auth.exchangeCodeForSession(code);

          if (exchangeError) {
            // Ignore abort errors - they're usually race conditions
            if (exchangeError.message?.includes('aborted')) {
              // Check if we have a session anyway
              const { data: { session } } = await supabaseBrowser.auth.getSession();
              if (session) {
                if (isMounted) {
                  // Validate email domain
                  const email = session.user?.email?.toLowerCase() || '';
                  if (session.user?.app_metadata?.provider === 'google' && !email.endsWith('@appreciate.io')) {
                    await supabaseBrowser.auth.signOut();
                    setError('Only @appreciate.io email addresses are allowed. Please sign in with your company email.');
                    return;
                  }
                  setStatus('Login successful! Redirecting...');
                  router.push('/');
                }
                return;
              }
            }
            throw exchangeError;
          }

          if (data?.session && isMounted) {
            // Validate email domain for OAuth logins
            const user = data.session.user;
            if (user?.app_metadata?.provider === 'google') {
              const email = user.email?.toLowerCase() || '';
              if (!email.endsWith('@appreciate.io')) {
                await supabaseBrowser.auth.signOut();
                setError('Only @appreciate.io email addresses are allowed. Please sign in with your company email.');
                return;
              }
            }
            
            setStatus('Login successful! Redirecting...');
            router.push('/');
          }
        } else if (accessToken && refreshToken) {
          // Legacy hash-based flow
          const { error: sessionError } = await supabaseBrowser.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          });

          if (sessionError) throw sessionError;

          const { data: { user } } = await supabaseBrowser.auth.getUser();
          
          if (user?.app_metadata?.provider === 'google') {
            const email = user.email?.toLowerCase() || '';
            if (!email.endsWith('@appreciate.io')) {
              await supabaseBrowser.auth.signOut();
              if (isMounted) {
                setError('Only @appreciate.io email addresses are allowed. Please sign in with your company email.');
              }
              return;
            }
          }

          if (isMounted) {
            if (type === 'invite' || type === 'recovery') {
              setStatus('Redirecting to set password...');
              router.push('/auth/set-password');
            } else {
              setStatus('Login successful! Redirecting...');
              router.push('/');
            }
          }
        } else {
          // No auth params - check if already logged in
          const { data: { session } } = await supabaseBrowser.auth.getSession();
          if (session && isMounted) {
            router.push('/');
          } else if (isMounted) {
            setError('No authentication data found. Please try logging in again.');
          }
        }
      } catch (err) {
        console.error('Auth callback error:', err);
        // Ignore abort errors as they're usually race conditions
        if (err.message?.includes('aborted') && isMounted) {
          // Try to check session one more time
          const { data: { session } } = await supabaseBrowser.auth.getSession();
          if (session) {
            router.push('/');
            return;
          }
        }
        if (isMounted) {
          setError(err.message);
        }
      }
    };

    handleCallback();

    return () => {
      isMounted = false;
    };
  }, [router]);

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-8 w-full max-w-md text-center">
        <div className="flex justify-center mb-8">
          <Logo className="h-16 w-auto" />
        </div>
        
        {error ? (
          <>
            <h1 className="text-xl font-semibold text-red-600 mb-4">Authentication Error</h1>
            <p className="text-slate-600 mb-6">{error}</p>
            <button
              onClick={() => router.push('/login')}
              className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
            >
              Back to Login
            </button>
          </>
        ) : (
          <>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
            <p className="text-slate-600">{status}</p>
          </>
        )}
      </div>
    </div>
  );
}
