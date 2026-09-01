import { query, queryOne } from './db';

export type Article = {
  id:string; section_slug:string; section_name:string; author_id:string; author_name:string; author_slug:string|null; author_avatar_url:string|null;
  slug:string; title:string; subtitle:string|null; excerpt:string|null; body:string; article_type:string; status:string;
  hero_image_url:string|null; hero_image_alt:string|null; image_provider:string|null; image_credit:string|null; image_source_url:string|null;
  tags:string[]; reading_minutes:number; featured:boolean; admin_note:string|null; submitted_at:string|null; published_at:string|null;
  created_at:string; updated_at:string; view_count:number;
};

const SELECT = `select a.*, s.slug section_slug, s.name section_name,
  m.display_name author_name, m.slug author_slug, m.avatar_url author_avatar_url,
  (select count(*)::int from article_views v where v.article_id=a.id) view_count
  from articles a join editorial_sections s on s.id=a.section_id join members m on m.id=a.author_id`;

export function articleSlug(title:string) {
  const base=title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70) || 'article';
  return `${base}-${Math.random().toString(36).slice(2,7)}`;
}
export function readingMinutes(body:string){return Math.max(1,Math.ceil(body.trim().split(/\s+/).filter(Boolean).length/220));}
export function excerptFrom(body:string){return body.replace(/[#*_>`~\[\]]/g,'').replace(/\s+/g,' ').trim().slice(0,220);}

export async function listPublishedArticles(section='balance', limit=20):Promise<Article[]> {
  return query<Article>(`${SELECT} where s.slug=$1 and a.status='published' order by a.featured desc, a.published_at desc nulls last limit $2`,[section,limit]);
}
export async function getPublishedArticle(slug:string):Promise<Article|null>{return queryOne<Article>(`${SELECT} where a.slug=$1 and a.status='published'`,[slug]);}
export async function listAuthorArticles(authorId:string):Promise<Article[]>{return query<Article>(`${SELECT} where a.author_id=$1 order by a.updated_at desc`,[authorId]);}
export async function getAuthorArticle(id:string,authorId:string):Promise<Article|null>{return queryOne<Article>(`${SELECT} where a.id=$1 and a.author_id=$2`,[id,authorId]);}
export async function listAdminArticles():Promise<Article[]>{return query<Article>(`${SELECT} order by case a.status when 'submitted' then 0 when 'changes_requested' then 1 when 'approved' then 2 when 'published' then 3 else 4 end, a.updated_at desc limit 200`);}

export async function createDraft(authorId:string) {
  return queryOne<{id:string;slug:string}>(`insert into articles(section_id,author_id,slug) select id,$1,$2 from editorial_sections where slug='balance' returning id,slug`,[authorId,articleSlug('draft')]);
}

export type ArticlePatch={title?:string;subtitle?:string|null;excerpt?:string|null;body?:string;article_type?:string;hero_image_url?:string|null;hero_image_alt?:string|null;image_provider?:string|null;image_credit?:string|null;image_source_url?:string|null;tags?:string[]};
const TYPES=new Set(['story','opinion','guide','interview','reflection','photo-essay','list']);
function normalizedPatch(current:Article,p:ArticlePatch){
  const body=p.body??current.body; const type=TYPES.has(p.article_type||'')?p.article_type!:current.article_type;
  return {title:(p.title??current.title).trim().slice(0,180),subtitle:(p.subtitle??current.subtitle)?.trim().slice(0,260)||null,excerpt:(p.excerpt??current.excerpt??excerptFrom(body))?.trim().slice(0,300)||null,body:body.slice(0,120000),article_type:type,hero_image_url:(p.hero_image_url??current.hero_image_url)?.trim()||null,hero_image_alt:(p.hero_image_alt??current.hero_image_alt)?.trim().slice(0,300)||null,image_provider:(p.image_provider??current.image_provider)?.trim().slice(0,40)||null,image_credit:(p.image_credit??current.image_credit)?.trim().slice(0,200)||null,image_source_url:(p.image_source_url??current.image_source_url)?.trim()||null,tags:(p.tags??current.tags).map(x=>x.trim().toLowerCase()).filter(Boolean).slice(0,8),reading_minutes:readingMinutes(body)};
}
async function snapshot(a:Article,editorId:string){await query(`insert into article_revisions(article_id,editor_id,title,subtitle,excerpt,body,hero_image_url,tags,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[a.id,editorId,a.title,a.subtitle,a.excerpt,a.body,a.hero_image_url,a.tags,a.status]);}

export async function updateDraft(id:string,authorId:string,p:ArticlePatch){
  const current=await getAuthorArticle(id,authorId); if(!current) return null;
  if(['archived','rejected'].includes(current.status)) throw new Error('This article can no longer be edited');
  await snapshot(current,authorId); const x=normalizedPatch(current,p);
  await query(`update articles set title=$3, subtitle=$4, excerpt=$5, body=$6, article_type=$7, hero_image_url=$8, hero_image_alt=$9, image_provider=$10, image_credit=$11, image_source_url=$12, tags=$13, reading_minutes=$14, updated_at=now() where id=$1 and author_id=$2`,[id,authorId,x.title,x.subtitle,x.excerpt,x.body,x.article_type,x.hero_image_url,x.hero_image_alt,x.image_provider,x.image_credit,x.image_source_url,x.tags,x.reading_minutes]);
  return getAuthorArticle(id,authorId);
}
export async function deleteAuthorArticle(id:string,authorId:string){
  const current=await getAuthorArticle(id,authorId); if(!current)return false;
  await query(`delete from articles where id=$1 and author_id=$2`,[id,authorId]);
  return true;
}
export async function submitArticle(id:string,authorId:string){
  const a=await getAuthorArticle(id,authorId); if(!a) return null;
  if(!['draft','changes_requested'].includes(a.status)) throw new Error('Article is not editable');
  if(a.title.trim().length<8) throw new Error('Add a clear title');
  if(a.body.trim().split(/\s+/).length<80) throw new Error('Article must be at least 80 words');
  if(!a.hero_image_url) throw new Error('Every article needs a hero image');
  await query(`update articles set slug=$3,status='submitted',submitted_at=now(),admin_note=null,updated_at=now() where id=$1 and author_id=$2`,[id,authorId,articleSlug(a.title)]);
  return getAuthorArticle(id,authorId);
}
export async function recordArticleView(articleId:string,memberId:string|null){await query(`insert into article_views(article_id,member_id) values($1,$2)`,[articleId,memberId]);}

export async function adminEditArticle(id:string,adminId:string,p:ArticlePatch){
  const current=await queryOne<Article>(`${SELECT} where a.id=$1`,[id]); if(!current)return null;
  await snapshot(current,adminId); const x=normalizedPatch(current,p);
  await query(`update articles set title=$2,subtitle=$3,excerpt=$4,body=$5,article_type=$6,hero_image_url=$7,hero_image_alt=$8,image_provider=$9,image_credit=$10,image_source_url=$11,tags=$12,reading_minutes=$13,updated_at=now() where id=$1`,[id,x.title,x.subtitle,x.excerpt,x.body,x.article_type,x.hero_image_url,x.hero_image_alt,x.image_provider,x.image_credit,x.image_source_url,x.tags,x.reading_minutes]);
  return queryOne<Article>(`${SELECT} where a.id=$1`,[id]);
}
export async function adminReviewArticle(id:string,adminId:string,action:'request_changes'|'approve'|'publish'|'reject'|'archive'|'feature',note?:string,featured?:boolean){
  const a=await queryOne<Article>(`${SELECT} where a.id=$1`,[id]); if(!a) return null; await snapshot(a,adminId);
  if(action==='feature'){await query(`update articles set featured=$2,updated_at=now() where id=$1`,[id,!!featured]);}
  else if(action==='request_changes') await query(`update articles set status='changes_requested',admin_note=$2,updated_at=now() where id=$1`,[id,note||'Please make the requested changes.']);
  else if(action==='approve') await query(`update articles set status='approved',approved_at=now(),admin_note=$2,updated_at=now() where id=$1`,[id,note||null]);
  else if(action==='publish') { if(!a.hero_image_url) throw new Error('Article needs a hero image before publishing'); await query(`update articles set status='published',approved_at=coalesce(approved_at,now()),published_at=coalesce(published_at,now()),admin_note=$2,updated_at=now() where id=$1`,[id,note||null]); }
  else if(action==='reject') await query(`update articles set status='rejected',admin_note=$2,updated_at=now() where id=$1`,[id,note||null]);
  else if(action==='archive') await query(`update articles set status='archived',featured=false,admin_note=$2,updated_at=now() where id=$1`,[id,note||null]);
  return queryOne<Article>(`${SELECT} where a.id=$1`,[id]);
}
