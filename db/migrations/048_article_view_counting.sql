-- Article views that mean somebody read the piece.
--
-- Every render of /balance/<slug> used to be a row in article_views: the
-- writer re-reading their own piece, WhatsApp fetching a link preview, a
-- crawler, and the same person refreshing ten times. The number on the
-- editorial desk was mostly noise. lib/articles.ts (recordArticleView) now
-- skips the author and obvious bots, and counts one viewer once per half
-- hour. To know "the same viewer" without storing who they are, each view
-- carries a salted hash — of the member id when signed in, of address +
-- browser otherwise. Never the address itself.
alter table article_views add column if not exists viewer_hash text;
create index if not exists article_views_viewer_idx
  on article_views(article_id, viewer_hash, viewed_at desc)
  where viewer_hash is not null;

-- And the count itself, kept on the article. Every list of articles used to
-- count article_views for each row it returned; the desk lists 200 at a time.
-- recordArticleView adds one here in the same statement that records the view.
alter table articles add column if not exists view_count integer not null default 0;
update articles a
   set view_count = v.n
  from (select article_id, count(*)::int n from article_views group by article_id) v
 where v.article_id = a.id;
