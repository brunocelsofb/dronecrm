'use server'
// Seções da "Apresentação ao Cliente" do Price dentro da proposta (ver lib/proposals/price-sections.ts)
import { revalidatePath } from 'next/cache'
import { getCurrentProfile } from '@/lib/auth/role'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { PRICE_SECTIONS, readApresentacao, sectionsToApply, writePriceBlocks } from '@/lib/proposals/price-sections'

type Result = { ok: true; created?: number } | { ok: false; error: string }

// Admin: quais seções do Price entram por padrão nas propostas desta empresa (null = todas)
export async function savePriceSections(keys: string[] | null): Promise<Result> {
  const me = await getCurrentProfile()
  if (me?.role !== 'admin') return { ok: false, error: 'Só o Admin altera esta configuração.' }
  const clean = keys === null ? null : [...new Set(keys.filter(k => PRICE_SECTIONS.some(p => p.key === k)))]
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const { error } = await db.from('organization_settings').update({ price_sections: clean }).eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings/empresa')
  return { ok: true }
}

// Mesma regra da tela: só rascunho e não encerrada pode mudar a montagem
const CLOSED = ['cliente_aprovado', 'cliente_recusado', 'declinada']
const canEdit = (p: { status: string; workflow_status: string | null }) => p.status === 'draft' && !CLOSED.includes(p.workflow_status ?? '')

async function editableProposal(proposalId: string) {
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const { data: p } = await db.from('proposals')
    .select('id, contract_id, status, workflow_status, technical_snapshot, price_sections_hidden')
    .eq('id', proposalId).maybeSingle()
  return { db, tenantId, p: p as null | { id: string; contract_id: string; status: string; workflow_status: string | null; technical_snapshot: unknown; price_sections_hidden: string[] | null } }
}

// Exclui um bloco da montagem; se veio do Price, a seção não volta ao reenviar do Price.
export async function removeProposalBlock(blockId: string, proposalId: string): Promise<Result> {
  const { db, p } = await editableProposal(proposalId)
  if (!p) return { ok: false, error: 'Proposta não encontrada.' }
  if (!canEdit(p)) return { ok: false, error: 'A montagem não pode mais ser alterada.' }
  const { data: b } = await db.from('proposal_content_blocks').select('id, source, section_key').eq('id', blockId).eq('proposal_id', proposalId).maybeSingle()
  if (!b) return { ok: false, error: 'Bloco não encontrado.' }
  const { error } = await db.from('proposal_content_blocks').delete().eq('id', blockId)
  if (error) return { ok: false, error: error.message }
  if (b.source === 'price' && b.section_key) {
    const hidden = [...new Set([...(p.price_sections_hidden ?? []), b.section_key])]
    await db.from('proposals').update({ price_sections_hidden: hidden }).eq('id', proposalId)
  }
  revalidatePath(`/contracts/${p.contract_id}/proposals/${proposalId}`)
  return { ok: true }
}

// "Trazer de volta": recria as seções do Price excluídas (a partir da última precificação enviada)
export async function restorePriceSections(proposalId: string): Promise<Result> {
  const { db, tenantId, p } = await editableProposal(proposalId)
  if (!p) return { ok: false, error: 'Proposta não encontrada.' }
  if (!canEdit(p)) return { ok: false, error: 'A montagem não pode mais ser alterada.' }
  const a = readApresentacao(p.technical_snapshot)
  if (!a) return { ok: false, error: 'Esta proposta ainda não recebeu a apresentação do Price. Abra o Price e clique em "Finalizar e Retornar ao CRM".' }
  const { data: org } = await db.from('organization_settings').select('price_sections, proposal_brand_color').eq('tenant_id', tenantId).maybeSingle()
  const secoes = sectionsToApply(a, (org?.price_sections as string[] | null) ?? null, [])
  const r = await writePriceBlocks(db, { proposalId, tenantId, secoes, headerColor: org?.proposal_brand_color, mode: 'missing' })
  if (r.error) return { ok: false, error: r.error }
  await db.from('proposals').update({ price_sections_hidden: [] }).eq('id', proposalId)
  revalidatePath(`/contracts/${p.contract_id}/proposals/${proposalId}`)
  return { ok: true, created: r.created }
}

export async function updateBlockTitle(blockId: string, proposalId: string, title: string): Promise<Result> {
  const { db, p } = await editableProposal(proposalId)
  if (!p || !canEdit(p)) return { ok: false, error: 'A montagem não pode mais ser alterada.' }
  const { error } = await db.from('proposal_content_blocks').update({ title: title.trim().slice(0, 200) || null }).eq('id', blockId).eq('proposal_id', proposalId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// Passe para abrir o Price por esta proposta (o Price devolve ao enviar a precificação)
export async function getPriceLinkToken(contractId: string, proposalId: string | null): Promise<string | null> {
  const me = await getCurrentProfile()
  if (!me) return null
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const { data: c } = await db.from('contracts').select('id').eq('id', contractId).maybeSingle()
  if (!c) return null
  if (proposalId) {
    const { data: p } = await db.from('proposals').select('id').eq('id', proposalId).eq('contract_id', contractId).maybeSingle()
    if (!p) return null
  }
  const { createPriceLinkToken } = await import('@/lib/proposals/price-link')
  return createPriceLinkToken(contractId, proposalId)
}
