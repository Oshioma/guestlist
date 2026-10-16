import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAdminArticle } from '@/lib/articles';
import { ArticleEditor } from '@/components/balance/ArticleEditor';

// The writer's editor, opened by the desk: hero upload, video as the hero,
// pictures and videos in the body, preview, event links — everything a writer
// has. The admin layout already keeps non-admins out.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit article · Admin · Guestlist' };

export default async function AdminArticleEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const article = await getAdminArticle(id);
  if (!article) notFound();
  return (
    <>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', paddingTop: 16 }}>
        <Link href="/admin/articles" className="btnGhost">← All articles</Link>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{article.section_name} · by {article.author_name} · {article.status.replace('_', ' ')}</span>
        {article.status === 'published' && <Link href={`/balance/${article.slug}`} className="btnGhost">View live</Link>}
      </div>
      <ArticleEditor initial={article} admin />
    </>
  );
}
