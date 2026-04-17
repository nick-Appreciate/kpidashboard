import { Inter, Fraunces } from 'next/font/google';
import './globals.css';
import AppLayout from '../components/AppLayout';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

// Fraunces is the display serif on the public site (appreciate.io). The admin
// The admin dashboard keeps Inter for everything.
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  axes: ['SOFT', 'opsz'],
});

export const metadata = {
  title: 'Appreciate Dashboard',
  description: 'Property Management Analytics',
  icons: {
    icon: '/icon.png',
    apple: '/apple-icon.png',
  },
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 5,
    userScalable: true,
  },
};

// Resolve the Supabase origin at build time so we can prefetch DNS and warm
// the TLS connection before any user click triggers an OAuth redirect.
// Mitigates intermittent DNS_PROBE_FINISHED_NXDOMAIN errors some networks see
// on the random-looking *.supabase.co subdomain when the browser has never
// resolved it in the current session.
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <head>
        {supabaseOrigin && (
          <>
            <link rel="dns-prefetch" href={supabaseOrigin} />
            <link rel="preconnect" href={supabaseOrigin} crossOrigin="" />
          </>
        )}
      </head>
      <body className={inter.className}>
        <AppLayout>{children}</AppLayout>
      </body>
    </html>
  );
}
