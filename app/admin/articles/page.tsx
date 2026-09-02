import { listAdminArticles } from '@/lib/articles';
import { AdminArticles } from '@/components/balance/AdminArticles';
export const dynamic='force-dynamic';
// ?id= comes from the Edit button on a live article page — the desk opens
// straight into that piece's editor instead of making an admin hunt the list.
export default async function AdminArticlesPage({searchParams}:{searchParams:Promise<{id?:string}>}){
  const {id}=await searchParams;
  return <AdminArticles initial={await listAdminArticles()} openId={typeof id==='string'?id:null}/>;
}
