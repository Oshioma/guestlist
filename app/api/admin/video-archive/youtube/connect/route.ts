import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentMember } from '@/lib/auth';
import { youtubeAuthUrl } from '@/lib/youtubeOAuth';

export async function GET(req:NextRequest){
  const me=await getCurrentMember();
  if(me?.role!=='admin') return NextResponse.json({error:'Forbidden'},{status:403});
  const redirectUri=process.env.YOUTUBE_OAUTH_REDIRECT_URI || `${new URL(req.url).origin}/api/admin/video-archive/youtube/callback`;
  const state=crypto.randomBytes(32).toString('base64url');
  const res=NextResponse.redirect(youtubeAuthUrl(redirectUri,state));
  res.cookies.set('youtube_oauth_state',state,{httpOnly:true,secure:true,sameSite:'lax',maxAge:600,path:'/'});
  return res;
}
