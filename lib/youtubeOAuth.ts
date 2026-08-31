import crypto from 'crypto';
import { query, queryOne } from './db';

const SCOPE='https://www.googleapis.com/auth/youtube.force-ssl';

type Connection={encrypted_refresh_token:string;channel_id:string|null;channel_title:string|null;granted_scope:string|null};

function cfg(){
  const clientId=process.env.YOUTUBE_OAUTH_CLIENT_ID;
  const clientSecret=process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
  const encryptionKey=process.env.YOUTUBE_OAUTH_ENCRYPTION_KEY;
  if(!clientId||!clientSecret||!encryptionKey) throw new Error('YouTube OAuth is not fully configured');
  return {clientId,clientSecret,encryptionKey};
}

function keyBytes(secret:string){return crypto.createHash('sha256').update(secret).digest()}
export function encryptToken(value:string){const {encryptionKey}=cfg();const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',keyBytes(encryptionKey),iv);const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);const tag=cipher.getAuthTag();return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`}
export function decryptToken(value:string){const {encryptionKey}=cfg();const [ivB,tagB,dataB]=value.split('.');if(!ivB||!tagB||!dataB)throw new Error('Invalid stored YouTube token');const decipher=crypto.createDecipheriv('aes-256-gcm',keyBytes(encryptionKey),Buffer.from(ivB,'base64url'));decipher.setAuthTag(Buffer.from(tagB,'base64url'));return Buffer.concat([decipher.update(Buffer.from(dataB,'base64url')),decipher.final()]).toString('utf8')}

export function youtubeAuthUrl(redirectUri:string,state:string){const {clientId}=cfg();const p=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:'code',scope:SCOPE,access_type:'offline',include_granted_scopes:'true',prompt:'consent',state});return `https://accounts.google.com/o/oauth2/v2/auth?${p}`}

async function tokenRequest(params:Record<string,string>){const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params),cache:'no-store'});const j=await r.json();if(!r.ok)throw new Error(j.error_description||j.error||'Google token exchange failed');return j as {access_token:string;refresh_token?:string;expires_in?:number;scope?:string}}

export async function exchangeCode(code:string,redirectUri:string){const {clientId,clientSecret}=cfg();return tokenRequest({code,client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri,grant_type:'authorization_code'})}
async function accessToken(){const c=await queryOne<Connection>(`select encrypted_refresh_token,channel_id,channel_title,granted_scope from youtube_oauth_connections where provider='youtube'`);if(!c)throw new Error('YouTube account is not connected');const {clientId,clientSecret}=cfg();const t=await tokenRequest({refresh_token:decryptToken(c.encrypted_refresh_token),client_id:clientId,client_secret:clientSecret,grant_type:'refresh_token'});return t.access_token}

export async function saveConnection(refreshToken:string,scope:string|undefined){const token=encryptToken(refreshToken);const access=await (async()=>{const {clientId,clientSecret}=cfg();const t=await tokenRequest({refresh_token:refreshToken,client_id:clientId,client_secret:clientSecret,grant_type:'refresh_token'});return t.access_token})();const r=await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',{headers:{authorization:`Bearer ${access}`},cache:'no-store'});const j=await r.json() as {items?:Array<{id:string;snippet?:{title?:string}}>;error?:{message?:string}};if(!r.ok)throw new Error(j.error?.message||'Could not read connected YouTube channel');const ch=j.items?.[0];if(!ch)throw new Error('No YouTube channel found on this Google account');await query(`insert into youtube_oauth_connections(provider,channel_id,channel_title,encrypted_refresh_token,granted_scope) values('youtube',$1,$2,$3,$4) on conflict(provider) do update set channel_id=excluded.channel_id,channel_title=excluded.channel_title,encrypted_refresh_token=excluded.encrypted_refresh_token,granted_scope=excluded.granted_scope,updated_at=now()`,[ch.id,ch.snippet?.title||null,token,scope||SCOPE]);return {channelId:ch.id,channelTitle:ch.snippet?.title||null}}

export async function youtubeConnectionStatus(){const c=await queryOne<{channel_id:string|null;channel_title:string|null;connected_at:string}>(`select channel_id,channel_title,connected_at::text from youtube_oauth_connections where provider='youtube'`);return c?{connected:true,...c}:{connected:false}}

function srtToTranscript(srt:string){return srt.replace(/\r/g,'').split(/\n\n+/).map(block=>{const lines=block.trim().split('\n');const time=lines.find(l=>l.includes('-->'));if(!time)return '';const text=lines.slice(lines.indexOf(time)+1).join(' ').replace(/<[^>]+>/g,'').trim();return text?`[${time.split(' --> ')[0].trim().replace(',','.')} ] ${text}`:''}).filter(Boolean).join('\n')}

export async function pullYouTubeTranscript(videoId:string){const video=await queryOne<{youtube_video_id:string}>(`select youtube_video_id from artist_videos where id=$1`,[videoId]);if(!video)throw new Error('Video not found');const token=await accessToken();const list=await fetch(`https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${encodeURIComponent(video.youtube_video_id)}`,{headers:{authorization:`Bearer ${token}`},cache:'no-store'});const lj=await list.json() as {items?:Array<{id:string;snippet?:{language?:string;name?:string;trackKind?:string;isDraft?:boolean}}>;error?:{message?:string}};if(!list.ok)throw new Error(lj.error?.message||'Could not list YouTube captions');const tracks=(lj.items||[]).filter(x=>!x.snippet?.isDraft);if(!tracks.length){await query(`update artist_videos set transcript_status='missing',updated_at=now() where id=$1`,[videoId]);return {found:false,reason:'No caption track is available on YouTube for this video.'}}
  const preferred=tracks.find(x=>x.snippet?.language?.toLowerCase().startsWith('en'))||tracks[0];
  const dl=await fetch(`https://www.googleapis.com/youtube/v3/captions/${encodeURIComponent(preferred.id)}?tfmt=srt`,{headers:{authorization:`Bearer ${token}`},cache:'no-store'});if(!dl.ok){let message=`YouTube caption download failed (${dl.status})`;try{const e=await dl.json() as {error?:{message?:string}};message=e.error?.message||message}catch{}throw new Error(message)}
  const transcript=srtToTranscript(await dl.text());if(!transcript.trim())throw new Error('YouTube returned an empty caption track');await query(`update artist_videos set transcript_text=$2,transcript_status='ready',transcript_source='youtube_captions',language=$3,updated_at=now() where id=$1`,[videoId,transcript,preferred.snippet?.language||null]);return {found:true,language:preferred.snippet?.language||null,characters:transcript.length}}
