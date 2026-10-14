// Lógica de montagem do PDF, compartilhada entre:
// 1. generateProposalPdf (o PDF "oficial", salvo e vinculado ao link do
//    cliente, gerado só depois das aprovações internas)
// 2. a pré-visualização (gera na hora, não salva nada, disponível desde
//    o rascunho — pra conferir antes de mandar pra aprovação)
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTenantId } from '@/lib/tenant/context'

export async function buildMergedProposalBytes(proposalId: string): Promise<{ bytes?: Uint8Array; error?: string }> {
  const { PDFDocument } = await import('pdf-lib')
  const { buildStandardProposalPage } = await import('./proposal-pdf-builder')

  const supabase = createAdminClient()

  const { data: proposal } = await supabase.from('proposals').select('*').eq('id', proposalId).single()
  if (!proposal) return { error: 'Proposta não encontrada.' }

  const { data: pages } = await supabase
    .from('proposal_pages')
    .select('position, template_id, is_standard_proposal')
    .eq('proposal_id', proposalId)
    .order('position')

  const { data: items } = await supabase
    .from('proposal_items')
    .select('*')
    .eq('proposal_id', proposalId)
    .order('position')

  const { data: contract } = await supabase.from('contracts').select('*').eq('id', proposal.contract_id).single()
  const { data: company } = contract?.company_id
    ? await supabase.from('companies').select('*').eq('id', contract.company_id).maybeSingle()
    : { data: null }

  // Busca contato da empresa do cliente (não o responsável interno)
  // Prioridade: 1) contatos da empresa vinculada, 2) contact_id do contrato como fallback
  let contact = null
  if (company?.id) {
    const { data: companyContacts } = await supabase
      .from('contacts')
      .select('*')
      .eq('company_id', company.id)
      .order('created_at')
      .limit(1)
    contact = companyContacts?.[0] ?? null
  }
  // Fallback para contact_id se não há contatos da empresa
  if (!contact && contract?.contact_id) {
    const { data: fallbackContact } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', contract.contact_id)
      .maybeSingle()
    // Só usa se o contato pertence a uma empresa diferente da Orbis (evita puxar contato interno)
    if (fallbackContact?.company_id && fallbackContact.company_id !== contract.company_id) {
      contact = null // ignora contato interno
    } else {
      contact = fallbackContact
    }
  }

  const { data: orgSettings } = await supabase
    .from('organization_settings')
    .select('company_name, logo_storage_path, proposal_header_text, proposal_footer_text, proposal_brand_color')
    .eq('tenant_id', await resolveTenantId())
    .maybeSingle()

  let logoBytes: Uint8Array | null = null
  let logoIsPng = true
  if (orgSettings?.logo_storage_path) {
    const { data: logoFile } = await supabase.storage.from('proposal-files').download(orgSettings.logo_storage_path)
    if (logoFile) {
      logoBytes = new Uint8Array(await logoFile.arrayBuffer())
      logoIsPng = orgSettings.logo_storage_path.toLowerCase().endsWith('.png')
    }
  }

  const { data: createdByProfile } = proposal.created_by
    ? await supabase.from('profiles').select('full_name, email').eq('id', proposal.created_by).maybeSingle()
    : { data: null }

  const { data: rawContentBlocks } = await supabase
    .from('proposal_content_blocks')
    .select('block_type, image_storage_path, table_data, image_size, header_color, introduction, show_totals, text_align')
    .eq('proposal_id', proposalId)
    .order('position')

  const contentBlocks = await Promise.all(
    (rawContentBlocks ?? []).map(async (b) => {
      if (b.block_type === 'image' && b.image_storage_path) {
        const { data: imgFile } = await supabase.storage.from('proposal-files').download(b.image_storage_path)
        return {
          ...b,
          imageBytes: imgFile ? new Uint8Array(await imgFile.arrayBuffer()) : null,
          imageIsPng: b.image_storage_path.toLowerCase().endsWith('.png'),
          imageSize:   (b as any).image_size ?? 'medium',
          headerColor: (b as any).header_color ?? '#1B556B',
          textAlign:   (b as any).text_align   ?? 'left',
          showTotals:  (b as any).show_totals  ?? false,
        }
      }
      return {
        ...b,
        imageBytes: null,
        imageIsPng: true,
        headerColor: (b as any).header_color ?? '#1B556B',
        textAlign:   (b as any).text_align   ?? 'left',
        showTotals:  (b as any).show_totals  ?? false,
      }
    })
  )

  if (!pages || pages.length === 0) {
    return { error: 'Monte a ordem das páginas antes de visualizar (mesmo que só com a Proposta padrão).' }
  }

  try {
    const mergedPdf = await PDFDocument.create()

    // Busca snapshot do Price para usar no miolo
    const { data: proposalStatus } = await supabase
      .from('proposal_status')
      .select('*')
      .eq('contract_id', proposal.contract_id)
      .maybeSingle()

    for (const page of pages) {
      if (page.is_standard_proposal) {
        let standardPageBytes: Uint8Array

        if (proposalStatus?.technical_snapshot && (!items || items.length === 0)) {
          // Usa dados do Price
          const { buildPriceProposalPage } = await import('./proposal-pdf-from-price')
          standardPageBytes = await buildPriceProposalPage({
            snapshot: proposalStatus.technical_snapshot as any,
            proposalValue: Number(proposalStatus.proposal_value) || 0,
            validityDays: proposalStatus.proposal_validity_days ?? 30,
            submittedByName: proposalStatus.submitted_by_name ?? null,
            technicalApprovedByName: proposalStatus.technical_approved_by_name ?? null,
            technicalApprovedAt: proposalStatus.technical_approved_at ?? null,
            technicalComment: proposalStatus.technical_comment ?? null,
            commercialApprovedByName: proposalStatus.commercial_approved_by_name ?? null,
            commercialApprovedAt: proposalStatus.commercial_approved_at ?? null,
            contract: contract ? {
              client_name: contract.client_name,
              process_number: (contract as any).process_number ?? null,
              cnpj: (contract as any).cnpj ?? null,
            } : null,
          })
        } else {
          // Fallback: usa builder original com proposal_items
          standardPageBytes = await buildStandardProposalPage({
            proposal,
            items: items ?? [],
            company,
            contact,
            org: {
              companyName: orgSettings?.company_name ?? null,
              logoBytes,
              logoIsPng,
              createdByName: createdByProfile?.full_name ?? null,
              createdByEmail: createdByProfile?.email ?? null,
              headerText: orgSettings?.proposal_header_text ?? null,
              footerText: orgSettings?.proposal_footer_text ?? null,
              brandColor: orgSettings?.proposal_brand_color ?? '#1B556B',
            },
            contentBlocks,
          })
        }

        const standardDoc = await PDFDocument.load(standardPageBytes)
        const copied = await mergedPdf.copyPages(standardDoc, standardDoc.getPageIndices())
        copied.forEach((p) => mergedPdf.addPage(p))
      } else if (page.template_id) {
        const { data: template } = await supabase
          .from('proposal_templates')
          .select('file_storage_path')
          .eq('id', page.template_id)
          .maybeSingle()

        if (template) {
          const { data: fileData } = await supabase.storage.from('proposal-files').download(template.file_storage_path)
          if (fileData) {
            const templateBytes = new Uint8Array(await fileData.arrayBuffer())
            const templateDoc = await PDFDocument.load(templateBytes)
            const copied = await mergedPdf.copyPages(templateDoc, templateDoc.getPageIndices())
            copied.forEach((p) => mergedPdf.addPage(p))
          }
        }
      }
    }

    const bytes = await mergedPdf.save()
    return { bytes }
  } catch (e) {
    return { error: e instanceof Error ? `Falha ao montar PDF: ${e.message}` : 'Falha ao montar PDF.' }
  }
}
