import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { getCurrentMember } from '@/lib/auth';
import { eventsForArticle, getArticleBySlug, getPublishedArticle, recordArticleView, relatedArticles, tagSlug, type Article } from '@/lib/articles';
import { getPrivacy } from '@/lib/privacy';
import { SITE_URL, articleSchema, isoDate, jsonLd, pageMeta } from '@/lib/seo';
import { ArticleGrid } from '@/components/balance/ArticleGrid';
import { fmtDate, fmtEventDate } from '@/lib/util';
import { requestIp } from '@/lib/botCheck';
import { ArticleOwnerActions } from '@/components/balance/ArticleOwnerActions';
import { AdminItemActions } from '@/components/admin/AdminItemActions';
import { ShareRow } from '@/components/ShareRow';
import { ArticleBody, YouTubePlayer } from '@/components/balance/ArticleBody';
import { heroVideo } from '@/lib/articleBody';
import styles from '../balance.module.css';

export const dynamic='force-dynamic';

// The writer's member page, when there is one anybody can open. A profile set
// to private 404s for everyone but its owner, so linking a byline (or the
// structured data's author) to it would be a dead link — and would point at a
// profile the writer chose to keep out of view. The piece still names them.
async function authorPath(a: Pick<Article, 'author_id' | 'author_slug'>): Promise<string | null> {
  if (!a.author_slug) return null;
  const privacy = await getPrivacy(a.author_id).catch(() => null);
  return privacy?.profile_public ? `/members/${a.author_slug}` : null;
}

