import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentMember } from '@/lib/auth';
import { youtubeAuthUrl } from '@/lib/youtubeOAuth';

export async function GET(req:NextRequest){
  const me=await getCurrentMember();
  if(me?.role!=='admin') return NextResponse.json({error:'Forbidden'},{status:403});
  try {
    const redirectUri=process.env.YOUTUBE_OAUTH_REDIRECT_URI || `${new URL(req.url).origin}/api/admin/video-archive/youtube/callback`;
    const state=crypto.randomBytes(32).toString('base64url');
    const res=NextResponse.redirect(youtubeAuthUrl(redirectUri,state));
    res.cookies.set('youtube_oauth_state',state,{httpOnly:true,secure:true,sameSite:'lax',maxAge:600,path:'/'});
    return res;
  } catch (e) {
    console.error('YouTube OAuth connect failed', e);
    const missing=[
      'YOUTUBE_OAUTH_CLIENT_ID',
      'YOUTUBE_OAUTH_CLIENT_SECRET',
      'YOUTUBE_OAUTH_ENCRYPTION_KEY',
    ].filter(name=>!process.env[name]);
    return NextResponse.json({
      error:e instanceof Error?e.message:'YouTube OAuth connect failed',
      missingEnvironmentVariables:missing,
      expectedRedirectUri:process.env.YOUTUBE_OAUTH_REDIRECT_URI || `${new URL(req.url).origin}/api/admin/video-archive/youtube/callback`,
    },{status:500});
  }
}
