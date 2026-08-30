// Archive media storage + validation.
//
// SECURITY: uploaded extension and declared content-type are never trusted
// — the MIME is sniffed from magic bytes; storage paths are generated
// (uuid), never derived from the upload's filename; size is capped.
//
// STORAGE: Supabase Storage when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// are configured (bucket "archive"); local /public/uploads/archive in
// development. Originals are preserved; display/thumb variants are
// generated when sharp is available (optional dependency — without it the
// original serves, still never base64 in Postgres).

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MEDIA_LIMITS = {
  maxBytes: 10 * 1024 * 1024, // 10MB
  thumbWidth: 360,
  displayWidth: 1280,
} as const;

type Sniffed = { mime: string; ext: string };

// Magic-byte sniffing for the formats the archive accepts.
export function sniffImage(buf: Buffer): Sniffed | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (buf.slice(0, 6).toString('ascii') === 'GIF87a' || buf.slice(0, 6).toString('ascii') === 'GIF89a') return { mime: 'image/gif', ext: 'gif' };
  return null;
}

export type StoredMedia = {
  storagePath: string;
  displayPath: string | null;
  thumbPath: string | null;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
};

export class MediaError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function sharpOrNull() {
  try {
    // Optional: present in most Next deployments; absent locally is fine.
    const mod = await import('sharp');
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

// Supabase has two key formats: legacy service_role keys are JWTs (eyJ…)
// and go in an Authorization bearer; the newer secret keys (sb_secret_…)
// are not JWTs — sending them as a bearer yields "Invalid Compact JWS".
// Both formats are accepted via the apikey header, so send that always and
// the bearer only for JWT-shaped keys.
function supabaseAuthHeaders(key: string): Record<string, string> {
  return key.startsWith('eyJ')
    ? { apikey: key, Authorization: `Bearer ${key}` }
    : { apikey: key };
}

async function supabaseUpload(base: string, key: string, relPath: string, buf: Buffer, mime: string) {
  return fetch(`${base}/storage/v1/object/archive/${relPath}`, {
    method: 'POST',
    headers: {
      ...supabaseAuthHeaders(key),
      'Content-Type': mime,
      'x-upsert': 'true',
    },
    body: new Uint8Array(buf),
  });
}

async function storeBuffer(relPath: string, buf: Buffer, mime: string): Promise<string> {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && serviceKey) {
    let res = await supabaseUpload(supabaseUrl, serviceKey, relPath, buf, mime);
    if (!res.ok) {
      let detail = (await res.text().catch(() => '')).slice(0, 200);
      // Self-heal a missing bucket: the service role may create it, so a
      // "Bucket not found" is fixed in place rather than surfaced as config.
      if (/bucket not found/i.test(detail)) {
        const made = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
          method: 'POST',
          headers: { ...supabaseAuthHeaders(serviceKey), 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'archive', name: 'archive', public: true }),
        });
        if (made.ok || made.status === 409 /* already exists */) {
          res = await supabaseUpload(supabaseUrl, serviceKey, relPath, buf, mime);
          if (!res.ok) detail = (await res.text().catch(() => '')).slice(0, 200);
        }
      }
      if (!res.ok) {
        throw new MediaError(502, `storage upload failed (${res.status}${detail ? `: ${detail}` : ''})`);
      }
    }
    return `${supabaseUrl}/storage/v1/object/public/archive/${relPath}`;
  }
  // Production without Supabase Storage configured: fail with a clear,
  // actionable message instead of crashing on Vercel's read-only filesystem.
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    throw new MediaError(503,
      'Image uploads are not configured yet — add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (and an "archive" storage bucket) to enable them');
  }
  // Development: local public directory.
  try {
    const dir = path.join(process.cwd(), 'public', 'uploads', 'archive', path.dirname(relPath));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(process.cwd(), 'public', 'uploads', 'archive', relPath), buf);
  } catch (err) {
    throw new MediaError(503, `Could not store the image: ${String(err).slice(0, 120)}`);
  }
  return `/uploads/archive/${relPath}`;
}

export async function storeArchiveImage(buf: Buffer): Promise<StoredMedia> {
  if (buf.length > MEDIA_LIMITS.maxBytes) {
    throw new MediaError(400, `Image too large (max ${MEDIA_LIMITS.maxBytes / 1024 / 1024}MB)`);
  }
  const sniffed = sniffImage(buf);
  if (!sniffed) throw new MediaError(400, 'Not a supported image (JPEG, PNG, WebP or GIF)');

  const id = randomUUID();
  const base = `${id.slice(0, 2)}/${id}`; // sharded, generated — never the upload's name
  const storagePath = await storeBuffer(`${base}/original.${sniffed.ext}`, buf, sniffed.mime);

  let displayPath: string | null = null;
  let thumbPath: string | null = null;
  let width: number | null = null;
  let height: number | null = null;

  const sharp = await sharpOrNull();
  if (sharp) {
    try {
      const img = sharp(buf, { failOn: 'error' });
      const meta = await img.metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
      const display = await sharp(buf).resize({ width: MEDIA_LIMITS.displayWidth, withoutEnlargement: true })
        .jpeg({ quality: 82 }).toBuffer();
      const thumb = await sharp(buf).resize({ width: MEDIA_LIMITS.thumbWidth, withoutEnlargement: true })
        .jpeg({ quality: 78 }).toBuffer();
      displayPath = await storeBuffer(`${base}/display.jpg`, display, 'image/jpeg');
      thumbPath = await storeBuffer(`${base}/thumb.jpg`, thumb, 'image/jpeg');
    } catch {
      // A file that sniffs as an image but fails to decode is rejected —
      // decode failure on a valid-looking header is suspicious.
      throw new MediaError(400, 'Image could not be decoded');
    }
  }
  return {
    storagePath,
    displayPath,
    thumbPath,
    mime: sniffed.mime,
    bytes: buf.length,
    width,
    height,
  };
}
