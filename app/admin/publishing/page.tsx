import { redirect } from 'next/navigation';

export default function PublishingPage() {
  redirect('/leasing?tab=publishing');
}
