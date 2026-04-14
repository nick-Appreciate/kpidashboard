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

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body className={inter.className}>
        <AppLayout>{children}</AppLayout>
      </body>
    </html>
  );
}
