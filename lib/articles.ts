import { createHmac } from 'node:crypto';
import { query, queryOne, transaction } from './db';
import { notifyAdminsArticleEdited, notifyAdminsNewArticle } from './adminNotify';
import { audit } from './audit';
import { bodyText, parseBody, wordCount } from './articleBody';

export type Article = {
  id:string; section_slug:string; section_name:string; author_id:string; author_name:string; author_slug:string|null; author_avatar_url:string|null;
  slug:string; title:string; subtitle:string|null; excerpt:string|null; body:string; article_type:string; status:string;
  hero_image_url:string|null; hero_image_alt:string|null; image_provider:string|null; image_credit:string|null; image_source_url:string|null;
  tags:string[]; reading_minutes:number; featured:boolean; admin_note:string|null; submitted_at:string|null; published_at:string|null;
  created_at:string; updated_at:string; view_count:number;
};

// view_count comes with a.* — it is kept on the article by recordArticleView
// (migration 048) rather than counted from article_views for every row of
// every list.
const SELECT = `select a.*, s.slug section_slug, s.name section_name,
  m.display_name author_name, m.slug author_slug, m.avatar_url author_avatar_url
  from articles a join editorial_sections s on s.id=a.section_id join members m on m.id=a.author_id`;

export function articleSlug(title:string) {
  const base=title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70) || 'article';
  return `${base}-${Math.random().toString(36).slice(2,7)}`;
}
// A draft is created with a placeholder address (draft-xxxxx). Its first
// submit gives it a real one, from the title — and from then on it keeps it,
// so a link shared before a round of changes still works after it.
export function slugForSubmit(currentSlug:string, title:string){
  return /^draft-[a-z0-9]+$/.test(currentSlug) ? articleSlug(title) : currentSlug;
}
// Pictures and videos are not words: they count for neither reading time nor
// the 80-word minimum, and never end up in an excerpt.
export function readingMinutes(body:string){return Math.max(1,Math.ceil(wordCount(body)/220));}
export function excerptFrom(body:string){return bodyText(body).replace(/[#*_>`~\[\]]/g,'').replace(/\s+/g,' ').trim().slice(0,220);}

export async function listPublishedArticles(section='balance', limit=20):Promise<Article[]> {
  return query<Article>(`${SELECT} where s.slug=$1 and a.status='published' order by a.featured desc, a.published_at desc nulls last limit $2`,[section,limit]);
}
// Any status — only for showing a writer or an editor their own unpublished piece.
export async function getArticleBySlug(slug:string):Promise<Article|null>{return queryOne<Article>(`${SELECT} where a.slug=$1`,[slug]);}
export async function getPublishedArticle(slug:string):Promise<Article|null>{return queryOne<Article>(`${SELECT} where a.slug=$1 and a.status='published'`,[slug]);}
export async function listAuthorArticles(authorId:string):Promise<Article[]>{return query<Article>(`${SELECT} where a.author_id=$1 order by a.updated_at desc`,[authorId]);}
export async function getAuthorArticle(id:string,authorId:string):Promise<Article|null>{return queryOne<Article>(`${SELECT} where a.id=$1 and a.author_id=$2`,[id,authorId]);}
export async function getAdminArticle(id:string):Promise<Article|null>{return queryOne<Article>(`${SELECT} where a.id=$1`,[id]);}
export async function listAdminArticles():Promise<Article[]>{return query<Article>(`${SELECT} order by case a.status when 'submitted' then 0 when 'changes_requested' then 1 when 'approved' then 2 when 'published' then 3 else 4 end, a.updated_at desc limit 200`);}


/**
 * Does that hero image actually load?
 *
 * "Has a hero image" was already required to submit and to publish, and a
 * piece still went out with a grey box and a broken-image icon on it: the URL
 * was there and the picture behind it was gone. A column being non-null is
 * not the same as a photograph existing.
 *
 * So the last check before something carries Guestlist's name in public is to
 * go and look. Refusing when we cannot confirm is deliberate — allowing it on
 * a failed check is exactly how the broken one shipped, and an editor who
 * sees "that image gives a 404" picks another one in ten seconds.
 */
export async function heroImageLoads(url: string): Promise<{ ok: true } | { ok: false; why: string }> {
  // A hero can legitimately be one of ours, stored as /images/whatever.jpg.
  // That is not a broken address, it is a relative one, so it is resolved
  // against the site before anybody decides it does not exist.
  const site = process.env.SITE_URL ?? 'https://www.guestlist.net';
  let parsed: URL;
  try {
    parsed = url.startsWith('/') ? new URL(url, site) : new URL(url);
  } catch {
    return { ok: false, why: 'that image address is not a valid URL' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, why: 'that image address is not http(s)' };
  }
  try {
    // HEAD first: nearly every host answers it and it costs no bandwidth.
    // Some refuse it, so a 405 falls through to a real request.
    const target = parsed.toString();
    let res = await fetch(target, { method: 'HEAD', cache: 'no-store', redirect: 'follow' });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(target, { method: 'GET', cache: 'no-store', redirect: 'follow' });
    }
    if (!res.ok) return { ok: false, why: `that image gives a ${res.status}` };
    const type = res.headers.get('content-type') ?? '';
    if (type && !type.startsWith('image/')) return { ok: false, why: `that address is ${type}, not an image` };
    return { ok: true };
  } catch {
    return { ok: false, why: 'that image could not be reached' };
  }
}

/**
 * How a picture gets looked at. Always heroImageLoads in the app; the tests
 * hand in their own so that a check on "does this image load" never depends
 * on somebody else's server being up.
 */
export type ImageCheck = (url: string) => Promise<{ ok: true } | { ok: false; why: string }>;
export type ImageCheckOpts = { checkImage?: ImageCheck };

/**
 * Every picture inside the body, checked the same way as the hero: a broken
 * one mid-article looks just as bad under Guestlist's name. Checked side by
 * side so a photo essay doesn't take a minute to submit. Null when all load.
 */
export async function brokenBodyImage(body: string, checkImage: ImageCheck = heroImageLoads): Promise<string | null> {
  const images = parseBody(body).flatMap((b) => (b.kind === 'image' ? [b] : []));
  const results = await Promise.all(images.map((b) => checkImage(b.url)));
  const i = results.findIndex((r) => !r.ok);
  if (i < 0) return null;
  const r = results[i] as { ok: false; why: string };
  const which = images[i].caption ? `"${images[i].caption.slice(0, 60)}"` : `number ${i + 1}`;
  return `picture ${which} in the article does not load — ${r.why}`;
}

export async function createDraft(authorId:string, section='balance') {
  const safeSection=section==='events'?'events':'balance';
  return queryOne<{id:string;slug:string}>(`insert into articles(section_id,author_id,slug) select id,$1,$2 from editorial_sections where slug=$3 and active=true returning id,slug`,[authorId,articleSlug('draft'),safeSection]);
}

export type ArticlePatch={title?:string;subtitle?:string|null;excerpt?:string|null;body?:string;article_type?:string;hero_image_url?:string|null;hero_image_alt?:string|null;image_provider?:string|null;image_credit?:string|null;image_source_url?:string|null;tags?:string[]};
const TYPES=new Set(['story','opinion','guide','interview','reflection','photo-essay','list']);
function normalizedPatch(current:Article,p:ArticlePatch){
  const body=p.body??current.body; const type=TYPES.has(p.article_type||'')?p.article_type!:current.article_type;
  return {title:(p.title??current.title).trim().slice(0,180),subtitle:(p.subtitle??current.subtitle)?.trim().slice(0,260)||null,excerpt:(p.excerpt??current.excerpt??excerptFrom(body))?.trim().slice(0,300)||null,body:body.slice(0,120000),article_type:type,hero_image_url:(p.hero_image_url??current.hero_image_url)?.trim()||null,hero_image_alt:(p.hero_image_alt??current.hero_image_alt)?.trim().slice(0,300)||null,image_provider:(p.image_provider??current.image_provider)?.trim().slice(0,40)||null,image_credit:(p.image_credit??current.image_credit)?.trim().slice(0,200)||null,image_source_url:(p.image_source_url??current.image_source_url)?.trim()||null,tags:(p.tags??current.tags).map(x=>x.trim().toLowerCase()).filter(Boolean).slice(0,8),reading_minutes:readingMinutes(body)};
}
/**
 * A copy of the article as it stood, before a change lands on it.
 *
 * The writer's editor autosaves every few seconds, and every autosave used to
 * write one of these — a whole copy of the body each time, so an evening's
 * writing left hundreds of near-identical rows. A history nobody can read for
 * the noise is not a history. So an autosave only writes one when the last is
 * more than ten minutes old, or when the article has moved status since (a
 * published piece now being edited deserves its own "before"). The moments
 * that matter — submit, every editorial action, an editor's own edit — always
 * write one (`always`).
 *
 * One statement, so two autosaves arriving together cannot both decide the
 * last revision is stale.
 */
export const REVISION_EVERY_MINUTES=10;
async function snapshot(a:Article,editorId:string,always=false){
  await query(
    `insert into article_revisions(article_id,editor_id,title,subtitle,excerpt,body,hero_image_url,tags,status)
     select $1,$2,$3,$4,$5,$6,$7,$8,$9
      where $10::boolean or not exists (
        select 1 from (select status,created_at from article_revisions
                        where article_id=$1 order by created_at desc,id desc limit 1) last
         where last.created_at > now() - make_interval(mins => $11) and last.status = $9)`,
    [a.id,editorId,a.title,a.subtitle,a.excerpt,a.body,a.hero_image_url,a.tags,a.status,always,REVISION_EVERY_MINUTES]);
}

export async function updateDraft(id:string,authorId:string,p:ArticlePatch){
  const current=await getAuthorArticle(id,authorId); if(!current) return null;
  if(['archived','rejected'].includes(current.status)) throw new Error('This article can no longer be edited');
  await snapshot(current,authorId); const x=normalizedPatch(current,p);
  await query(`update articles set title=$3, subtitle=$4, excerpt=$5, body=$6, article_type=$7, hero_image_url=$8, hero_image_alt=$9, image_provider=$10, image_credit=$11, image_source_url=$12, tags=$13, reading_minutes=$14, updated_at=now() where id=$1 and author_id=$2`,[id,authorId,x.title,x.subtitle,x.excerpt,x.body,x.article_type,x.hero_image_url,x.hero_image_alt,x.image_provider,x.image_credit,x.image_source_url,x.tags,x.reading_minutes]);
  // Changing a draft nobody has seen is nobody's business but the author's.
  // Changing something already published, approved, or on the editorial desk
  // is — the piece is out in the world under Guestlist's name.
  if (['submitted','approved','published'].includes(current.status)) await notifyAdminsArticleEdited(id);
  return getAuthorArticle(id,authorId);
}
export async function deleteAuthorArticle(id:string,authorId:string){
  const current=await getAuthorArticle(id,authorId); if(!current)return false;
  await query(`delete from articles where id=$1 and author_id=$2`,[id,authorId]);
  return true;
}
export async function submitArticle(id:string,authorId:string,opts:ImageCheckOpts={}){
  const checkImage=opts.checkImage??heroImageLoads;
  const a=await getAuthorArticle(id,authorId); if(!a) return null;
  if(!['draft','changes_requested'].includes(a.status)) throw new Error('Article is not editable');
  if(a.title.trim().length<8) throw new Error('Add a clear title');
  if(wordCount(a.body)<80) throw new Error('Article must be at least 80 words');
  if(!a.hero_image_url) throw new Error('Every article needs a hero image');
  const heroOk=await checkImage(a.hero_image_url);
  if(!heroOk.ok) throw new Error(`Your hero image does not load — ${heroOk.why}. Pick another one.`);
  const brokenInBody=await brokenBodyImage(a.body,checkImage);
  if(brokenInBody) throw new Error(`The ${brokenInBody}. Replace it or delete that line.`);
  // What the desk was sent, whatever the autosave throttle last kept.
  await snapshot(a,authorId,true);
  await query(`update articles set slug=$3,status='submitted',submitted_at=now(),admin_note=null,updated_at=now() where id=$1 and author_id=$2`,[id,authorId,slugForSubmit(a.slug,a.title)]);
  // The editorial desk hears about it — and the review digest is refreshed
  // inside that call, so the bell and the queue agree.
  await notifyAdminsNewArticle(id);
  return getAuthorArticle(id,authorId);
}
// --- Views -------------------------------------------------------------------
// The view count is on the editorial desk, and it is the only number a writer
// gets back for their work, so it should mean "somebody read this". Every
// render of the page used to count: the writer checking how it looks, the
// preview WhatsApp fetches when the link is shared, every crawler, and one
// person refreshing. None of those is a reader.

// Anything that fetches a page without a person behind it. Link-preview
// fetchers matter most — sharing a piece in a group chat would otherwise count
// once for every app that unfurls it. No user agent at all is a script.
const NOT_A_READER=/bot|crawl|spider|slurp|preview|facebookexternalhit|facebookcatalog|meta-externalagent|embedly|whatsapp|telegram|slack|discord|skype|linkedin|pinterest|vkshare|quora link|tumblr|outbrain|nuzzel|ia_archiver|archive\.org|headless|phantomjs|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl|wget|python|httpclient|okhttp|go-http-client|axios|node-fetch|undici|java\/|libwww|scrapy/i;
export function looksLikeBot(userAgent:string|null|undefined){return !userAgent?.trim()||NOT_A_READER.test(userAgent);}

// The same person reading twice within this is one read: a refresh, a phone
// that dropped the page, coming back from a link in the piece.
export const VIEW_DEDUPE_MINUTES=30;

// Who is reading, as something we can compare but not reverse. A member is
// their id; anyone else is their address and browser together (an office or a
// festival wifi shares one address, so the address alone would merge
// strangers). Keyed with a server secret, so the IPv4 space cannot simply be
// hashed through to undo it. The address itself is never stored.
export function viewerHash(v:{memberId?:string|null;ip?:string|null;userAgent?:string|null}){
  const who=v.memberId?`m:${v.memberId}`:`a:${v.ip??''}|${v.userAgent??''}`;
  const key=process.env.IP_HASH_SALT??process.env.SESSION_SECRET??'guestlist';
  return createHmac('sha256',key).update(who).digest('hex').slice(0,32);
}

export type ArticleViewer={memberId:string|null;ip?:string|null;userAgent?:string|null};
/**
 * Count a read, if it is one. Says whether it counted.
 *
 * The view row and the cached articles.view_count move in one statement, so
 * the number on the article cannot drift from the rows behind it. Two
 * requests from one viewer in the same instant can still both count — a lock
 * per page view would cost more than that miscount ever could.
 */
export async function recordArticleView(article:{id:string;author_id:string},viewer:ArticleViewer):Promise<boolean>{
  if(viewer.memberId&&viewer.memberId===article.author_id) return false;
  if(looksLikeBot(viewer.userAgent)) return false;
  const counted=await query<{id:string}>(
    `with seen as (
       insert into article_views(article_id,member_id,viewer_hash)
       select $1,$2,$3
        where not exists (select 1 from article_views
                           where article_id=$1 and viewer_hash=$3
                             and viewed_at > now() - make_interval(mins => $4))
       returning article_id)
     update articles set view_count=view_count+1 where id in (select article_id from seen) returning id`,
    [article.id,viewer.memberId,viewerHash(viewer),VIEW_DEDUPE_MINUTES]);
  return counted.length>0;
}

const bodyImageUrls=(body:string)=>new Set(parseBody(body).flatMap((b)=>(b.kind==='image'?[b.url]:[])));

export async function adminEditArticle(id:string,adminId:string,p:ArticlePatch,opts:ImageCheckOpts={}){
  const checkImage=opts.checkImage??heroImageLoads;
  const current=await queryOne<Article>(`${SELECT} where a.id=$1`,[id]); if(!current)return null;
  const x=normalizedPatch(current,p);
  // The same look submit and publish take. An editor's save on a live piece is
  // live the moment it lands — there is no later step to catch a hero swapped
  // for a dead link — so it is caught here. Only pictures the edit brought in
  // are fetched: fixing a typo should not wait on, or be refused over, every
  // picture that was already in the piece.
  if(x.hero_image_url!==current.hero_image_url){
    if(!x.hero_image_url){
      if(current.status!=='draft') throw new Error('Every article needs a hero image');
    } else {
      const heroOk=await checkImage(x.hero_image_url);
      if(!heroOk.ok) throw new Error(`Not saved: that hero image does not load — ${heroOk.why}. Pick another one.`);
    }
  }
  if(x.body!==current.body){
    const before=bodyImageUrls(current.body);
    const brokenInBody=await brokenBodyImage(x.body,(url)=>before.has(url)?Promise.resolve({ok:true as const}):checkImage(url));
    if(brokenInBody) throw new Error(`Not saved: the ${brokenInBody}.`);
  }
  await snapshot(current,adminId,true);
  await query(`update articles set title=$2,subtitle=$3,excerpt=$4,body=$5,article_type=$6,hero_image_url=$7,hero_image_alt=$8,image_provider=$9,image_credit=$10,image_source_url=$11,tags=$12,reading_minutes=$13,updated_at=now() where id=$1`,[id,x.title,x.subtitle,x.excerpt,x.body,x.article_type,x.hero_image_url,x.hero_image_alt,x.image_provider,x.image_credit,x.image_source_url,x.tags,x.reading_minutes]);
  return queryOne<Article>(`${SELECT} where a.id=$1`,[id]);
}
export async function adminDeleteArticle(id:string,adminId:string){
  // Admin deletion is permanent and reaches anything an author's own delete
  // would reach — views, revisions and event links all cascade. The audit row
  // is written first so the record survives the row.
  const a=await queryOne<{title:string;author_id:string}>(`select title,author_id from articles where id=$1`,[id]); if(!a)return false;
  await audit('article_deleted',{actorId:adminId,detail:{articleId:id,title:a.title,authorId:a.author_id}});
  await query(`delete from articles where id=$1`,[id]);
  return true;
}
// Publish is the end of review, not a way round it. It used to work from any
// status, so a rejected piece — or a draft nobody had submitted — was one
// click from going live. It goes out from the desk (submitted or approved);
// publishing something already live changes nothing. Anything else is told
// what has to happen first, in words the desk shows as they are.
export const PUBLISHABLE=new Set(['submitted','approved']);
const NOT_PUBLISHABLE:Record<string,string>={
  draft:'This is still a draft — the writer has not submitted it.',
  changes_requested:'This is back with the writer for changes. It can go out once they resubmit it.',
  rejected:'This article was rejected. Request changes to send it back to the writer; it can go out once they resubmit it.',
  archived:'This article was archived. Request changes to send it back to the writer; it can go out once they resubmit it.',
};
export async function adminReviewArticle(id:string,adminId:string,action:'request_changes'|'approve'|'publish'|'reject'|'archive'|'feature',note?:string,featured?:boolean,opts:ImageCheckOpts={}){
  const checkImage=opts.checkImage??heroImageLoads;
  const a=await queryOne<Article>(`${SELECT} where a.id=$1`,[id]); if(!a) return null;
  if(action==='publish'){
    if(a.status==='published') return a;
    if(!PUBLISHABLE.has(a.status)) throw new Error(`Not published. ${NOT_PUBLISHABLE[a.status]??`An article that is ${a.status.replace('_',' ')} cannot be published.`}`);
  }
  await snapshot(a,adminId,true);
  if(action==='feature'){await query(`update articles set featured=$2,updated_at=now() where id=$1`,[id,!!featured]);}
  else if(action==='request_changes') await query(`update articles set status='changes_requested',admin_note=$2,updated_at=now() where id=$1`,[id,note||'Please make the requested changes.']);
  else if(action==='approve') await query(`update articles set status='approved',approved_at=now(),admin_note=$2,updated_at=now() where id=$1`,[id,note||null]);
  else if(action==='publish') { if(!a.hero_image_url) throw new Error('Article needs a hero image before publishing');
    const heroOk=await checkImage(a.hero_image_url);
    if(!heroOk.ok) throw new Error(`Not publishing with a broken hero image — ${heroOk.why}.`);
    const brokenInBody=await brokenBodyImage(a.body,checkImage);
    if(brokenInBody) throw new Error(`Not publishing: the ${brokenInBody}.`);
    // The status rule again, in the statement itself: the image checks take a
    // moment, and a reject that lands in that moment should win.
    const done=await query(`update articles set status='published',approved_at=coalesce(approved_at,now()),published_at=coalesce(published_at,now()),admin_note=$2,updated_at=now() where id=$1 and status=any($3::text[]) returning id`,[id,note||null,[...PUBLISHABLE]]);
    if(!done.length) throw new Error('Not published — the article changed while it was being checked. Reload and try again.'); }
  else if(action==='reject') await query(`update articles set status='rejected',admin_note=$2,updated_at=now() where id=$1`,[id,note||null]);
  else if(action==='archive') await query(`update articles set status='archived',featured=false,admin_note=$2,updated_at=now() where id=$1`,[id,note||null]);
  return queryOne<Article>(`${SELECT} where a.id=$1`,[id]);
}

// --- Articles ↔ events -------------------------------------------------------
// Many-to-many on purpose: a festival preview covers several nights, and a
// night can have both a preview and a review.

export type LinkedEvent = {
  id: string; slug: string; title: string; start_at: string; end_at: string | null;
  timezone: string; city: string | null; primary_image_url: string | null; status: string;
};

export type LinkedArticle = {
  id: string; slug: string; title: string; subtitle: string | null; excerpt: string | null;
  article_type: string; hero_image_url: string | null; reading_minutes: number;
  published_at: string | null; author_name: string; section_name: string;
};

export async function eventsForArticle(articleId: string): Promise<LinkedEvent[]> {
  return query<LinkedEvent>(
    `select e.id, e.slug, e.title, e.start_at::text, e.end_at::text, e.timezone,
            e.city, e.primary_image_url, e.status
       from article_events ae join events e on e.id = ae.event_id
      where ae.article_id = $1
      order by e.start_at`,
    [articleId]
  );
}

// Only PUBLISHED articles surface on an event page — a draft about tonight is
// not something the public should discover through the event.
export async function articlesForEvent(eventId: string): Promise<LinkedArticle[]> {
  return query<LinkedArticle>(
    `select a.id, a.slug, a.title, a.subtitle, a.excerpt, a.article_type,
            a.hero_image_url, a.reading_minutes, a.published_at::text,
            m.display_name as author_name, s.name as section_name
       from article_events ae
       join articles a on a.id = ae.article_id
       join members m on m.id = a.author_id
       join editorial_sections s on s.id = a.section_id
      where ae.event_id = $1 and a.status = 'published'
      order by a.published_at desc nulls last`,
    [eventId]
  );
}

// The whole set is replaced in one go: the editor sends what the article is
// about now, not a diff, so an event removed in the UI really is unlinked.
export async function setArticleEvents(
  articleId: string, eventIds: string[], linkedBy: string | null,
  opts: { allowUnpublished?: boolean } = {}
): Promise<number> {
  const ids = [...new Set(eventIds.filter((id) => /^[0-9a-f-]{36}$/.test(id)))].slice(0, 30);
  // The same rule as the picker: a writer can only ADD a published event.
  // Links that already exist are kept as they are.
  const linkable = opts.allowUnpublished ? ['live', 'new', 'needs_review', 'rejected'] : ['live'];
  // Delete and insert together or not at all: a failure between the two used
  // to leave the article linked to nothing, which on the page looks exactly
  // like the writer having removed every event.
  await transaction(async (tx) => {
    await tx.query(
      `delete from article_events where article_id = $1 and not (event_id = any($2::uuid[]))`,
      [articleId, ids]
    );
    if (ids.length) {
      await tx.query(
        `insert into article_events (article_id, event_id, linked_by)
         select $1, e.id, $3 from events e
          where e.id = any($2::uuid[]) and e.status::text = any($4::text[])
         on conflict do nothing`,
        [articleId, ids, linkedBy, linkable]
      );
    }
  });
  return ids.length;
}

// Event picker for the editor: title search, soonest first, upcoming before
// past so tonight is not buried under a decade of archive.
//
// Writers only ever find PUBLISHED events. Anything still in New or Needs
// Review has not been approved, and a member drafting an article must not be
// able to read our review queue through the picker. Admins also see events
// waiting for review, so a feature can be linked before the event goes live.
export async function searchLinkableEvents(
  q: string, opts: { includeUnpublished?: boolean; limit?: number } = {}
): Promise<LinkedEvent[]> {
  const term = `%${q.trim().toLowerCase()}%`;
  const statuses = opts.includeUnpublished ? ['live', 'new', 'needs_review'] : ['live'];
  return query<LinkedEvent>(
    `select e.id, e.slug, e.title, e.start_at::text, e.end_at::text, e.timezone,
            e.city, e.primary_image_url, e.status
       from events e
      where lower(e.title) like $1 and e.status::text = any($3::text[])
      order by (e.start_at < now()), e.start_at
      limit $2`,
    [term, opts.limit ?? 12, statuses]
  );
}

// --- Reading the published writing -------------------------------------------
// Everything below is read-only and only ever returns PUBLISHED pieces: it is
// what the public listing, tag, author, search and feed pages are built from.
// A draft has no business turning up through a tag or a search box.

/**
 * Twenty-four to a page. It divides by the grid's three columns (and by the
 * one column on a phone), so a full page never ends on a gap, and it is few
 * enough that a page of photographs still loads quickly on a phone.
 */
export const ARTICLES_PER_PAGE = 24;

/**
 * ?page=N, read defensively. Anything that is not a whole number from 1 up —
 * "0", "-3", "abc", "2.5" — is page 1, and a crawler's ?page=99999999 is
 * capped, rather than throwing or asking Postgres for an absurd offset.
 */
export function pageFromParam(raw: string | string[] | undefined | null): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !/^\d{1,9}$/.test(v)) return 1;
  return Math.min(Math.max(1, Number(v)), 1000);
}

