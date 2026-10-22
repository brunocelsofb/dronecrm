// Exportação completa dos dados da empresa (.zip de CSVs). Só o admin da empresa.
// Bloqueada em acesso de suporte: a plataforma não leva conteúdo da empresa.
// O .zip vai para o armazenamento privado e a pessoa baixa por link de 10 minutos
// (a Vercel limita a resposta direta a 4,5 MB). Cada exportação fica no registro de acessos.

import { NextResponse, type NextRequest } from 'next/server'
import { logSupport } from '@/lib/tenant/support'
import { buildTenantExport } from '@/lib/tenant/export'
import { storeExport } from '@/lib/tenant/export-files'
import { exportContext, fileSlug, todayBR } from '@/lib/tenant/export-guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const back = (req: NextRequest, erro: string) => NextResponse.redirect(new URL(`/settings/privacidade?erro=${encodeURIComponent(erro)}#exportar`, req.url), 303)

export async function GET(req: NextRequest) {
  const ctx = await exportContext()
  if (!ctx.ok) return back(req, ctx.error)

  const out = await buildTenantExport(ctx.db, ctx.tenantId, { companyName: ctx.companyName, by: ctx.by })
  const stored = await storeExport(ctx.tenantId, `dados-${fileSlug(ctx.companyName)}-${todayBR()}.zip`, out.zip)
  if (!stored.ok) return back(req, stored.error)
  const total = Object.values(out.counts).reduce((s, n) => s + n, 0)
  await logSupport({
    tenantId: ctx.tenantId, actorId: ctx.userId, actorName: ctx.by, action: 'export',
    detail: `Exportou os dados da empresa (${total} registros${out.failed.length ? `; falhou: ${out.failed.join(', ')}` : ''})`,
  })
  return NextResponse.redirect(stored.url, 303)
}
