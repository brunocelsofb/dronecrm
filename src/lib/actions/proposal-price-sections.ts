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
  revalidatePath('/settings/propostas')
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

// Admin: regras da proposta (Configurações → Propostas)
export async function saveProposalSettings(input: { techApproval: boolean }): Promise<Result> {
  const me = await getCurrentProfile()
  if (me?.role !== 'admin') return { ok: false, error: 'Só o Admin altera as regras da proposta.' }
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const { error } = await db.from('organization_settings').update({ proposal_settings: { techApproval: !!input.techApproval } }).eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings/propostas')
  return { ok: true }
}

// ─── Itens lançados na montagem (empresas sem Price, ou proposta sem Price) ───
// O valor da proposta sai dos itens: soma dos recorrentes (MRR) ou, sem recorrentes, de todos.
// No funil de vendas também atualiza a previsão; o valor do contrato só muda na aprovação do cliente.
async function recalcProposalValue(db: Awaited<ReturnType<typeof createScopedAdmin>>, proposalId: string, contractId: string) {
  const { data: items } = await db.from('proposal_items').select('subtotal, type').eq('proposal_id', proposalId)
  const list = (items ?? []) as { subtotal: number; type: string | null }[]
  const mrr = list.filter(i => (i.type ?? 'MRR') === 'MRR')
  const value = Math.round((mrr.length ? mrr : list).reduce((s, i) => s + Number(i.subtotal || 0), 0) * 100) / 100
  await db.from('proposals').update({ proposal_value: value > 0 ? value : null, updated_at: new Date().toISOString() }).eq('id', proposalId)
  const { data: run } = await db.from('pipeline_runs').select('id, pipelines(type)').eq('contract_id', contractId).eq('status', 'open').maybeSingle()
  const type = (run as { pipelines?: { type?: string } | null } | null)?.pipelines?.type
  if (run && type !== 'gestao_contratos' && value > 0) await db.from('pipeline_runs').update({ value }).eq('id', (run as { id: string }).id)
  return value
}

export type ManualItemInput = { item: string; category?: string | null; characteristics?: string | null; quantity: number; unit_value: number; discount?: number; type: 'MRR' | 'Pontual' }

export async function addProposalItem(proposalId: string, input: ManualItemInput): Promise<{ ok: true; id: string; subtotal: number; value: number } | { ok: false; error: string }> {
  const { db, p } = await editableProposal(proposalId)
  if (!p || !canEdit(p)) return { ok: false, error: 'A montagem não pode mais ser alterada.' }
  const name = String(input.item ?? '').trim()
  const qty = Number(input.quantity), unit = Number(input.unit_value), disc = Number(input.discount ?? 0)
  if (!name) return { ok: false, error: 'Informe o item.' }
  if (!(qty > 0) || !(unit >= 0) || !(disc >= 0)) return { ok: false, error: 'Quantidade e valores precisam ser números positivos.' }
  const subtotal = Math.round((qty * unit - disc) * 100) / 100
  const { count } = await db.from('proposal_items').select('id', { count: 'exact', head: true }).eq('proposal_id', proposalId)
  const { data, error } = await db.from('proposal_items').insert({
    proposal_id: proposalId, position: count ?? 0, quantity: qty, category: input.category ?? null, item: name.slice(0, 300),
    characteristics: input.characteristics?.slice(0, 1000) ?? null, type: input.type === 'Pontual' ? 'Pontual' : 'MRR',
    delivery_forecast: null, unit_value: unit, discount: disc, subtotal,
  }).select('id').single()
  if (error || !data) return { ok: false, error: error?.message ?? 'Falha ao incluir o item.' }
  const value = await recalcProposalValue(db, proposalId, p.contract_id)
  revalidatePath(`/contracts/${p.contract_id}`)
  return { ok: true, id: data.id as string, subtotal, value }
}

export async function removeProposalItem(itemId: string, proposalId: string): Promise<{ ok: true; value: number } | { ok: false; error: string }> {
  const { db, p } = await editableProposal(proposalId)
  if (!p || !canEdit(p)) return { ok: false, error: 'A montagem não pode mais ser alterada.' }
  const { error } = await db.from('proposal_items').delete().eq('id', itemId).eq('proposal_id', proposalId)
  if (error) return { ok: false, error: error.message }
  const value = await recalcProposalValue(db, proposalId, p.contract_id)
  revalidatePath(`/contracts/${p.contract_id}`)
  return { ok: true, value }
}

// Montagem sem Price: começa pelas seções padrão (mesmas da apresentação do Price), em branco.
const DEFAULT_SECTIONS = [
  { key: 'objeto', title: 'Objeto do Contrato' },
  { key: 'escopo', title: 'Escopo do Contrato' },
  { key: 'equipe', title: 'Estrutura Humana' },
  { key: 'sla', title: 'Acordo de Nível de Serviço (SLA)' },
  { key: 'diretrizes', title: 'Diretrizes de Atendimento' },
]
export async function addDefaultSections(proposalId: string): Promise<Result> {
  const { db, tenantId, p } = await editableProposal(proposalId)
  if (!p || !canEdit(p)) return { ok: false, error: 'A montagem não pode mais ser alterada.' }
  const { data: existing } = await db.from('proposal_content_blocks').select('section_key, position').eq('proposal_id', proposalId)
  const have = new Set(((existing ?? []) as { section_key: string | null }[]).map(b => b.section_key))
  const { data: org } = await db.from('organization_settings').select('proposal_brand_color').eq('tenant_id', tenantId).maybeSingle()
  const start = (existing ?? []).length
  const rows = DEFAULT_SECTIONS.filter(s => !have.has(s.key)).map((s, i) => ({
    proposal_id: proposalId, tenant_id: tenantId, source: 'modelo', section_key: s.key, title: s.title,
    block_type: 'text', introduction: null, table_data: null, header_color: org?.proposal_brand_color || '#1B556B',
    text_align: 'left', show_totals: false, position: start + i,
  }))
  if (!rows.length) return { ok: true, created: 0 }
  const { error } = await db.from('proposal_content_blocks').insert(rows)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/contracts/${p.contract_id}/proposals/${proposalId}`)
  return { ok: true, created: rows.length }
}
