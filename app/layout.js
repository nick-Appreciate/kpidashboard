import { Inter } from 'next/font/google';
import './globals.css';
import AppLayout from '../components/AppLayout';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
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
    <html lang="en" className={inter.variable}>
      <body className={inter.className}>
        <AppLayout>{children}</AppLayout>
      </body>
    </html>
  );
}
