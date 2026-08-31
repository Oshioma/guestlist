import { NextRequest, NextResponse } from 'next/server';
import { getCurrentMember } from '@/lib/auth';
import { exchangeCode, saveConnection } from '@/lib/youtubeOAuth';

export async function GET(req:NextRequest){
  const me=await getCurrentMember();
  const base=new URL(req.url).origin;
  if(me?.role!=='admin') return NextResponse.redirect(`${base}/admin/video-archive?youtube=forbidden`);
  const url=new URL(req.url);
  const code=url.searchParams.get('code');
  const state=url.searchParams.get('state');
  const error=url.searchParams.get('error');
  const expected=req.cookies.get('youtube_oauth_state')?.value;
  if(error) return NextResponse.redirect(`${base}/admin/video-archive?youtube=${encodeURIComponent(error)}`);
  if(!code||!state||!expected||state!==expected) return NextResponse.redirect(`${base}/admin/video-archive?youtube=state_error`);
  try{
    const redirectUri=process.env.YOUTUBE_OAUTH_REDIRECT_URI || `${base}/api/admin/video-archive/youtube/callback`;
    const tokens=await exchangeCode(code,redirectUri);
    if(!tokens.refresh_token) throw new Error('Google did not return a refresh token. Reconnect and approve access again.');
    const connected=await saveConnection(tokens.refresh_token,tokens.scope);
    const res=NextResponse.redirect(`${base}/admin/video-archive?youtube=connected&channel=${encodeURIComponent(connected.channelTitle||'YouTube')}`);
    res.cookies.delete('youtube_oauth_state');
    return res;
  }catch(e){return NextResponse.redirect(`${base}/admin/video-archive?youtube=error&message=${encodeURIComponent(e instanceof Error?e.message:'Connection failed')}`)}
}
