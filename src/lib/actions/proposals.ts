'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTenantId, requireTenantId } from '@/lib/tenant/context'
import { tenantStoragePathFor } from '@/lib/utils/storage'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export type ActionState = { error?: string }

// ------------------------------------------------------------
// Catálogo de produtos/serviços — cadastra uma vez, escolhe na hora de
// montar a proposta, em vez de digitar tudo do zero sempre.
// ------------------------------------------------------------
export async function createCatalogItem(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  const name = (formData.get('name') as string)?.trim()
  const category = (formData.get('category') as string) || null
  const type = (formData.get('type') as string) || null
  const characteristics = (formData.get('characteristics') as string) || null
  const unit_value = Number(formData.get('unit_value')) || 0

  if (!name) return { error: 'Nome do item é obrigatório.' }

  const { error } = await supabase.from('proposal_catalog_items').insert({
    name,
    category,
    type,
    characteristics,
    unit_value,
    created_by: user.id,
  })

  if (error) return { error: error.message }
  revalidatePath('/proposals/catalog')
  return {}
}

export async function deleteCatalogItem(itemId: string) {
  const supabase = (await createScopedAdmin())
  await supabase.from('proposal_catalog_items').delete().eq('id', itemId)
  revalidatePath('/proposals/catalog')
}

// ------------------------------------------------------------
// Modelos de página (capas)
// ------------------------------------------------------------
export async function registerProposalTemplate(name: string, filePath: string, fileName: string, pageCount: number): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  const { error } = await supabase.from('proposal_templates').insert({
    name,
    file_storage_path: filePath,
    file_name: fileName,
    page_count: pageCount,
    created_by: user.id,
  })

  if (error) return { error: error.message }
  revalidatePath('/proposals/templates')
  return {}
}

export async function deleteProposalTemplate(templateId: string) {
  const supabase = (await createScopedAdmin())
  await supabase.from('proposal_templates').delete().eq('id', templateId)
  revalidatePath('/proposals/templates')
}

// ------------------------------------------------------------
// Criar proposta (rascunho)
// ------------------------------------------------------------
async function generateControlCode(): Promise<string> {
  const supabase = (await createScopedAdmin())
  const year = new Date().getFullYear()

  const { data: seqValue } = await supabase.rpc('next_proposal_number_for_year', { p_year: year })

  const { data: settings } = await supabase.from('organization_settings').select('proposal_number_prefix').eq('tenant_id', await resolveTenantId()).maybeSingle()
  const prefix = settings?.proposal_number_prefix || 'PROP'

  return `${prefix}-${year}-${String(seqValue).padStart(4, '0')}`
}

export type ProposalItemInput = {
  quantity: number
  category: string
  item: string
  characteristics: string
  type: string
  delivery_forecast: string
  unit_value: number
  discount: number
}

export async function createProposal(
  contractId: string,
  currency: string,
  clientPoNumber: string | null,
  validUntil: string | null,
  items: ProposalItemInput[],
  discountType: 'percentage' | 'fixed' | null,
  discountValue: number,
  paymentTerms: string | null,
  installments: number,
  isRecurring: boolean
): Promise<{ error?: string; proposalId?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  if (items.length === 0) return { error: 'Adicione pelo menos um item à proposta.' }

  // Tenta algumas vezes se o código colidir (sequência fora de
  // sincronia) — pega o próximo disponível sozinho, sem travar.
  let proposal: { id: string; control_code: string } | null = null
  let lastError: { code?: string; message: string } | null = null

  for (let attempt = 0; attempt < 5; attempt++) {
    const controlCode = await generateControlCode()
    const result = await supabase
      .from('proposals')
      .insert({
        contract_id: contractId,
        control_code: controlCode,
        currency,
        client_po_number: clientPoNumber,
        valid_until: validUntil,
        discount_type: discountType,
        discount_value: discountValue,
        payment_terms: paymentTerms,
        installments,
        is_recurring: isRecurring,
        created_by: user.id,
      })
      .select('id, control_code')
      .single()

    if (!result.error) {
      proposal = result.data
      break
    }
    lastError = result.error
    if (result.error.code !== '23505') break
  }

  if (!proposal) return { error: lastError?.message ?? 'Falha ao criar proposta depois de várias tentativas.' }

  const itemRows = items.map((it, i) => ({
    proposal_id: proposal.id,
    position: i,
    quantity: it.quantity,
    category: it.category,
    item: it.item,
    characteristics: it.characteristics,
    type: it.type,
    delivery_forecast: it.delivery_forecast,
    unit_value: it.unit_value,
    discount: it.discount,
    subtotal: it.quantity * it.unit_value - it.discount,
  }))

  const { error: itemsError } = await supabase.from('proposal_items').insert(itemRows)
  if (itemsError) return { error: itemsError.message }

  // Página única "Proposta padrão" por padrão — a ordem/capas são
  // ajustadas depois, na tela de montagem.
  await supabase.from('proposal_pages').insert({
    proposal_id: proposal.id,
    position: 0,
    is_standard_proposal: true,
  })

  await supabase.from('activities').insert({
    contract_id: contractId,
    user_id: user.id,
    type: 'system',
    content: `Proposta ${proposal.control_code} criada (rascunho).`,
  })

  revalidatePath(`/contracts/${contractId}`)
  return { proposalId: proposal.id }
}

