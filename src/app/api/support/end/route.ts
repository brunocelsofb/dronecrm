// Sai do "Acessar" (botão Voltar, ?saida=1) ou encerra um sem liberação válida (expirou/revogada):
// limpa o perfil e os cookies e volta ao Super Admin com o aviso.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logSupport } from '@/lib/tenant/support'

export async function GET(req: Request) {
  const voluntary = new URL(req.url).searchParams.get('saida') === '1'
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (user) {
    const admin = createAdminClient()
    const { data: me } = await admin.from('profiles').select('is_super_admin, tenant_id, impersonating_tenant_id, full_name').eq('id', user.id).maybeSingle()
    if (me?.is_super_admin) {
      if (me.impersonating_tenant_id && me.impersonating_tenant_id !== me.tenant_id) {
        await logSupport({ tenantId: me.impersonating_tenant_id as string, actorId: user.id, actorName: (me.full_name as string | null) ?? null, action: 'stop', detail: voluntary ? 'Saiu do acesso de suporte' : 'Encerrado: liberação expirada ou revogada' })
      }
      await admin.from('profiles').update({ impersonating_tenant_id: null }).eq('id', user.id)
    }
  }
  const res = NextResponse.redirect(new URL(voluntary ? '/super-admin' : '/super-admin?aviso=liberacao-encerrada', req.url))
  res.cookies.delete('orbis_imp_tid')
  res.cookies.delete('orbis_imp_name')
  return res
}
