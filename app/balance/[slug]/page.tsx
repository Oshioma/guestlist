import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { eventsForArticle, getArticleBySlug, getPublishedArticle, recordArticleView } from '@/lib/articles';
import { fmtEventDate } from '@/lib/util';
import { ArticleOwnerActions } from '@/components/balance/ArticleOwnerActions';
import { AdminItemActions } from '@/components/admin/AdminItemActions';
import { ShareRow } from '@/components/ShareRow';
import { ArticleBody, YouTubePlayer } from '@/components/balance/ArticleBody';
import { heroVideo } from '@/lib/articleBody';
import styles from '../balance.module.css';

const SITE = process.env.SITE_URL ?? 'https://www.guestlist.net';
export const dynamic='force-dynamic';
export async function generateMetadata({params}:{params:Promise<{slug:string}>}):Promise<Metadata>{const {slug}=await params;const a=await getPublishedArticle(slug);if(!a)return {title:'Preview · Guestlist',robots:{index:false,follow:false}};return {title:`${a.title} · ${a.section_name} · Guestlist`,description:a.excerpt||a.subtitle||undefined,openGraph:{title:a.title,description:a.excerpt||a.subtitle||undefined,images:a.hero_image_url?[a.hero_image_url]:undefined,type:'article',publishedTime:a.published_at||undefined,authors:[a.author_name]}};}

export default async function ArticlePage({params}:{params:Promise<{slug:string}>}){
  const {slug}=await params; const [published,member]=await Promise.all([getPublishedArticle(slug),getCurrentMember()]);
  // Not published yet: its writer and the editors still see it here, exactly as
  // it will look, so Save can always land on the article. Everyone else gets
  // the same 404 as for a page that doesn't exist.
  let a=published; const preview=!published;
  if(!a&&member){const any=await getArticleBySlug(slug);if(any&&(any.author_id===member.id||member.role==='admin'))a=any;}
  if(!a)notFound();
  // Nights this piece is about. A linked event that is not live yet stays
  // hidden: an article should never be the thing that leaks an unpublished event.
  const linkedEvents=(await eventsForArticle(a.id)).filter(e=>e.status==='live');
  if(!preview)await recordArticleView(a.id,member?.id||null).catch(()=>undefined);
  const author=a.author_slug?<Link href={`/members/${a.author_slug}`}>{a.author_name}</Link>:a.author_name;
  const isOwner=member?.id===a.author_id;
  // Stock libraries require the photographer AND the library to be credited
  // with a link back, so the credit line names both rather than printing the
  // provider as a bare word.
  const isUnsplash=a.image_provider==='unsplash';
  const isPexels=a.image_provider==='pexels';
  // A video chosen as the hero plays right there at the top of the piece.
  const video=heroVideo(a);
  return <main><article className={styles.article}><div className={styles.articleHead}>{preview&&<div className="articlePreviewNote">Preview · {a.status.replace('_',' ')} — only you{member?.role==='admin'?' and the editors':' and the editorial team'} can see this. <Link href={member?.role==='admin'&&member.id!==a.author_id?`/admin/articles/${a.id}`:`/balance/write?id=${a.id}`}>Back to editing</Link></div>}<Link href="/balance" className={styles.kicker}>{a.section_name}</Link><h1 className={styles.articleTitle}>{a.title}</h1>{a.subtitle&&<p className={styles.subtitle}>{a.subtitle}</p>}<div className={styles.byline}>{a.author_avatar_url?<img className={styles.avatar} src={a.author_avatar_url} alt=""/>:<span className={styles.avatar}/>}<span>By {author} · {a.reading_minutes} min read{a.published_at?` · ${new Date(a.published_at).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}`:''}</span></div>{isOwner&&<ArticleOwnerActions articleId={a.id}/>}{member?.role==='admin'&&!isOwner&&<AdminItemActions noun="article" name={a.title} editHref={`/admin/articles/${a.id}`} deleteUrl={`/api/admin/articles/${a.id}`} afterDelete="/balance"/>}</div>{video?<YouTubePlayer id={video.id} start={video.start} className="articleVideo articleHeroVideo"/>:a.hero_image_url&&<><div className={styles.articleHero}><img src={a.hero_image_url} alt={a.hero_image_alt||''}/></div>{a.image_credit&&<div className={styles.credit}>Photo by {a.image_source_url?<a href={a.image_source_url} target="_blank" rel="noreferrer">{a.image_credit}</a>:a.image_credit}{isUnsplash&&<> on <a href="https://unsplash.com/?utm_source=guestlist&utm_medium=referral" target="_blank" rel="noreferrer">Unsplash</a></>}{isPexels&&<> on <a href="https://www.pexels.com/" target="_blank" rel="noreferrer">Pexels</a></>}{!isUnsplash&&!isPexels&&a.image_provider?` · ${a.image_provider}`:''}</div>}</>}<ArticleBody body={a.body} className={styles.body} skipVideoId={video?.id}/>{linkedEvents.length>0&&<section className="linkedEvents"><div className="sectionLabel">Events in this piece</div><div className="linkedEventList">{linkedEvents.map(e=><Link key={e.id} href={`/events/${e.slug}`} className="linkedEventCard">{e.primary_image_url?<img src={e.primary_image_url} alt=""/>:<span className="linkedEventNoImage"/>}<span><strong>{e.title}</strong><span className="linkedEventMeta">{`${fmtEventDate(e.start_at,e.end_at,e.timezone)}${e.city?` · ${e.city}`:''}`}</span></span></Link>)}</div></section>}{a.tags.length>0&&<div className={styles.tags}>{a.tags.map(t=><span className={styles.tag} key={t}>{t}</span>)}</div>}
    {/* The last thing under a piece somebody has just finished reading. The
        standfirst travels with it, so the link arrives saying what it is. */}
    {!preview&&<ShareRow url={`${SITE}/balance/${a.slug}`} title={a.title}
              blurb={a.excerpt||a.subtitle||undefined} label="Share this piece"/>}
  </article></main>;
}