export async function deleteProposal(proposalId: string, contractId: string) {
  const supabase = (await createScopedAdmin())
  await supabase.from('proposals').delete().eq('id', proposalId)
  revalidatePath(`/contracts/${contractId}`)
}

// Cria uma NOVA VERSÃO da proposta, copiando os itens da anterior (pra
// editar a partir daí) — usado quando o cliente negocia e pede ajuste,
// ou quando é declinada e precisa de uma versão nova.
export async function createProposalVersion(
  originalProposalId: string,
  contractId: string
): Promise<{ error?: string; proposalId?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  const { data: original } = await supabase.from('proposals').select('*').eq('id', originalProposalId).single()
  if (!original) return { error: 'Proposta original não encontrada.' }

  const { data: originalItems } = await supabase.from('proposal_items').select('*').eq('proposal_id', originalProposalId).order('position')
  const { data: originalPages } = await supabase.from('proposal_pages').select('*').eq('proposal_id', originalProposalId).order('position')

  const controlCode = `${original.control_code.split('-v')[0]}-v${original.version + 1}`

  const { data: newProposal, error } = await supabase
    .from('proposals')
    .insert({
      contract_id: contractId,
      control_code: controlCode,
      version: original.version + 1,
      currency: original.currency,
      client_po_number: original.client_po_number,
      valid_until: original.valid_until,
      created_by: user.id,
    })
    .select()
    .single()

  if (error || !newProposal) return { error: error?.message ?? 'Falha ao criar nova versão.' }

  if (originalItems && originalItems.length > 0) {
    await supabase.from('proposal_items').insert(
      originalItems.map((it) => ({
        proposal_id: newProposal.id,
        position: it.position,
        quantity: it.quantity,
        category: it.category,
        item: it.item,
        characteristics: it.characteristics,
        type: it.type,
        delivery_forecast: it.delivery_forecast,
        unit_value: it.unit_value,
        discount: it.discount,
        subtotal: it.subtotal,
      }))
    )
  }

  if (originalPages && originalPages.length > 0) {
    await supabase.from('proposal_pages').insert(
      originalPages.map((p) => ({
        proposal_id: newProposal.id,
        position: p.position,
        template_id: p.template_id,
        is_standard_proposal: p.is_standard_proposal,
      }))
    )
  } else {
    await supabase.from('proposal_pages').insert({ proposal_id: newProposal.id, position: 0, is_standard_proposal: true })
  }

  await supabase.from('activities').insert({
    contract_id: contractId,
    user_id: user.id,
    type: 'system',
    content: `Nova versão da proposta criada: ${controlCode} (baseada em ${original.control_code}).`,
  })

  revalidatePath(`/contracts/${contractId}`)
  return { proposalId: newProposal.id }
}

// ------------------------------------------------------------
// Blocos de conteúdo extra (imagem/tabela) — pra não ficar preso só nas
// capas fixas, dá pra colar uma imagem ou montar uma tabela em
// qualquer ponto da proposta.
// ------------------------------------------------------------
export async function addImageBlock(proposalId: string, contractId: string, storagePath: string, imageSize = 'medium'): Promise<ActionState & { id?: string }> {
  const supabase = await createClient()
  const { count } = await supabase.from('proposal_content_blocks').select('id', { count: 'exact', head: true }).eq('proposal_id', proposalId)
  const { data, error } = await supabase.from('proposal_content_blocks').insert({
    proposal_id: proposalId, position: count ?? 0, block_type: 'image',
    image_storage_path: storagePath, image_size: imageSize,
  }).select('id').single()
  if (error) return { error: error.message }
  revalidatePath(`/contracts/${contractId}/proposals/${proposalId}`)
  return { id: data?.id }
}

