import { redirect } from 'next/navigation';

export default function SourcePerformancePage() {
  redirect('/admin/leasing?tab=sources');
}
