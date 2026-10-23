// PDF público da proposta do Varejo (link com token de 32 caracteres; sem custo nem margem)
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPublicBranding } from '@/lib/utils/public-branding'
import { isProposal } from '@/lib/retail/proposal'
import { buildProposalPdf } from '@/lib/retail/proposal-pdf'
import { appBaseUrl } from '@/lib/whatsapp/webhook-token'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return NextResponse.json({ error: 'Link inválido.' }, { status: 404 })
  const admin = createAdminClient()
  const { data: o } = await admin.from('retail_orders').select('tenant_id, proposal, proposal_choice').eq('proposal_token', token).maybeSingle()
  if (!o || !isProposal(o.proposal)) return NextResponse.json({ error: 'Proposta não encontrada.' }, { status: 404 })
  const [branding, { data: org }] = await Promise.all([
    getPublicBranding(o.tenant_id as string),
    admin.from('organization_settings').select('proposal_brand_color').eq('tenant_id', o.tenant_id).maybeSingle(),
  ])
  let logo: Uint8Array | null = null
  if (branding.logoUrl?.startsWith('http')) {
    try { const r = await fetch(branding.logoUrl, { signal: AbortSignal.timeout(8000) }); if (r.ok) logo = new Uint8Array(await r.arrayBuffer()) } catch { logo = null }
  }
  const pdf = await buildProposalPdf(o.proposal, {
    logo, brandColor: (org?.proposal_brand_color as string | null) ?? '#1B556B',
    acceptUrl: `${appBaseUrl()}/loja/proposta/${token}`, chosen: (o.proposal_choice as string | null) ?? null,
  })
  return new NextResponse(Buffer.from(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="pedido-${o.proposal.number}.pdf"`, 'Cache-Control': 'no-store' } })
}
