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
    const handleCallback = async () => {
      try {
        // Get the hash fragment from the URL
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        const type = hashParams.get('type');

        if (accessToken && refreshToken) {
          // Set the session
          const { error: sessionError } = await supabaseBrowser.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          });

          if (sessionError) throw sessionError;

          // Check if this is an invite/recovery - user needs to set password
          if (type === 'invite' || type === 'recovery') {
            setStatus('Redirecting to set password...');
            router.push('/auth/set-password');
          } else {
            setStatus('Login successful! Redirecting...');
            router.push('/');
          }
        } else {
          // Try to get session from URL params (for email confirmation)
          const { data, error: exchangeError } = await supabaseBrowser.auth.exchangeCodeForSession(
            window.location.search
          );

          if (exchangeError) {
            // Check if already logged in
            const { data: { session } } = await supabaseBrowser.auth.getSession();
            if (session) {
              router.push('/');
              return;
            }
            throw exchangeError;
          }

          if (data?.session) {
            setStatus('Login successful! Redirecting...');
            router.push('/');
          }
        }
      } catch (err) {
        console.error('Auth callback error:', err);
        setError(err.message);
      }
    };

    handleCallback();
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