// Each piece is its own page to a search engine and in a link preview: its
// headline, its standfirst, its picture as an absolute URL (a relative one is
// silently dropped by most preview scrapers), and one canonical however many
// tracking parameters a share adds. The title template in app/layout.tsx adds
// "· Guestlist", so it is not repeated here.
export async function generateMetadata({params}:{params:Promise<{slug:string}>}):Promise<Metadata>{
  const {slug}=await params;const a=await getPublishedArticle(slug);
  if(!a)return {title:'Preview',robots:{index:false,follow:false}};
  return pageMeta({
    title:`${a.title} · ${a.section_name}`,
    description:a.excerpt||a.subtitle,
    path:`/balance/${a.slug}`,
    image:a.hero_image_url,
    type:'article',
    publishedTime:isoDate(a.published_at),
    modifiedTime:isoDate(a.updated_at),
    authors:[a.author_name],
  });
}

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
  // A read, if it is one: not the writer, not a link-preview fetcher, and one
  // person once per half hour (the rules live in recordArticleView).
  if(!preview){const h=await headers();await recordArticleView(a,{memberId:member?.id||null,ip:requestIp(h),userAgent:h.get('user-agent')}).catch(()=>undefined);}
  // What to read next, and the article in the vocabulary a search engine
  // reads — both only once it is published: a preview has no public address
  // to describe, and suggesting reading under a draft is noise.
  const [writerPath,related]=await Promise.all([authorPath(a),preview?Promise.resolve([]):relatedArticles(a,3).catch(()=>[])]);
  const schema=preview?null:articleSchema({...a,author_url:writerPath?`${SITE_URL}${writerPath}`:null});
  // The byline goes to the writer's page, to the list of everything else
  // they have written there.
  const author=writerPath?<Link href={`${writerPath}#writing`}>{a.author_name}</Link>:a.author_name;
  // An Event Feature's kicker goes to the Event Features, not to Balance —
  // a page that does not list it.
  const sectionHref=a.section_slug==='events'?'/features':'/balance';
  const isOwner=member?.id===a.author_id;
  // Stock libraries require the photographer AND the library to be credited
  // with a link back, so the credit line names both rather than printing the
  // provider as a bare word.
  const isUnsplash=a.image_provider==='unsplash';
  const isPexels=a.image_provider==='pexels';
  // A video chosen as the hero plays right there at the top of the piece.
  const video=heroVideo(a);
  // The byline date is London's. The server runs on UTC, so a piece that went
  // out at half past midnight on a summer night was dated the day before.
  return <main>{schema&&<script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(schema)}}/>}<article className={styles.article}><div className={styles.articleHead}>{preview&&<div className="articlePreviewNote">Preview · {a.status.replace('_',' ')} — only you{member?.role==='admin'?' and the editors':' and the editorial team'} can see this. <Link href={member?.role==='admin'&&member.id!==a.author_id?`/admin/articles/${a.id}`:`/balance/write?id=${a.id}`}>Back to editing</Link></div>}<Link href={sectionHref} className={styles.kicker}>{a.section_name}</Link><h1 className={styles.articleTitle}>{a.title}</h1>{a.subtitle&&<p className={styles.subtitle}>{a.subtitle}</p>}<div className={styles.byline}>{a.author_avatar_url?<img className={styles.avatar} src={a.author_avatar_url} alt=""/>:<span className={styles.avatar}/>}<span>By {author} · {a.reading_minutes} min read{a.published_at?` · ${fmtDate(a.published_at,'Europe/London',{day:'numeric',month:'long',year:'numeric'})}`:''}</span></div>{isOwner&&<ArticleOwnerActions articleId={a.id}/>}{member?.role==='admin'&&!isOwner&&<AdminItemActions noun="article" name={a.title} editHref={`/admin/articles/${a.id}`} deleteUrl={`/api/admin/articles/${a.id}`} afterDelete="/balance"/>}</div>{video?<YouTubePlayer id={video.id} start={video.start} className="articleVideo articleHeroVideo"/>:a.hero_image_url&&<><div className={styles.articleHero}><img src={a.hero_image_url} alt={a.hero_image_alt||''}/></div>{a.image_credit&&<div className={styles.credit}>Photo by {a.image_source_url?<a href={a.image_source_url} target="_blank" rel="noreferrer">{a.image_credit}</a>:a.image_credit}{isUnsplash&&<> on <a href="https://unsplash.com/?utm_source=guestlist&utm_medium=referral" target="_blank" rel="noreferrer">Unsplash</a></>}{isPexels&&<> on <a href="https://www.pexels.com/" target="_blank" rel="noreferrer">Pexels</a></>}{!isUnsplash&&!isPexels&&a.image_provider?` · ${a.image_provider}`:''}</div>}</>}<ArticleBody body={a.body} className={styles.body} skipVideoId={video?.id}/>{linkedEvents.length>0&&<section className="linkedEvents"><div className="sectionLabel">Events in this piece</div><div className="linkedEventList">{linkedEvents.map(e=><Link key={e.id} href={`/events/${e.slug}`} className="linkedEventCard">{e.primary_image_url?<img src={e.primary_image_url} alt=""/>:<span className="linkedEventNoImage"/>}<span><strong>{e.title}</strong><span className="linkedEventMeta">{`${fmtEventDate(e.start_at,e.end_at,e.timezone)}${e.city?` · ${e.city}`:''}`}</span></span></Link>)}</div></section>}{a.tags.length>0&&<div className={styles.tags}>{a.tags.map(t=>{const ts=tagSlug(t);return ts?<Link className={styles.tag} key={t} href={`/balance/tag/${encodeURIComponent(ts)}`}>{t}</Link>:<span className={styles.tag} key={t}>{t}</span>;})}</div>}
    {/* The last thing under a piece somebody has just finished reading. The
        standfirst travels with it, so the link arrives saying what it is. */}
    {!preview&&<ShareRow url={`${SITE_URL}/balance/${a.slug}`} title={a.title}
              blurb={a.excerpt||a.subtitle||undefined} label="Share this piece"/>}
    {related.length>0&&<section className={styles.related}><div className={styles.relatedLabel}>Read next</div><ArticleGrid articles={related} showSection/></section>}
  </article></main>;
}