/**
 * A tag as it appears in an address: /balance/tag/drum-and-bass.
 *
 * Tags are stored the way the writer typed them, lowercased ("drum & bass",
 * "uk garage", "café culture"). Those are not addresses, and two writers'
 * spellings of the same thing should land on the same page — so the slug
 * folds accents, turns "&" into "and", and joins words with hyphens. Letters
 * from any script are kept: a tag written in Japanese is still a tag, and an
 * address made of nothing would be worse than an encoded one. Null when there
 * is nothing left to make an address from (a tag that was all punctuation);
 * such a tag is shown without a link.
 */
export function tagSlug(tag: string): string | null {
  const s = tag
    .normalize('NFKD').replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return s || null;
}

/**
 * Search text as an ILIKE pattern. The person's % and _ are literal
 * characters, not wildcards (the same rule as the event search in
 * lib/events.ts), so searching "100%" does not match everything. Used with
 * escape '\'.
 */
export function likePattern(q: string): string {
  return `%${q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
}

export type ArticlePage = { articles: Article[]; page: number; hasNewer: boolean; hasOlder: boolean };

/**
 * One page of published writing, filtered any of the ways the public pages
 * need: by section, by any of a set of tags, by author, or by a search.
 *
 * One more row than a page is fetched, and its presence is what "Older"
 * means — cheaper than a count(*) over the same filter, and no count is ever
 * shown.
 *
 * A section listing keeps its order — featured first, then newest — so the
 * Feature button on the editorial desk still means something. Everywhere
 * else it is newest first; a search puts title matches above body matches,
 * because the piece called "Afters" is what somebody typing "afters" wants.
 * Ties break on id, so a page boundary never shows a piece twice or skips one.
 */
export async function listPublishedPage(opts: {
  section?: string; tags?: string[]; authorId?: string; q?: string;
  page?: number; perPage?: number;
}): Promise<ArticlePage> {
  const page = Math.max(1, opts.page ?? 1);
  const perPage = opts.perPage ?? ARTICLES_PER_PAGE;
  const where = [`a.status = 'published'`];
  const params: unknown[] = [];
  const arg = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (opts.section) where.push(`s.slug = ${arg(opts.section)}`);
  // && is "shares any", which the GIN index on tags (migration 016) answers.
  if (opts.tags?.length) where.push(`a.tags && ${arg(opts.tags)}::text[]`);
  if (opts.authorId) where.push(`a.author_id = ${arg(opts.authorId)}`);
  const term = opts.q?.trim();
  let order = opts.section && !term ? `a.featured desc, a.published_at desc nulls last` : `a.published_at desc nulls last`;
  if (term) {
    const like = arg(likePattern(term));
    where.push(`(a.title ilike ${like} escape '\\' or a.subtitle ilike ${like} escape '\\'
                 or a.excerpt ilike ${like} escape '\\' or a.body ilike ${like} escape '\\')`);
    order = `(a.title ilike ${like} escape '\\') desc, ${order}`;
  }
  const rows = await query<Article>(
    `${SELECT} where ${where.join(' and ')} order by ${order}, a.id
      limit ${arg(perPage + 1)} offset ${arg((page - 1) * perPage)}`,
    params
  );
  return { articles: rows.slice(0, perPage), page, hasNewer: page > 1, hasOlder: rows.length > perPage };
}

/**
 * Which stored tags an address stands for. Several spellings can share one
 * slug ("drum & bass", "drum and bass"), and all of them belong on the page.
 *
 * The slug is not something SQL can compute the same way JS does, so this
 * reads the distinct tags in use on published pieces — a few hundred short
 * strings at most — and matches them here. The pieces themselves are then
 * fetched with tags && [...], which the GIN index answers. The label is the
 * spelling most pieces use, for the page heading.
 */
export async function tagsForSlug(slug: string): Promise<{ label: string; tags: string[] } | null> {
  const rows = await query<{ tag: string; n: number }>(
    `select t as tag, count(*)::int as n
       from articles a, unnest(a.tags) t
      where a.status = 'published'
      group by t order by count(*) desc, t`
  );
  const matching = rows.filter((r) => tagSlug(r.tag) === slug);
  if (!matching.length) return null;
  return { label: matching[0].tag, tags: matching.map((r) => r.tag) };
}

/** Every tag address with a published piece behind it, for the sitemap. */
export async function publishedTagSlugs(): Promise<string[]> {
  const rows = await query<{ tag: string }>(
    `select distinct t as tag from articles a, unnest(a.tags) t where a.status = 'published'`
  );
  return [...new Set(rows.map((r) => tagSlug(r.tag)).filter((s): s is string => !!s))];
}

/**
 * What to read next, under a piece somebody has just finished.
 *
 * The pieces sharing the most tags with this one come first, then others
 * from the same section, newest first within each — so a piece about afters
 * suggests the other pieces about afters before whatever Balance published
 * last. Never the piece itself, never anything unpublished.
 */
export async function relatedArticles(a: Pick<Article, 'id' | 'tags' | 'section_slug'>, limit = 3): Promise<Article[]> {
  return query<Article>(
    `${SELECT}
      where a.status = 'published' and a.id <> $1
        and (a.tags && $2::text[] or s.slug = $3)
      order by (select count(*) from unnest(a.tags) t where t = any($2::text[])) desc,
               (s.slug = $3) desc, a.published_at desc nulls last, a.id
      limit $4`,
    [a.id, a.tags ?? [], a.section_slug, limit]
  );
}

/** The newest published pieces across every section — what the feed carries. */
export async function latestPublishedArticles(limit = 30): Promise<Article[]> {
  return query<Article>(
    `${SELECT} where a.status = 'published' order by a.published_at desc nulls last, a.id limit $1`,
    [limit]
  );
}
