// Exportação completa dos dados da empresa (.zip de CSVs). Só o admin da empresa.
// Bloqueada em acesso de suporte: a plataforma não leva conteúdo da empresa.
// Cada exportação fica no registro de acessos (Configurações → Privacidade).

import { NextResponse } from 'next/server'
import { getUserAccess } from '@/lib/auth/access'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession, logSupport } from '@/lib/tenant/support'
import { buildTenantExport } from '@/lib/tenant/export'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'empresa'

export async function GET() {
  const access = await getUserAccess()
  if (!access?.isAdmin) return NextResponse.json({ error: 'Só o administrador da empresa pode exportar os dados.' }, { status: 403 })
  if (await getSupportSession()) return NextResponse.json({ error: 'Exportação indisponível em acesso de suporte.' }, { status: 403 })

  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const [{ data: org }, { data: me }] = await Promise.all([
    db.from('organization_settings').select('company_name, name').eq('tenant_id', tenantId).maybeSingle(),
    db.from('profiles').select('full_name, email').eq('id', access.userId).maybeSingle(),
  ])
  const companyName = ((org?.company_name as string | null) || (org?.name as string | null) || 'Empresa').trim()
  const by = ((me?.full_name as string | null) || (me?.email as string | null) || 'administrador').trim()

  const out = await buildTenantExport(db, tenantId, { companyName, by })
  const total = Object.values(out.counts).reduce((s, n) => s + n, 0)
  await logSupport({
    tenantId, actorId: access.userId, actorName: by, action: 'export',
    detail: `Exportou os dados da empresa (${total} registros${out.failed.length ? `; falhou: ${out.failed.join(', ')}` : ''})`,
  })

  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  return new NextResponse(Buffer.from(out.zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="dados-${slug(companyName)}-${day}.zip"`,
      'Cache-Control': 'no-store',
    },
  })
}
