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
import { isLostReason, readFunnel, type FunnelSettings } from '@/lib/retail/funnel'

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string }

async function guard(adminOnly = false): Promise<{ tenantId: string } | { error: string }> {
  const access = await hasFeature('varejo')
  if (!access) return { error: 'Sem acesso ao módulo Varejo.' }
  if (await getSupportSession()) return { error: 'Acesso de suporte é só leitura.' }
  if (adminOnly && !access.isAdmin) return { error: 'Só o administrador muda os prazos do funil.' }
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
  const merged = { ...((org as { retail_settings?: Record<string, unknown> } | null)?.retail_settings ?? {}), funnel: clean }
  const { error } = await db.from('organization_settings').update({ retail_settings: merged }).eq('tenant_id', g.tenantId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/varejo/funil')
  return { ok: true }
}
