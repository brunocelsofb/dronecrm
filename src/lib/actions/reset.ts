'use server'

// Resetar o CRM: admin da empresa (a própria) ou Super Admin (qualquer uma).
// Exige digitar o nome exato da empresa.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { resetTenantData } from '@/lib/tenant/reset'

export async function resetCrm(confirmName: string, tenantIdArg?: string): Promise<{ ok?: true; error?: string; summary?: string }> {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return { error: 'Não autenticado.' }
  const admin = createAdminClient()
  const { data: me } = await admin.from('profiles').select('role, is_super_admin').eq('id', user.id).maybeSingle()

  let tenantId: string
  if (tenantIdArg) {
    if (!me?.is_super_admin) return { error: 'Só o Super Admin reseta outra empresa.' }
    tenantId = tenantIdArg
  } else {
    if (me?.role !== 'admin' && !me?.is_super_admin) return { error: 'Só o administrador da conta pode resetar o CRM.' }
    tenantId = await resolveTenantId()
  }

  const { data: tenant } = await admin.from('tenants').select('name').eq('id', tenantId).maybeSingle()
  if (!tenant) return { error: 'Empresa não encontrada.' }
  if (confirmName.trim() !== String(tenant.name).trim()) return { error: `Digite exatamente: ${tenant.name}` }

  try {
    const r = await resetTenantData(tenantId)
    if (tenantIdArg) {
      // Reset feito pela plataforma fica no registro de acessos da empresa
      const { logSupport } = await import('@/lib/tenant/support')
      await logSupport({ tenantId, actorId: user.id, action: 'reset', detail: 'Super Admin resetou os dados do CRM' })
    }
    const total = Object.values(r.counts).reduce((a, b) => a + b, 0)
    console.log('[reset] empresa', tenantId, 'por', user.id, r)
    revalidatePath('/', 'layout')
    return { ok: true, summary: `${total} registro(s) apagado(s); ${r.whatsapp.length} WhatsApp removido(s). Funil básico recriado.` }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao resetar.' }
  }
}