export async function addTableBlock(proposalId: string, contractId: string, tableData: string[][], headerColor = '#1B556B', showTotals = false, textAlign = 'left'): Promise<ActionState & { id?: string }> {
  const supabase = await createClient()
  const { count } = await supabase.from('proposal_content_blocks').select('id', { count: 'exact', head: true }).eq('proposal_id', proposalId)
  const { data, error } = await supabase.from('proposal_content_blocks').insert({
    proposal_id: proposalId, position: count ?? 0, block_type: 'table',
    table_data: { rows: tableData }, header_color: headerColor,
    show_totals: showTotals, text_align: textAlign,
  }).select('id').single()
  if (error) return { error: error.message }
  revalidatePath(`/contracts/${contractId}/proposals/${proposalId}`)
  return { id: data?.id }
}

export async function updateBlockIntroduction(blockId: string, introduction: string): Promise<void> {
  const supabase = (await createScopedAdmin())
  await supabase.from('proposal_content_blocks').update({ introduction }).eq('id', blockId)
}

export async function updateTableBlock(blockId: string, tableData: string[][], headerColor: string, showTotals: boolean, textAlign: string): Promise<ActionState> {
  const supabase = (await createScopedAdmin())
  const { error } = await supabase.from('proposal_content_blocks').update({
    table_data: { rows: tableData },
    header_color: headerColor,
    show_totals: showTotals,
    text_align: textAlign,
  }).eq('id', blockId)
  if (error) return { error: error.message }
  return {}
}

export async function deleteContentBlock(blockId: string, contractId: string, proposalId: string) {
  const supabase = (await createScopedAdmin())
  await supabase.from('proposal_content_blocks').delete().eq('id', blockId)
  revalidatePath(`/contracts/${contractId}/proposals/${proposalId}`)
}

// ------------------------------------------------------------
// Envio pra aprovação técnica (sai de rascunho)
// ------------------------------------------------------------
export async function submitForTechnicalApproval(
  proposalId: string,
  contractId: string,
  technicalApproverId: string
): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }
  if (!technicalApproverId) return { error: 'Escolha quem vai fazer a pré-aprovação técnica.' }

  await supabase
    .from('proposals')
    .update({ status: 'pending_technical', assigned_technical_approver_id: technicalApproverId, updated_at: new Date().toISOString() })
    .eq('id', proposalId)

  // Notifica SÓ a pessoa escolhida — não o departamento inteiro.
  await supabase.from('notifications').insert({
    user_id: technicalApproverId,
    contract_id: contractId,
    message: 'Uma proposta comercial foi designada pra sua pré-aprovação técnica.',
  })

  const { data: approver } = await supabase.from('profiles').select('full_name').eq('id', technicalApproverId).maybeSingle()

  await supabase.from('activities').insert({
    contract_id: contractId,
    user_id: user.id,
    type: 'system',
    content: `Proposta enviada para pré-aprovação técnica de ${approver?.full_name ?? 'alguém'}.`,
  })

  revalidatePath(`/contracts/${contractId}`)
  return {}
}

// ------------------------------------------------------------
// Decisão interna (técnico ou comercial) — comentário SEMPRE obrigatório
// ------------------------------------------------------------
export async function decideInternalApproval(
  proposalId: string,
  contractId: string,
  stage: 'technical' | 'commercial',
  decision: 'approved' | 'declined',
  comment: string,
  nextApproverId?: string
): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  if (!comment.trim()) {
    return { error: 'O comentário é obrigatório pra aprovar ou declinar.' }
  }

  // Só quem foi DESIGNADO pra essa etapa (ou admin) pode decidir — é
  // isso que garante que o aprovador é escolhido, não "quem chegar
  // primeiro" no departamento inteiro.
  const [{ data: proposalForCheck }, { data: profile }] = await Promise.all([
    supabase.from('proposals').select('assigned_technical_approver_id, assigned_commercial_approver_id').eq('id', proposalId).single(),
    supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
  ])

  const assignedId = stage === 'technical' ? proposalForCheck?.assigned_technical_approver_id : proposalForCheck?.assigned_commercial_approver_id
  const isAssigned = assignedId === user.id
  const isAdmin = profile?.role === 'admin'

  if (!isAssigned && !isAdmin) {
    return { error: 'Só a pessoa designada pra essa aprovação (ou um admin) pode decidir.' }
  }

  if (stage === 'technical' && decision === 'approved' && !nextApproverId) {
    return { error: 'Escolha quem vai fazer a aprovação comercial.' }
  }

  const { error: approvalError } = await supabase.from('proposal_approvals').insert({
    proposal_id: proposalId,
    stage,
    decision,
    comment,
    decided_by: user.id,
  })
  if (approvalError) return { error: approvalError.message }

  const stageLabel = stage === 'technical' ? 'Pré-aprovação técnica' : 'Aprovação comercial'
  const decisionLabel = decision === 'approved' ? 'APROVADA' : 'DECLINADA'

  await supabase.from('activities').insert({
    contract_id: contractId,
    user_id: user.id,
    type: 'system',
    content: `${stageLabel}: ${decisionLabel}. Comentário: "${comment}"`,
  })

  if (decision === 'declined') {
    await supabase.from('proposals').update({ status: 'declined_internal', updated_at: new Date().toISOString() }).eq('id', proposalId)
    revalidatePath(`/contracts/${contractId}`)
    return {}
  }

  // Aprovado: técnico → passa pro comercial ESCOLHIDO; comercial → gera
  // o PDF e abre pro cliente.
  if (stage === 'technical') {
    await supabase
      .from('proposals')
      .update({ status: 'pending_commercial', assigned_commercial_approver_id: nextApproverId, updated_at: new Date().toISOString() })
      .eq('id', proposalId)

    await supabase.from('notifications').insert({
      user_id: nextApproverId!,
      contract_id: contractId,
      message: 'Uma proposta teve ciência técnica — foi designada pra sua aprovação comercial.',
    })
  } else {
    const result = await generateProposalPdf(proposalId, contractId)
    if (result.error) return { error: result.error }
  }

  revalidatePath(`/contracts/${contractId}`)
  return {}
}

