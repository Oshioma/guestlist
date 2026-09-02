import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { getEventBySlug, getMemberAction } from '@/lib/events';
import { eventTypeLabel, fmtEventDate, fmtEventTime, formatPrice, isPast } from '@/lib/util';
import { SocialPanel } from '@/components/SocialPanel';
import { TrackView } from '@/components/TrackView';
import { ShareButton } from '@/components/ShareButton';
import { FollowButton } from '@/components/FollowButton';
import { ClaimEventPrompt } from '@/components/ClaimEventPrompt';
import { GuestlistRequest } from '@/components/GuestlistRequest';
import { isFollowing } from '@/lib/profiles';
import { getMemberPromoters } from '@/lib/promoterAuth';
import { query, queryOne } from '@/lib/db';
import { CLUB_LIMITS, PRESENCE_ACTIVE_SQL, friendPairSql, presenceVisibleSql } from '@/lib/clubmessenger';
import { eventSocialContext } from '@/lib/scene';
import { interviewsForEventArtists, youtubeTimestampUrl } from '@/lib/videoArchive';
import { articlesForEvent } from '@/lib/articles';
import { billingEnabled, formatPence, getMembership, getPlan, membershipIsActive } from '@/lib/membership';
import { eventEligible, liveRequestFor } from '@/lib/accessRequests';
import { GetMeIn } from '@/components/membership/GetMeIn';
import { AdminItemActions } from '@/components/admin/AdminItemActions';

export const dynamic = 'force-dynamic';

function clock(seconds:number){const m=Math.floor(seconds/60);const s=seconds%60;return `${m}:${String(s).padStart(2,'0')}`}

