'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ArticleOwnerActions({articleId}:{articleId:string}){
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  async function remove(){
    if(!confirm('Delete this article permanently? This cannot be undone.'))return;
    setBusy(true);
    try{
      const r=await fetch(`/api/articles/${articleId}`,{method:'DELETE'});
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||'Could not delete article');
      router.push('/balance');
      router.refresh();
    }catch(e){alert(e instanceof Error?e.message:'Could not delete article');setBusy(false);}
  }
  return <div style={{display:'flex',gap:10,margin:'18px 0 26px',flexWrap:'wrap'}}>
    <Link href={`/balance/write?id=${articleId}`} className="btnAccent">Edit article</Link>
    <button type="button" className="btnGhost" onClick={remove} disabled={busy}>{busy?'Deleting…':'Delete article'}</button>
  </div>;
}
