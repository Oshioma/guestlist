// ADD TO THE ARCHIVE — member contributions (moderated).

import { redirect } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { ContributeForm } from '@/components/archive/ContributeForm';

export const dynamic = 'force-dynamic';

export default async function ArchiveAddPage() {
  const member = await getCurrentMember();
  if (!member) redirect('/login?next=/archive/add');
  return (
    <main className="wrap archiveWrap" style={{ maxWidth: 720 }}>
      <h1 className="pageTitle">Add to the archive</h1>
      <p className="pageStandfirst">
        A flyer in a shoebox, a night nobody wrote down — this is how the
        culture keeps its memory. Three quick questions, we do the rest.
      </p>
      <ContributeForm />
    </main>
  );
}