// ------------------------------------------------------------
// Geração do PDF final: mescla capas + página da proposta padrão, na
// ordem configurada — e abre o link público pro cliente.
// ------------------------------------------------------------
export async function generateProposalPdf(proposalId: string, contractId: string): Promise<ActionState> {
  const { buildMergedProposalBytes } = await import('./proposal-pdf-merge')
  const supabase = (await createScopedAdmin())

  const { data: proposal } = await supabase.from('proposals').select('control_code, version').eq('id', proposalId).single()
  if (!proposal) return { error: 'Proposta não encontrada.' }

  const { bytes, error: buildError } = await buildMergedProposalBytes(proposalId)
  if (buildError || !bytes) return { error: buildError ?? 'Falha ao gerar PDF.' }

  const finalPath = tenantStoragePathFor(await requireTenantId(), `generated/${proposalId}-v${proposal.version}-${Date.now()}.pdf`)

  const { error: uploadError } = await supabase.storage
    .from('proposal-files')
    .upload(finalPath, bytes, { contentType: 'application/pdf' })

  if (uploadError) return { error: `Falha ao salvar PDF: ${uploadError.message}` }

  const token = crypto.randomUUID()

  await supabase
    .from('proposals')
    .update({
      status: 'pending_client',
      pdf_storage_path: finalPath,
      token,
      updated_at: new Date().toISOString(),
    })
    .eq('id', proposalId)

  await supabase.from('activities').insert({
    contract_id: contractId,
    type: 'system',
    content: `PDF da proposta ${proposal.control_code} gerado. Link de aprovação disponível — copie e envie pro cliente.`,
  })

  return {}
}

// ------------------------------------------------------------
// Montagem das páginas (ordem das capas + posição da proposta padrão)
// ------------------------------------------------------------
export async function setProposalPageOrder(
  proposalId: string,
  contractId: string,
  pages: { position: number; templateId: string | null; isStandardProposal: boolean }[]
): Promise<ActionState> {
  const supabase = await createClient()

  await supabase.from('proposal_pages').delete().eq('proposal_id', proposalId)

  const { error } = await supabase.from('proposal_pages').insert(
    pages.map((p) => ({
      proposal_id: proposalId,
      position: p.position,
      template_id: p.templateId,
      is_standard_proposal: p.isStandardProposal,
    }))
  )

  if (error) return { error: error.message }

  revalidatePath(`/contracts/${contractId}/proposals/${proposalId}`)
  return {}
}

