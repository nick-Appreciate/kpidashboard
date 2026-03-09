import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Brex Expenses - Appreciate Dashboard',
  description: 'Brex expense reconciliation and matching',
};

export default function BrexPage() {
  redirect('/bookkeeping');
}
