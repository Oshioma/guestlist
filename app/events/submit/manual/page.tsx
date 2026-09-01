import { ManualEventSubmissionForm } from '@/components/ManualEventSubmissionForm';

export const metadata = { title: 'Add an event manually · Guestlist' };

export default async function ManualEventSubmissionPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string; importError?: string }>;
}) {
  const params = await searchParams;
  const initialUrl = typeof params.url === 'string' ? params.url : '';
  const importError = typeof params.importError === 'string' ? params.importError : '';

  return (
    <main className="wrap" style={{ maxWidth: 760, paddingTop: 48, paddingBottom: 72 }}>
      <div className="homeKicker">ADD AN EVENT</div>
      <h1>Add it manually</h1>
      <p className="adminSub" style={{ maxWidth: 650 }}>
        {importError
          ? `We couldn’t read that page automatically (${importError}). Add the key details below and it will go into the same Guestlist review queue.`
          : 'Add the key details below and it will go into the Guestlist review queue.'}
      </p>
      <ManualEventSubmissionForm initialUrl={initialUrl} importError={importError} />
    </main>
  );
}
