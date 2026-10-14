import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTenantId } from '@/lib/tenant/context'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const admin = createAdminClient()

  // 1. Tenta novo modelo: proposals.client_review_token
  const { data: newProposal } = await admin
    .from('proposals')
    .select('id, contract_id')
    .eq('client_review_token', token)
    .maybeSingle()

  if (newProposal?.id) {
    try {
      const { buildMergedProposalBytes } = await import('@/lib/actions/proposal-pdf-merge')
      const result = await buildMergedProposalBytes(newProposal.id)
      if (result.error || !result.bytes) {
        return NextResponse.json({ error: result.error ?? 'Erro ao gerar PDF' }, { status: 500 })
      }
      return new NextResponse(Buffer.from(result.bytes), {
        headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="proposta.pdf"' }
      })
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 })
    }
  }

  // 2. Fallback legado: proposal_status.client_review_token
  const { data: legacyStatus } = await admin
    .from('proposal_status')
    .select('*')
    .eq('client_review_token', token)
    .maybeSingle()

  if (!legacyStatus) {
    return NextResponse.json({ error: 'Token invalido' }, { status: 404 })
  }

  // Busca proposta do sistema de julho vinculada a este contrato
  const { data: linkedProposal } = await admin
    .from('proposals')
    .select('id')
    .eq('contract_id', legacyStatus.contract_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (linkedProposal?.id) {
    // Usa o builder de julho se tiver proposta montada
    try {
      const { buildMergedProposalBytes } = await import('@/lib/actions/proposal-pdf-merge')
      const result = await buildMergedProposalBytes(linkedProposal.id)
      if (result.bytes) {
        return new NextResponse(Buffer.from(result.bytes), {
          headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="proposta.pdf"' }
        })
      }
    } catch { /* cai no fallback do snapshot */ }
  }

  // Gera direto do snapshot (legado puro — sem proposta montada)
  if (!legacyStatus.technical_snapshot) {
    return NextResponse.json({ error: 'Proposta sem dados de precificação. Refaça o fluxo no Price.' }, { status: 404 })
  }

  try {
    const { data: contract } = await admin.from('contracts').select('client_name, process_number, company_id, contact_id').eq('id', legacyStatus.contract_id).maybeSingle()
    const { data: org } = await admin.from('organization_settings').select('company_name, company_cnpj, logo_storage_path, proposal_brand_color, proposal_header_text').eq('tenant_id', await resolveTenantId({ contractId: legacyStatus.contract_id })).maybeSingle()

    const { buildPriceProposalPage } = await import('@/lib/actions/proposal-pdf-from-price')
    const bytes = await buildPriceProposalPage({
      snapshot: legacyStatus.technical_snapshot as any,
      proposalValue: Number(legacyStatus.proposal_value) || 0,
      validityDays: legacyStatus.proposal_validity_days ?? 30,
      submittedByName: legacyStatus.submitted_by_name ?? null,
      technicalApprovedByName: legacyStatus.technical_approved_by_name ?? null,
      technicalApprovedAt: legacyStatus.technical_approved_at ?? null,
      technicalComment: legacyStatus.technical_comment ?? null,
      commercialApprovedByName: legacyStatus.commercial_approved_by_name ?? null,
      commercialApprovedAt: legacyStatus.commercial_approved_at ?? null,
      contract: contract ? { client_name: contract.client_name, process_number: contract.process_number ?? null, cnpj: null } : null,
      company: { name: contract?.client_name ?? '' },
      contact: null,
      org: {
        companyName: org?.company_name ?? 'ORBIS',
        cnpj: org?.company_cnpj ?? '',
        logoStoragePath: org?.logo_storage_path ?? null,
        brandColor: org?.proposal_brand_color ?? '#1B556B',
        headerText: org?.proposal_header_text ?? null,
        footerText: null,
        proposalCode: `ORB.${legacyStatus.contract_id.slice(0, 8).toUpperCase()}`,
      },
      textoObjetivos: legacyStatus.texto_objetivos ?? null,
      textoAtividades: legacyStatus.texto_atividades ?? null,
      textoEstruturaApoio: legacyStatus.texto_estrutura_apoio ?? null,
    })

    return new NextResponse(Buffer.from(bytes), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="proposta.pdf"' }
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro ao gerar PDF' }, { status: 500 })
  }
}
