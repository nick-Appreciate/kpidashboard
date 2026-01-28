import './globals.css';

export const metadata = {
  title: 'Inquiry Dashboard',
  description: 'Guest Card Inquiries Analytics',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
