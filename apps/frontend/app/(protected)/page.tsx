import { redirect } from 'next/navigation';

// The home page is the call analytics dashboard.
export default function DashboardPage() {
  redirect('/analytics');
}
