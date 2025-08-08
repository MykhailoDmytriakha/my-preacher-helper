import { redirect } from 'next/navigation';

export default function SermonsIndexRedirect() {
  // Keep a single canonical list page at /dashboard
  redirect('/dashboard');
}


