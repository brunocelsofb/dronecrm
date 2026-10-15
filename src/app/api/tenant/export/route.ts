// GET /api/tenant/export[?tenant=<id>] — cópia dos dados da empresa em planilha.
// Admin da empresa: a própria. Super Admin: qualquer uma (?tenant=).
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
  let tenantId: string
  if (asked && me?.is_super_admin) tenantId = asked
  else if (me?.role === 'admin' || me?.is_super_admin) tenantId = await resolveTenantId()
  else return NextResponse.json({ error: 'Só o administrador da conta pode baixar a cópia.' }, { status: 403 })

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