export default async function EventDetailPage({ params, searchParams }: {params: Promise<{ slug: string }>;searchParams: Promise<{ src?: string }>;}) {
  const { slug } = await params;
  const src = (await searchParams).src?.slice(0, 40) ?? null;
  const member = await getCurrentMember();
  const event = await getEventBySlug(slug, member?.role === 'admin');
  if (!event) notFound();
  const action = member ? await getMemberAction(member.id, event.id) : { saved: false, rsvp: null as null };
  const followingPromoter = event.promoter ? await isFollowing(member?.id, 'promoter', event.promoter.id) : false;
  const promoterSlug = event.promoter ? (await queryOne<{ slug: string }>(`select slug from promoters where id = $1`, [event.promoter.id]))?.slug : null;
  const claimablePromoters = member && !event.promoter ? (await getMemberPromoters(member.id)).filter((p) => p.claim_status === 'verified') : [];
  const guestlistSettings = await queryOne<{mode:'promoter_only'|'approve_requests'|'auto_fill';max_plus_ones:number;guestlist_closes_at:string|null}>(
    `select mode,max_plus_ones,guestlist_closes_at from event_guestlist_settings where event_id=$1`,[event.id]
  );
  const guestlistOpen = !!guestlistSettings && guestlistSettings.mode !== 'promoter_only' && (!guestlistSettings.guestlist_closes_at || new Date(guestlistSettings.guestlist_closes_at).getTime() > Date.now());

  // GET ME IN — for members, the way in. For everyone else, the reason to
  // become one. Only on events that are live, upcoming and not cancelled.
  const getMeInEligible = eventEligible(event);
  const isMember = member ? membershipIsActive(await getMembership(member.id)) : false;
  const getMeInViewer = !member ? 'anon' : isMember ? 'member' : 'nonmember';
  const [liveRequest, plan] = getMeInEligible
    ? await Promise.all([isMember && member ? liveRequestFor(member.id, event.id) : Promise.resolve(null), getPlan()])
    : [null, null];
  const membershipPrice = formatPence(plan?.price_pence ?? 3000, plan?.currency ?? 'GBP');

  // Artist IDs are deliberately resolved here rather than exposed in the public lineup payload.
  // This lets an event quietly unlock Guestlist's archive when a lineup artist has published moments.
  const lineupSlugs=(event.lineup||[]).map(a=>a.slug).filter(Boolean);
  const lineupArtistRows=lineupSlugs.length?await query<{id:string}>(`select id from artists where slug=any($1::text[])`,[lineupSlugs]):[];
  const interviewDiscoveries=await interviewsForEventArtists(lineupArtistRows.map(a=>a.id),4);
  // Published pieces that name this night. Drafts and submissions stay out —
  // articlesForEvent only returns published ones.
  const writtenAbout=await articlesForEvent(event.id);

  const nowMs=Date.now(),startMs=new Date(event.start_at).getTime();
  const endMs=event.end_at?new Date(event.end_at).getTime():startMs+6*3600_000;
  const tonight=event.status==='live'&&event.listing_status!=='cancelled'&&startMs<nowMs+24*3600_000&&endMs+CLUB_LIMITS.presenceGraceHours*3600_000>nowMs;
  const liveStats=tonight&&member?await queryOne<{visible_here:number;friends_here:number}>(`select count(*)::int as visible_here,count(*) filter (where ${friendPairSql('$1','p.member_id')})::int as friends_here from event_presence p where p.event_id=$2 and ${PRESENCE_ACTIVE_SQL('p')} and p.visibility<>'invisible' and ${presenceVisibleSql('$1','p')}`,[member.id,event.id]):null;
  const socialContext=member?await eventSocialContext(member.id,event.id):null;
  const contextBits=socialContext?[socialContext.close_friends_going>0&&(socialContext.close_friends_going===1&&socialContext.close_friend_names[0]?`★ ${socialContext.close_friend_names[0]} is going`:`★ ${socialContext.close_friends_going} close friends are going`),socialContext.connections_going>0&&`${socialContext.connections_going} connection${socialContext.connections_going===1?'':'s'} going`,socialContext.scene_going>0&&`${socialContext.scene_going} from your scene going`,socialContext.taste_going>0&&`${socialContext.taste_going} share your music taste`].filter(Boolean) as string[]:[];
  const cancelled=event.listing_status==='cancelled';const listingBadge=event.listing_status!=='confirmed'?event.listing_status:null;
  const price=formatPrice(event.price_from,event.price_to,event.currency);const past=isPast(event);const location=[event.city,event.country].filter(Boolean).join(', ');
  const mapsUrl=event.latitude!=null&&event.longitude!=null?`https://www.openstreetmap.org/?mlat=${event.latitude}&mlon=${event.longitude}#map=15/${event.latitude}/${event.longitude}`:null;

  return <main className="wrap"><TrackView eventId={event.id} src={src}/>
    <section className="detailHero">{event.primary_image_url&&<img className="bg" src={event.primary_image_url} alt=""/>}<div className="detailHeroInner"><div className="detailKicker">{eventTypeLabel(event.event_type)}{past&&' · Past event'}{event.status!=='live'&&` · ${event.status.replace('_',' ')} (admin preview)`}</div><h1 className="detailTitle">{event.title}</h1>{listingBadge&&<div style={{marginBottom:12}}><span className={`listingBadge ${listingBadge}`}>{listingBadge.replace('_',' ')}</span></div>}<div className="detailMetaRow"><span><strong>{fmtEventDate(event.start_at,event.end_at,event.timezone)}</strong></span><span>{fmtEventTime(event.start_at,event.end_at,event.timezone)}</span>{event.venue&&<span>{event.venue.name}</span>}{location&&<span>{location}</span>}</div>{event.genres.length>0&&<div className="tagRow" style={{marginTop:16}}>{event.genres.map(g=><Link key={g.slug} href={`/events?genre=${g.slug}`} className="tag">{g.name}</Link>)}</div>}</div></section>
    {cancelled&&<div className="cancelBanner">CANCELLED — this event is no longer going ahead.</div>}
    {member?.role==='admin'&&<AdminItemActions noun="event" name={event.title} editHref={`/admin/events/${event.id}`} deleteUrl={`/api/admin/events/${event.id}`} afterDelete="/events"/>}
    <div className="detailColumns"><div>
      {event.short_description&&<p className="prose" style={{fontSize:18,color:'var(--text)'}}>{event.short_description}</p>}
      {event.description&&<><div className="sectionLabel">About</div><p className="prose">{event.description}</p></>}
      {event.lineup.length>0&&<><div className="sectionLabel">Lineup</div><div className="lineupList">{event.lineup.map(a=><div className="act" key={a.slug}><Link href={`/artists/${a.slug}`}>{a.name}</Link>{a.billing&&<span className="billing">{a.billing.replace('_',' ')}</span>}</div>)}</div></>}

      {interviewDiscoveries.length>0&&<section style={{marginTop:34}}><div className="sectionLabel">From the Guestlist vault</div><p className="adminSub" style={{marginTop:-4}}>Before tonight — hear the artists in their own words.</p><div style={{display:'grid',gap:12}}>{interviewDiscoveries.map(d=><article className="adminCard" key={`${d.artist_id}-${d.video.id}`} style={{display:'grid',gridTemplateColumns:d.video.thumbnail_url?'120px 1fr':'1fr',gap:14,alignItems:'start'}}>{d.video.thumbnail_url&&<img src={d.video.thumbnail_url} alt="" style={{width:120,aspectRatio:'16/9',objectFit:'cover'}}/>}<div><div className="adminSub"><Link href={`/artists/${d.artist_slug}`}>{d.artist_name}</Link> · ORIGINAL GUESTLIST INTERVIEW</div><b>{d.video.title}</b>{d.video.moments.length>0&&<div style={{display:'grid',gap:7,marginTop:10}}>{d.video.moments.map(m=><a key={m.id} href={youtubeTimestampUrl(d.video.youtube_video_id,m.start_seconds)} target="_blank" rel="noreferrer" className="tag" style={{display:'block'}}><b>{clock(m.start_seconds)}</b> — {m.title}</a>)}</div>}<div style={{marginTop:10}}><Link href={`/clips?video=${d.video.id}`}>Discover the interview →</Link></div></div></article>)}</div></section>}

      {writtenAbout.length>0&&<section style={{marginTop:34}}><div className="sectionLabel">Written about this night</div><div className="linkedArticleList">{writtenAbout.map(x=><Link key={x.id} href={`/balance/${x.slug}`} className="linkedArticleCard">{x.hero_image_url?<img src={x.hero_image_url} alt=""/>:<span className="linkedArticleNoImage"/>}<span><span className="linkedArticleKicker">{x.section_name}</span><strong>{x.title}</strong>{x.excerpt&&<span className="linkedArticleMeta">{x.excerpt}</span>}<span className="linkedArticleMeta">{`By ${x.author_name} · ${x.reading_minutes} min read`}</span></span></Link>)}</div></section>}

      {event.promoter&&<><div className="sectionLabel">Organiser</div><div className="organiserCard">{event.promoter.image_url?<img className="logo" src={event.promoter.image_url} alt="" style={{width:52,height:52,borderRadius:14,objectFit:'cover'}}/>:<div className="logo" style={{width:52,height:52,borderRadius:14,background:'var(--surface-hover)',border:'1px solid var(--border)',display:'grid',placeItems:'center',fontWeight:750,fontSize:19,color:'var(--text-muted)',flexShrink:0}}>{event.promoter.name[0]}</div>}<div style={{flex:1,minWidth:0}}><div className="big" style={{fontSize:17,fontWeight:700}}>{event.promoter.name} {event.promoter.verified&&<span className="verifiedMark" title="Verified promoter">✓</span>}</div>{event.promoter.verified&&<div style={{fontSize:12,color:'var(--text-muted)'}}>Verified promoter</div>}</div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{promoterSlug&&<Link className="btnGhost" style={{padding:'7px 13px',fontSize:11}} href={`/promoters/${promoterSlug}`}>View promoter</Link>}<FollowButton entityType="promoter" entityId={event.promoter.id} initialFollowing={followingPromoter} isSignedIn={!!member} compact/></div></div></>}
      {claimablePromoters.length>0&&!past&&<ClaimEventPrompt eventId={event.id} promoters={claimablePromoters}/>}</div>
      <aside>{getMeInEligible&&<GetMeIn eventId={event.id} viewer={getMeInViewer} billingLive={billingEnabled()} price={membershipPrice} initialRequest={liveRequest?{id:liveRequest.id,places:liveRequest.places,friendly:liveRequest.friendly,member_price_pence:liveRequest.member_price_pence,currency:liveRequest.currency}:null}/>}<div className="sideCard"><div className="big">{fmtEventDate(event.start_at,event.end_at,event.timezone)}</div><div className="muted">{fmtEventTime(event.start_at,event.end_at,event.timezone)} · {event.timezone}</div>{event.venue&&<><hr/><div className="big"><Link href={`/venues/${event.venue.slug}`} style={{textDecoration:'underline',textDecorationColor:'var(--border-strong)'}}>{event.venue.name}</Link></div><div className="muted">{[event.venue.address,event.venue.city,event.venue.country].filter(Boolean).join(', ')}</div></>}{mapsUrl&&<a className="mapLink" href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{marginTop:14}}>View on map ↗<div className="coords">{Number(event.latitude).toFixed(4)}, {Number(event.longitude).toFixed(4)}</div></a>}<hr/><div className="muted">{price??'Price to be announced'}</div>{(event.ticket_url||event.source_url)&&!past&&!cancelled&&event.listing_status!=='sold_out'&&<a className="ctaTickets" href={`/out/${event.id}${src?`?src=${encodeURIComponent(src)}`:''}`}>Get Tickets →</a>}{event.listing_status==='sold_out'&&!past&&<div className="listingBadge sold_out" style={{marginTop:12,textAlign:'center',display:'block'}}>Sold out</div>}{cancelled&&<div className="muted" style={{marginTop:10}}>Tickets are no longer available.</div>}{past&&<div className="muted" style={{marginTop:10}}>This event has already happened.</div>}</div>
      {guestlistOpen&&!past&&!cancelled&&guestlistSettings&&<GuestlistRequest eventId={event.id} isSignedIn={!!member} mode={guestlistSettings.mode as 'approve_requests'|'auto_fill'} maxPlusOnes={guestlistSettings.max_plus_ones}/>} 
      {tonight&&<Link href={`/clubmessenger/events/${event.id}`} className="tonightModule"><div className="tonightModuleTitle">⚡ Tonight on Guestlist</div><div className="tonightModuleBody">{liveStats&&liveStats.friends_here>0?`${liveStats.friends_here} friend${liveStats.friends_here===1?'':'s'} here now`:liveStats&&liveStats.visible_here>0?`${liveStats.visible_here} here now`:'Live room is open'} · see who’s out, check in when you arrive →</div></Link>}
      {contextBits.length>0&&<div className="socialContextLine">{`✦ ${contextBits.join(' · ')}`}</div>}
      <SocialPanel eventId={event.id} isSignedIn={!!member} initial={action} goingCount={event.going_count} interestedCount={event.interested_count} avatars={event.going_avatars} promoter={event.promoter?{id:event.promoter.id,name:event.promoter.name,following:followingPromoter}:null}/><div style={{display:'flex',gap:8}}><ShareButton eventId={event.id} title={event.title}/></div></aside></div>
  </main>;
}
