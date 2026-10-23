// Super Admin na própria conta (plataforma), sem estar em "Acessar" de outra empresa.
// Só assim pode mudar o que é da plataforma, como o fundo da tela de login comum.
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentTenantId } from '@/lib/tenant/context'

export async function isPlatformOwner(): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data: p } = await createAdminClient().from('profiles').select('tenant_id, is_super_admin').eq('id', user.id).maybeSingle()
  if (!p?.is_super_admin || !p.tenant_id) return false
  return (await getCurrentTenantId()) === p.tenant_id
}
