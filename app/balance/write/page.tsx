import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireMember } from '@/lib/auth';
import { createDraft, getAuthorArticle, listAuthorArticles } from '@/lib/articles';
import { ArticleEditor } from '@/components/balance/ArticleEditor';

export const dynamic='force-dynamic';
export const metadata={title:'Write an article · Guestlist'};

export default async function WritePage({searchParams}:{searchParams:Promise<{id?:string;section?:string}>}){
  let me; try{me=await requireMember();}catch{redirect('/login?next=/articles/new');}
  const {id,section}=await searchParams;
  const chosenSection=section==='events'?'events':'balance';
  if(!id){const d=await createDraft(me.id,chosenSection);if(!d)throw new Error('Editorial section is not configured');redirect(`/balance/write?id=${d.id}`);}
  const [article,all]=await Promise.all([getAuthorArticle(id,me.id),listAuthorArticles(me.id)]); if(!article)redirect('/articles/new');
  return <main className="wrap"><div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center',paddingTop:24}}><Link href="/articles/new" className="btnGhost">← Add article</Link><span style={{fontSize:12,color:'var(--text-muted)'}}>{article.section_name}</span><span style={{fontSize:12,color:'var(--text-muted)'}}>Your articles:</span>{all.slice(0,6).map(x=><Link key={x.id} href={`/balance/write?id=${x.id}`} style={{fontSize:12,color:x.id===article.id?'var(--accent-ink)':'var(--text-muted)'}}>{x.title||'Untitled'} · {x.status.replace('_',' ')}</Link>)}<Link href={`/balance/write?section=${article.section_slug}`} className="btnGhost">+ New {article.section_slug==='events'?'event article':'Balance article'}</Link></div><ArticleEditor initial={article}/></main>;
}
