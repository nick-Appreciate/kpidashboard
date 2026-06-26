import { redirect } from 'next/navigation';

export default function PublishingPage() {
  redirect('/admin/leasing?tab=publishing');
}