// ------------------------------------------------------------
// Decisão do CLIENTE (link público, sem login)
// ------------------------------------------------------------
export async function submitClientDecision(
  token: string,
  decision: 'approved' | 'declined',
  comment: string,
  signer?: { name: string; email: string; role: string; phone: string; cpf: string }
): Promise<ActionState> {
  const { isValidCPF } = await import('@/lib/utils/cpf')
  const supabase = (await createScopedAdmin())

  if (!comment.trim()) {
    return { error: 'O comentário é obrigatório.' }
  }

  const { data: proposal } = await supabase
    .from('proposals')
    .select('id, contract_id, status')
    .eq('token', token)
    .maybeSingle()

  if (!proposal) return { error: 'Link inválido.' }
  if (proposal.status !== 'pending_client') return { error: 'Esta proposta já foi respondida ou não está mais disponível.' }

  if (decision === 'approved') {
    if (!signer) return { error: 'Preencha os dados do assinante.' }
    if (!signer.name || !signer.email || !signer.role || !signer.phone || !signer.cpf) {
      return { error: 'Preencha todos os campos do assinante.' }
    }
    // REGRA CRÍTICA: nunca aceitar aprovação com CPF inválido — checado
    // de novo aqui no servidor (o front-end também valida, mas isso
    // sozinho nunca é confiável).
    if (!isValidCPF(signer.cpf)) {
      return { error: 'CPF inválido. Confira o número informado.' }
    }
  }

  const { error } = await supabase.from('proposal_approvals').insert({
    proposal_id: proposal.id,
    stage: 'client',
    decision,
    comment,
    signer_name: signer?.name ?? null,
    signer_email: signer?.email ?? null,
    signer_role: signer?.role ?? null,
    signer_phone: signer?.phone ?? null,
    signer_cpf: signer?.cpf ?? null,
  })
  if (error) return { error: error.message }

  await supabase
    .from('proposals')
    .update({ status: decision === 'approved' ? 'approved' : 'declined_client', updated_at: new Date().toISOString() })
    .eq('id', proposal.id)

  await supabase.from('activities').insert({
    contract_id: proposal.contract_id,
    type: 'system',
    content:
      decision === 'approved'
        ? `Cliente APROVOU a proposta. Assinado por ${signer?.name} (${signer?.role}). Comentário: "${comment}"`
        : `Cliente DECLINOU a proposta. Comentário: "${comment}"`,
  })

  return {}
}

export async function createProposalFromPrice(contractId: string): Promise<{ error?: string; proposalId?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const admin = (await createScopedAdmin())

  // Busca o snapshot do Price
  const { data: proposalStatus } = await admin
    .from('proposal_status')
    .select('proposal_value, proposal_validity_days')
    .eq('contract_id', contractId)
    .maybeSingle()

  if (!proposalStatus?.proposal_value) return { error: 'Envie o valor do Price antes de gerar a proposta.' }

  // Gera código de controle
  const controlCode = await generateControlCode()

  // Calcula data de validade
  const validDays = proposalStatus.proposal_validity_days ?? 30
  const validUntil = new Date(Date.now() + validDays * 86400000).toISOString().split('T')[0]

  // Cria a proposta
  const { data: proposal, error: propError } = await supabase
    .from('proposals')
    .insert({
      contract_id: contractId,
      control_code: controlCode,
      currency: 'BRL',
      valid_until: validUntil,
      is_recurring: true,
      created_by: user.id,
    })
    .select('id, control_code')
    .single()

  if (propError || !proposal) return { error: propError?.message ?? 'Falha ao criar proposta.' }

  // Busca todos os templates na ordem
  const { data: templates } = await admin
    .from('proposal_templates')
    .select('id, name, page_count')
    .order('created_at')

  // Monta as páginas: todos os templates em ordem, com miolo após o penúltimo
  // (antes das páginas "Final")
  const pages: { proposal_id: string; position: number; template_id?: string; is_standard_proposal?: boolean }[] = []
  let position = 0

  if (templates && templates.length > 0) {
    // Separa finais (nome começa com "Final") dos demais
    const capas = templates.filter(t => !t.name.toLowerCase().startsWith('final'))
    const finais = templates.filter(t => t.name.toLowerCase().startsWith('final'))

    // Capas
    for (const t of capas) {
      pages.push({ proposal_id: proposal.id, position: position++, template_id: t.id, is_standard_proposal: false })
    }

    // Miolo (proposta padrão com dados do Price)
    pages.push({ proposal_id: proposal.id, position: position++, is_standard_proposal: true })

    // Finais
    for (const t of finais) {
      pages.push({ proposal_id: proposal.id, position: position++, template_id: t.id, is_standard_proposal: false })
    }
  } else {
    // Sem templates — só o miolo
    pages.push({ proposal_id: proposal.id, position: 0, is_standard_proposal: true })
  }

  const { error: pagesError } = await admin.from('proposal_pages').insert(pages)
  if (pagesError) return { error: `Falha ao criar páginas: ${pagesError.message}` }

  await supabase.from('activities').insert({
    contract_id: contractId,
    user_id: user.id,
    type: 'proposal',
    content: `Proposta ${controlCode} criada automaticamente a partir do ORBIS Price.`,
  })

  revalidatePath(`/contracts/${contractId}`)
  return { proposalId: proposal.id }
}
