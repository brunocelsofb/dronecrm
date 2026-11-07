import { storeDownload } from '@/lib/files/store'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ contractId: string }> }
) {
  const { contractId } = await params
  const { searchParams } = new URL(req.url)
  const proposalId = searchParams.get('proposal_id')

  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
  // O PDF tem os valores da proposta: só para quem vê valores
  {
    const { canSeeValues } = await import('@/lib/auth/access')
    if (!(await canSeeValues())) return NextResponse.json({ error: 'Sem acesso aos valores.' }, { status: 403 })
  }

  const admin = (await createScopedAdmin())

  // 1. Busca proposta (novo modelo ou legado)
  let serviceType = 'clinica'
  if (proposalId) {
    const { data } = await admin.from('proposals').select('template_service_type, proposal_value').eq('id', proposalId).maybeSingle()
    if (!data) return NextResponse.json({ error: 'Proposta não encontrada.' }, { status: 404 })
    // Sem precificação o PDF sairia zerado: primeiro o Price envia o valor
    if (!(Number(data.proposal_value) > 0)) {
      return new NextResponse(
        '<!doctype html><meta charset="utf-8"><title>Proposta sem precificação</title><body style="font-family:sans-serif;padding:32px;color:#1B556B"><h2>Proposta ainda sem precificação</h2><p>Abra o Price pela proposta, faça a precificação e clique em “Finalizar e Retornar ao CRM”. Depois disso o PDF fica disponível.</p></body>',
        { status: 409, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      )
    }
    serviceType = data.template_service_type ?? 'clinica'
  }

  // 2. Gera o miolo com o motor unificado
  let mioloBytes: Uint8Array
  try {
    if (proposalId) {
      const { buildMergedProposalBytes } = await import('@/lib/actions/proposal-pdf-merge')
      const result = await buildMergedProposalBytes(proposalId)
      if (!result.bytes) return NextResponse.json({ error: result.error ?? 'Erro ao gerar miolo' }, { status: 500 })
      mioloBytes = result.bytes
    } else {
      return NextResponse.json({ error: 'proposal_id obrigatório' }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro ao gerar miolo' }, { status: 500 })
  }

  // 3. Busca templates do service_type selecionado ordenados
  const { data: templates } = await admin.from('proposal_templates')
    .select('id, name, file_storage_path, sort_order, is_miolo_after, service_type')
    .eq('service_type', serviceType)
    .order('sort_order')

  // 4. Busca posição do miolo (start/end) caso nenhum template tenha is_miolo_after
  const { data: org } = await admin.from('organization_settings')
    .select('miolo_positions, client_name')
    .eq('tenant_id', await resolveTenantId({ contractId }))
    .maybeSingle()
  const mioloPositions = (org?.miolo_positions as Record<string, string>) ?? {}
  const specialMiolo = mioloPositions[serviceType] ?? null

  // 5. Merge com pdf-lib
  const { PDFDocument } = await import('pdf-lib')
  const merged = await PDFDocument.create()

  async function appendPdf(storagePath: string) {
    try {
      const { data } = await storeDownload('proposal-files', storagePath)
      if (!data) return
      const bytes = new Uint8Array(await data.arrayBuffer())
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
      const pages = await merged.copyPages(doc, doc.getPageIndices())
      pages.forEach(p => merged.addPage(p))
    } catch (e) {
      console.warn(`[generate-pdf] template ignorado: ${storagePath}`, e)
    }
  }

  async function appendMiolo() {
    const doc = await PDFDocument.load(mioloBytes)
    const pages = await merged.copyPages(doc, doc.getPageIndices())
    pages.forEach(p => merged.addPage(p))
  }

  const ordered = templates ?? []
  const mioloAfterIdx = ordered.findIndex(t => t.is_miolo_after)

  if (ordered.length === 0) {
    // Sem templates cadastrados — só o miolo
    await appendMiolo()
  } else if (specialMiolo === 'start') {
    await appendMiolo()
    for (const t of ordered) await appendPdf(t.file_storage_path)
  } else if (specialMiolo === 'end') {
    for (const t of ordered) await appendPdf(t.file_storage_path)
    await appendMiolo()
  } else if (mioloAfterIdx === -1) {
    // Sem posição definida — miolo no início
    await appendMiolo()
    for (const t of ordered) await appendPdf(t.file_storage_path)
  } else {
    // Miolo depois do template marcado
    for (let i = 0; i < ordered.length; i++) {
      await appendPdf(ordered[i].file_storage_path)
      if (i === mioloAfterIdx) await appendMiolo()
    }
  }

  const pdfBytes = await merged.save()

  const { data: proposalMeta } = await admin.from('proposals').select('control_code').eq('id', proposalId!).maybeSingle()
  const { data: contract } = await admin.from('contracts').select('client_name').eq('id', contractId).maybeSingle()
  const controlCode = proposalMeta?.control_code ?? 'PROP'
  const clientRaw = (contract?.client_name ?? '').replace(/[/\\?%*:|"<>]/g, '').trim() || contractId.slice(0, 8)
  const fileName = `${controlCode} - ${clientRaw}.pdf`

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    }
  })
}
