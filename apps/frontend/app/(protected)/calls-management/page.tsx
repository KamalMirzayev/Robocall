import { redirect } from 'next/navigation';

export default function CallsManagementRedirectPage() {
  // Backward-compatible alias for older bookmarks/menu links.
  redirect('/calls');
}
