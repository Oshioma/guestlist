'use client';

// The "+ Image" and "+ YouTube video" controls above the article body. Each
// one builds a single line (see lib/articleBody.ts) and hands it to the editor,
// which drops it in as its own paragraph where the cursor is.

import { useState } from 'react';
import { imageLine, youtubeId } from '@/lib/articleBody';
import { shrinkImage, UPLOAD_LIMIT } from '@/components/market/ImageField';
import styles from './ArticleEditor.module.css';

export function BodyMedia({ disabled, onInsert }: { disabled: boolean; onInsert: (line: string) => void }) {
  const [open, setOpen] = useState<'image' | 'video' | null>(null);
  const [url, setUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [video, setVideo] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  function toggle(which: 'image' | 'video') {
    setError('');
    setOpen((x) => (x === which ? null : which));
  }

  async function upload(file: File) {
    setUploading(true);
    setError('');
    try {
      const small = await shrinkImage(file);
      if (small.size > UPLOAD_LIMIT) throw new Error('That image is too large (about 4MB max) — try a smaller one');
      const body = new FormData();
      body.append('file', small);
      const res = await fetch('/api/articles/image', { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Could not upload that');
      setUrl(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload that');
    } finally {
      setUploading(false);
    }
  }

  function insertImage() {
    const u = url.trim();
    if (!/^https:\/\//.test(u) && !(u.startsWith('/') && !u.startsWith('//'))) {
      setError('Upload a picture, or paste an https:// link to one');
      return;
    }
    onInsert(imageLine(u, caption));
    setUrl('');
    setCaption('');
    setOpen(null);
  }

  function insertVideo() {
    const v = video.trim();
    if (!youtubeId(v)) {
      setError("That doesn't look like a YouTube link — copy it from the Share button on the video");
      return;
    }
    onInsert(v);
    setVideo('');
    setOpen(null);
  }

  return (
    <div className={styles.media}>
      <div className={styles.mediaButtons}>
        <button type="button" className={styles.button} disabled={disabled} onClick={() => toggle('image')}>+ Image</button>
        <button type="button" className={styles.button} disabled={disabled} onClick={() => toggle('video')}>+ YouTube video</button>
      </div>

      {open === 'image' && (
        <div className={styles.mediaPanel}>
          <label htmlFor="body-image-url">Picture</label>
          <div className={styles.searchRow}>
            <input id="body-image-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… or upload one" />
            <label className={styles.button} style={{ whiteSpace: 'nowrap' }}>
              {uploading ? 'Uploading…' : 'Upload'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                hidden
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) upload(file);
                }}
              />
            </label>
          </div>
          {url.trim() && <img className={styles.mediaThumb} src={url.trim()} alt="" />}
          <label htmlFor="body-image-caption">Caption · also read aloud to people using screen readers</label>
          <input id="body-image-caption" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="What's in the picture, and who took it" />
          <button type="button" className={`${styles.button} ${styles.primary}`} disabled={uploading || !url.trim()} onClick={insertImage}>Insert image</button>
        </div>
      )}

      {open === 'video' && (
        <div className={styles.mediaPanel}>
          <label htmlFor="body-video-url">YouTube link</label>
          <input id="body-video-url" value={video} onChange={(e) => setVideo(e.target.value)} placeholder="https://www.youtube.com/watch?v=… or https://youtu.be/…" />
          <button type="button" className={`${styles.button} ${styles.primary}`} disabled={!video.trim()} onClick={insertVideo}>Insert video</button>
        </div>
      )}

      {error && <div className={styles.message}>{error}</div>}
      <p className={styles.note}>Media goes in as its own line where your cursor is. Move it by cutting and pasting that line; delete the line to remove it.</p>
    </div>
  );
}
