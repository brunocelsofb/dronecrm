// GET /api/tenant/export[?tenant=<id>] — cópia dos dados da empresa em planilha.
// Só o admin da própria empresa. O Super Admin não baixa dados de outra empresa
// (nem em acesso de suporte, que é só leitura na tela).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { buildTenantExport } from '@/lib/tenant/reset'

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const { data: me } = await createAdminClient().from('profiles').select('role, is_super_admin').eq('id', user.id).maybeSingle()
  const asked = new URL(req.url).searchParams.get('tenant')
  const { data: own } = await createAdminClient().from('profiles').select('tenant_id').eq('id', user.id).maybeSingle()
  const ownTenant = (own?.tenant_id as string | null) ?? null
  if (asked && asked !== ownTenant) return NextResponse.json({ error: 'A cópia dos dados só pode ser baixada pelo administrador da própria empresa.' }, { status: 403 })
  if (me?.role !== 'admin' && !me?.is_super_admin) return NextResponse.json({ error: 'Só o administrador da conta pode baixar a cópia.' }, { status: 403 })
  const tenantId = await resolveTenantId()
  if (tenantId !== ownTenant) return NextResponse.json({ error: 'Acesso de suporte é só leitura: a cópia dos dados é baixada pelo administrador da empresa.' }, { status: 403 })

  const buf = await buildTenantExport(tenantId)
  const { data: t } = await createAdminClient().from('tenants').select('slug').eq('id', tenantId).maybeSingle()
  const stamp = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 16).replace(/[:T]/g, '-')
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="copia-crm-${t?.slug ?? 'empresa'}-${stamp}.xlsx"`,
    },
  })
}
