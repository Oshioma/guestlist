import { listAdminArticles } from '@/lib/articles';
import { AdminArticles } from '@/components/balance/AdminArticles';
export const dynamic='force-dynamic';
export default async function AdminArticlesPage(){return <AdminArticles initial={await listAdminArticles()}/>;}
