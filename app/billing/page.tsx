import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Billing / AP - Appreciate Dashboard',
  description: 'Billing and accounts payable management',
};

export default function BillingPage() {
  redirect('/bookkeeping');
}
