// Quem pode exportar: só o admin da empresa, fora do acesso de suporte.
import { getUserAccess } from '@/lib/auth/access'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'

export async function exportContext(): Promise<
  | { ok: true; tenantId: string; userId: string; features: string[]; db: Awaited<ReturnType<typeof createScopedAdmin>>; companyName: string; by: string }
  | { ok: false; error: string }
> {
  const access = await getUserAccess()
  if (!access?.isAdmin) return { ok: false, error: 'Só o administrador da empresa pode exportar.' }
  if (await getSupportSession()) return { ok: false, error: 'Exportação indisponível em acesso de suporte.' }
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const [{ data: org }, { data: me }] = await Promise.all([
    db.from('organization_settings').select('company_name, name').eq('tenant_id', tenantId).maybeSingle(),
    db.from('profiles').select('full_name, email').eq('id', access.userId).maybeSingle(),
  ])
  return {
    ok: true, tenantId, userId: access.userId, features: access.features, db,
    companyName: ((org?.company_name as string | null) || (org?.name as string | null) || 'Empresa').trim(),
    by: ((me?.full_name as string | null) || (me?.email as string | null) || 'administrador').trim(),
  }
}

export const fileSlug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'empresa'
export const todayBR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
