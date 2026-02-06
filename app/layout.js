import './globals.css';
import AppLayout from '../components/AppLayout';

export const metadata = {
  title: 'Appreciate Dashboard',
  description: 'Property Management Analytics',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AppLayout>{children}</AppLayout>
      </body>
    </html>
  );
}
