import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { eventsForArticle, getPublishedArticle, recordArticleView } from '@/lib/articles';
import { fmtEventDate } from '@/lib/util';
import { ArticleOwnerActions } from '@/components/balance/ArticleOwnerActions';
import styles from '../balance.module.css';
export const dynamic='force-dynamic';
export async function generateMetadata({params}:{params:Promise<{slug:string}>}):Promise<Metadata>{const {slug}=await params;const a=await getPublishedArticle(slug);if(!a)return {title:'Articles · Guestlist'};return {title:`${a.title} · ${a.section_name} · Guestlist`,description:a.excerpt||a.subtitle||undefined,openGraph:{title:a.title,description:a.excerpt||a.subtitle||undefined,images:a.hero_image_url?[a.hero_image_url]:undefined,type:'article',publishedTime:a.published_at||undefined,authors:[a.author_name]}};}

export default async function ArticlePage({params}:{params:Promise<{slug:string}>}){
  const {slug}=await params; const [a,member]=await Promise.all([getPublishedArticle(slug),getCurrentMember()]); if(!a)notFound();
  // Nights this piece is about. A linked event that is not live yet stays
  // hidden: an article should never be the thing that leaks an unpublished event.
  const linkedEvents=(await eventsForArticle(a.id)).filter(e=>e.status==='live');
  await recordArticleView(a.id,member?.id||null).catch(()=>undefined);
  const paragraphs=a.body.split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean);
  const author=a.author_slug?<Link href={`/members/${a.author_slug}`}>{a.author_name}</Link>:a.author_name;
  const isOwner=member?.id===a.author_id;
  // Stock libraries require the photographer AND the library to be credited
  // with a link back, so the credit line names both rather than printing the
  // provider as a bare word.
  const isUnsplash=a.image_provider==='unsplash';
  const isPexels=a.image_provider==='pexels';
  return <main><article className={styles.article}><div className={styles.articleHead}><Link href="/balance" className={styles.kicker}>{a.section_name}</Link><h1 className={styles.articleTitle}>{a.title}</h1>{a.subtitle&&<p className={styles.subtitle}>{a.subtitle}</p>}<div className={styles.byline}>{a.author_avatar_url?<img className={styles.avatar} src={a.author_avatar_url} alt=""/>:<span className={styles.avatar}/>}<span>By {author} · {a.reading_minutes} min read{a.published_at?` · ${new Date(a.published_at).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}`:''}</span></div>{isOwner&&<ArticleOwnerActions articleId={a.id}/>}</div>{a.hero_image_url&&<><div className={styles.articleHero}><img src={a.hero_image_url} alt={a.hero_image_alt||''}/></div>{a.image_credit&&<div className={styles.credit}>Photo by {a.image_source_url?<a href={a.image_source_url} target="_blank" rel="noreferrer">{a.image_credit}</a>:a.image_credit}{isUnsplash&&<> on <a href="https://unsplash.com/?utm_source=guestlist&utm_medium=referral" target="_blank" rel="noreferrer">Unsplash</a></>}{isPexels&&<> on <a href="https://www.pexels.com/" target="_blank" rel="noreferrer">Pexels</a></>}{!isUnsplash&&!isPexels&&a.image_provider?` · ${a.image_provider}`:''}</div>}</>}<div className={styles.body}>{paragraphs.map((p,i)=><p key={i}>{p}</p>)}</div>{linkedEvents.length>0&&<section className="linkedEvents"><div className="sectionLabel">Events in this piece</div><div className="linkedEventList">{linkedEvents.map(e=><Link key={e.id} href={`/events/${e.slug}`} className="linkedEventCard">{e.primary_image_url?<img src={e.primary_image_url} alt=""/>:<span className="linkedEventNoImage"/>}<span><strong>{e.title}</strong><span className="linkedEventMeta">{`${fmtEventDate(e.start_at,e.end_at,e.timezone)}${e.city?` · ${e.city}`:''}`}</span></span></Link>)}</div></section>}{a.tags.length>0&&<div className={styles.tags}>{a.tags.map(t=><span className={styles.tag} key={t}>{t}</span>)}</div>}</article></main>;
}
