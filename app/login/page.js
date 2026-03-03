'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import dynamic from 'next/dynamic';
import Logo from '../../components/Logo';
import AnimatedText from '../../components/reactbits/AnimatedText';

const Aurora = dynamic(() => import('../../components/reactbits/Aurora'), { ssr: false });

// Create a standalone Supabase client for login page
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function LoginPage() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleGoogleLogin = async () => {
    setError('');
    setLoading(true);

    try {
      const { data, error: googleError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: {
            hd: 'appreciate.io' // Restrict to appreciate.io domain in Google's UI
          }
        }
      });

      if (googleError) {
        setError(googleError.message);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Ambient aurora background */}
      <div className="fixed inset-0 -z-10">
        <Aurora color1="#06b6d4" color2="#8b5cf6" color3="#06b6d4" speed={0.8} opacity={0.2} />
      </div>

      <div className="glass-card p-8 w-full max-w-md animate-fade-in-up opacity-0">
        <div className="flex justify-center mb-8">
          <Logo variant="white" className="h-16 w-auto" />
        </div>

        <AnimatedText
          text="Welcome Back"
          tag="h1"
          className="text-2xl font-semibold text-slate-100 text-center mb-2"
          delay={60}
          animateBy="words"
        />
        <p className="text-slate-400 text-center mb-8 animate-fade-in opacity-0 stagger-2">
          Sign in with your Appreciate account
        </p>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-300 text-sm mb-4">
            {error}
          </div>
        )}

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full py-3 bg-surface-overlay border border-[var(--glass-border)] text-slate-200 rounded-lg hover:bg-surface-overlay/80 hover:border-[var(--glass-border-hover)] transition-all duration-200 disabled:opacity-50 font-medium flex items-center justify-center gap-3 active:scale-[0.98]"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {loading ? 'Connecting...' : 'Continue with Google'}
        </button>

        <p className="text-xs text-slate-500 text-center mt-4">
          Only @appreciate.io emails are allowed
        </p>

        <p className="text-xs text-slate-600 text-center mt-8">
          Contact an administrator if you need access
        </p>
      </div>
    </div>
  );
}
