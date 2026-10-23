'use server'

// ─── Varejo: ações do funil da loja ───────────────────────────────────────────
// Mudar de etapa usa a mesma regra dos pedidos (estoque, fidelidade); aqui só
// entram o lembrete de recuperação, o "perdido" com motivo e os prazos.

import { revalidatePath } from 'next/cache'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { updateRetailOrderStatus } from '@/lib/actions/retail-orders'
import { customOf, isLostReason, readFunnel, readFunnelLayout, MAX_CUSTOM_STAGES, type FunnelLayout, type FunnelSettings } from '@/lib/retail/funnel'

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string }

async function guard(adminOnly = false): Promise<{ tenantId: string } | { error: string }> {
  const access = await hasFeature('varejo')
  if (!access) return { error: 'Sem acesso ao módulo Varejo.' }
  if (await getSupportSession()) return { error: 'Acesso de suporte é só leitura.' }
  if (adminOnly && !access.isAdmin) return { error: 'Só o administrador muda o funil.' }
  return { tenantId: await requireTenantId() }
}

// A equipe abriu o WhatsApp com a mensagem de recuperação: registra o lembrete
export async function registerRetailNudge(orderId: string): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const db = await createScopedAdmin(g.tenantId)
  const { data: o } = await db.from('retail_orders').select('id, nudge_count, status').eq('id', orderId).maybeSingle()
  if (!o) return { ok: false, error: 'Pedido não encontrado.' }
  const { error } = await db.from('retail_orders').update({ last_nudge_at: new Date().toISOString(), nudge_count: Number(o.nudge_count ?? 0) + 1 }).eq('id', orderId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/varejo/funil')
  return { ok: true }
}

// Carrinho → Em atendimento e os demais avanços (mesma regra da tela do pedido)
export async function moveRetailFunnel(orderId: string, status: string): Promise<Result> {
  const r = await updateRetailOrderStatus(orderId, status)
  if (r.ok) revalidatePath('/varejo/funil')
  return r
}

// Perdido = cancelado com motivo (devolve estoque e desfaz a fidelidade, se houver)
export async function markRetailOrderLost(orderId: string, reason: string): Promise<Result> {
  if (!isLostReason(reason)) return { ok: false, error: 'Escolha o motivo.' }
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const r = await updateRetailOrderStatus(orderId, 'cancelado')
  if (!r.ok) return r
  const db = await createScopedAdmin(g.tenantId)
  const { error } = await db.from('retail_orders').update({ lost_reason: reason }).eq('id', orderId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/varejo/funil')
  return { ok: true }
}

export async function saveRetailFunnelSettings(input: FunnelSettings): Promise<Result> {
  const g = await guard(true)
  if ('error' in g) return { ok: false, error: g.error }
  const clean = readFunnel(input)
  const bad = (Object.keys(clean) as (keyof FunnelSettings)[]).find(k => Number(input[k]) !== clean[k])
  if (bad) return { ok: false, error: bad === 'lost_suggest_days' ? 'Use de 1 a 90 dias.' : 'Use de 1 a 720 horas.' }
  const db = await createScopedAdmin(g.tenantId)
  const { data: org } = await db.from('organization_settings').select('retail_settings').eq('tenant_id', g.tenantId).maybeSingle()
  const rs = ((org as { retail_settings?: Record<string, unknown> } | null)?.retail_settings ?? {}) as Record<string, unknown>
  const merged = { ...rs, funnel: { ...((rs.funnel as Record<string, unknown> | undefined) ?? {}), ...clean } }
  const { error } = await db.from('organization_settings').update({ retail_settings: merged }).eq('tenant_id', g.tenantId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/varejo/funil')
  return { ok: true }
}

// Etapas do funil: renomear, esconder as opcionais e criar etapas próprias (sem automação)
export async function saveRetailFunnelLayout(input: FunnelLayout): Promise<Result> {
  const g = await guard(true)
  if ('error' in g) return { ok: false, error: g.error }
  const clean = readFunnelLayout(input)
  const wanted = Array.isArray(input?.custom) ? input.custom.length : 0
  if (wanted > MAX_CUSTOM_STAGES) return { ok: false, error: `Até ${MAX_CUSTOM_STAGES} etapas próprias.` }
  if (clean.custom.length !== wanted) return { ok: false, error: 'Dê um nome a cada etapa nova (até 40 letras). Prazo: de 1 a 720 horas ou vazio.' }
  const db = await createScopedAdmin(g.tenantId)
  const { data: org } = await db.from('organization_settings').select('retail_settings').eq('tenant_id', g.tenantId).maybeSingle()
  const rs = ((org as { retail_settings?: Record<string, unknown> } | null)?.retail_settings ?? {}) as Record<string, unknown>
  const prevFunnel = (rs.funnel as Record<string, unknown> | undefined) ?? {}
  const prev = readFunnelLayout(prevFunnel)
  const { error } = await db.from('organization_settings').update({ retail_settings: { ...rs, funnel: { ...prevFunnel, ...clean } } }).eq('tenant_id', g.tenantId)
  if (error) return { ok: false, error: error.message }
  // Etapa própria apagada ou movida: os pedidos dela voltam para a etapa fixa
  const gone = prev.custom.filter(c => !clean.custom.some(x => x.id === c.id && x.base === c.base)).map(c => c.id)
  if (gone.length) await db.from('retail_orders').update({ custom_stage: null, custom_stage_at: null }).in('custom_stage', gone)
  revalidatePath('/varejo/funil')
  return { ok: true }
}

// Pedido entra (ou sai) de uma etapa própria da loja; não muda a situação nem dispara automação
export async function setRetailCustomStage(orderId: string, customId: string | null): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const db = await createScopedAdmin(g.tenantId)
  const [{ data: o }, { data: org }] = await Promise.all([
    db.from('retail_orders').select('id, status, proposal_sent_at, proposal_accepted_at').eq('id', orderId).maybeSingle(),
    db.from('organization_settings').select('retail_settings').eq('tenant_id', g.tenantId).maybeSingle(),
  ])
  if (!o) return { ok: false, error: 'Pedido não encontrado.' }
  if (customId) {
    const layout = readFunnelLayout(((org as { retail_settings?: Record<string, unknown> } | null)?.retail_settings ?? {}).funnel)
    if (!customOf({ ...o, custom_stage: customId } as Parameters<typeof customOf>[0], layout)) return { ok: false, error: 'Esta etapa não vale para a situação atual do pedido.' }
  }
  const { error } = await db.from('retail_orders').update({ custom_stage: customId, custom_stage_at: customId ? new Date().toISOString() : null }).eq('id', orderId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/varejo/funil')
  return { ok: true }
}
