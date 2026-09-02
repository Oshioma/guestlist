// The page a confirmation link lands on. It does the work on arrival rather
// than making somebody press a button they did not ask for — they already
// pressed the button, it was in their inbox.

import { Suspense } from 'react';
import { VerifyPanel } from '@/components/auth/VerifyPanel';

export const metadata = { title: 'Confirm your email — Guestlist', robots: { index: false, follow: false } };

export default function VerifyPage() {
  return (
    <main className="wrap">
      <Suspense fallback={<div className="formCard"><h1>Confirming…</h1></div>}>
        <VerifyPanel />
      </Suspense>
    </main>
  );
}
