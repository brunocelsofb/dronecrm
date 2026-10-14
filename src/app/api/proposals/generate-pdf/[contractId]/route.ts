import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { resolveTenantId } from '@/lib/tenant/context'

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

  const admin = createAdminClient()

  // 1. Busca proposta (novo modelo ou legado)
  let serviceType = 'clinica'
  if (proposalId) {
    const { data } = await admin.from('proposals').select('template_service_type').eq('id', proposalId).maybeSingle()
    serviceType = data?.template_service_type ?? 'clinica'
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
      const { data } = await admin.storage.from('proposal-files').download(storagePath)
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
