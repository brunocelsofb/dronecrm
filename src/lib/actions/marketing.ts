'use server'

import { revalidatePath } from 'next/cache'
import { getUserAccess } from '@/lib/auth/access'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { campaignCode, CHANNELS } from '@/lib/marketing/tracking'

type Result = { ok: true; id?: string } | { ok: false; error: string }

// Quem vê a aba Marketing (perfil + plano) gerencia campanhas
async function marketingUser() {
  const a = await getUserAccess()
  return a && a.features.includes('marketing') ? a : null
}

const STATUSES = ['planejada', 'ativa', 'pausada', 'encerrada']
const AUDIENCES = ['novos', 'clientes', 'ambos']
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

export type CampaignInput = {
  id?: string | null
  name: string
  channel: string
  audience: string
  status: string
  utm_campaign?: string | null
  objective?: string | null
  start_date?: string | null
  end_date?: string | null
  budget?: number | null
  owner_id?: string | null
  notes?: string | null
}

export async function saveCampaign(input: CampaignInput): Promise<Result> {
  const me = await marketingUser()
  if (!me) return { ok: false, error: 'Sem acesso à aba Marketing.' }
  const name = (input.name ?? '').trim().slice(0, 160)
  if (!name) return { ok: false, error: 'Dê um nome à campanha.' }
  if (!CHANNELS.some(c => c.id === input.channel)) return { ok: false, error: 'Canal inválido.' }
  if (!STATUSES.includes(input.status)) return { ok: false, error: 'Situação inválida.' }
  if (!AUDIENCES.includes(input.audience)) return { ok: false, error: 'Público inválido.' }
  const code = campaignCode(input.utm_campaign?.trim() || name)
  if (!code) return { ok: false, error: 'Código do link inválido: use letras e números.' }
  const start = isDate(input.start_date) ? input.start_date! : null
  const end = isDate(input.end_date) ? input.end_date! : null
  if (start && end && end < start) return { ok: false, error: 'O fim é antes do início.' }
  const budget = input.budget === null || input.budget === undefined ? null : Number(input.budget)
  if (budget !== null && (!Number.isFinite(budget) || budget < 0)) return { ok: false, error: 'Verba inválida.' }

  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  if (input.owner_id) {
    const { data: owner } = await db.from('profiles').select('id').eq('id', input.owner_id).eq('tenant_id', tenantId).maybeSingle()
    if (!owner) return { ok: false, error: 'Responsável inválido.' }
  }
  const { data: clash } = await db.from('marketing_campaigns').select('id').eq('utm_campaign', code).maybeSingle()
  if (clash && clash.id !== input.id) return { ok: false, error: `O código "${code}" já é de outra campanha. Use outro.` }

  const row = {
    name, channel: input.channel, audience: input.audience, status: input.status, utm_campaign: code,
    objective: input.objective?.trim().slice(0, 500) || null, start_date: start, end_date: end,
    budget: budget === null ? null : Math.round(budget * 100) / 100,
    owner_id: input.owner_id || null, notes: input.notes?.trim().slice(0, 2000) || null,
    updated_at: new Date().toISOString(),
  }
  if (input.id) {
    const { data, error } = await db.from('marketing_campaigns').update(row).eq('id', input.id).select('id')
    if (error) return { ok: false, error: error.message }
    if (!data?.length) return { ok: false, error: 'Campanha não encontrada.' }
    revalidatePath('/marketing')
    return { ok: true, id: input.id }
  }
  const { data, error } = await db.from('marketing_campaigns').insert({ ...row, created_by: me.userId }).select('id').single()
  if (error || !data) return { ok: false, error: error?.message ?? 'Falha ao criar.' }
  revalidatePath('/marketing')
  return { ok: true, id: data.id }
}

export async function deleteCampaign(id: string): Promise<Result> {
  const me = await marketingUser()
  if (!me) return { ok: false, error: 'Sem acesso à aba Marketing.' }
  const db = await createScopedAdmin()
  const [{ count: leads }, { count: opps }] = await Promise.all([
    db.from('leads').select('id', { count: 'exact', head: true }).eq('campaign_id', id),
    db.from('contracts').select('id', { count: 'exact', head: true }).eq('campaign_id', id),
  ])
  if ((leads ?? 0) + (opps ?? 0) > 0) {
    return { ok: false, error: `A campanha tem ${leads ?? 0} lead(s) e ${opps ?? 0} oportunidade(s) ligados. Para não perder o histórico, mude a situação para "Encerrada".` }
  }
  const { error } = await db.from('marketing_campaigns').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/marketing')
  return { ok: true }
}

// Investimento do mês (substitui o valor do mês; 0 apaga)
export async function saveCampaignCost(input: { campaignId: string; year: number; month: number; amount: number }): Promise<Result> {
  const me = await marketingUser()
  if (!me) return { ok: false, error: 'Sem acesso à aba Marketing.' }
  const { campaignId, year, month } = input
  const amount = Math.round(Number(input.amount) * 100) / 100
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) return { ok: false, error: 'Mês inválido.' }
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: 'Valor inválido.' }
  const db = await createScopedAdmin()
  const { data: camp } = await db.from('marketing_campaigns').select('id').eq('id', campaignId).maybeSingle()
  if (!camp) return { ok: false, error: 'Campanha não encontrada.' }
  if (amount === 0) {
    const { error } = await db.from('marketing_campaign_costs').delete().eq('campaign_id', campaignId).eq('year', year).eq('month', month)
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await db.from('marketing_campaign_costs')
      .upsert({ campaign_id: campaignId, year, month, amount, created_by: me.userId }, { onConflict: 'campaign_id,year,month' })
    if (error) return { ok: false, error: error.message }
  }
  revalidatePath('/marketing')
  return { ok: true }
}

// Liga (ou desliga) a campanha de um lead ou de uma oportunidade
export async function setRecordCampaign(input: { kind: 'lead' | 'contract'; id: string; campaignId: string | null }): Promise<Result> {
  const a = await getUserAccess()
  const need = input.kind === 'lead' ? 'leads' : 'contracts'
  if (!a || !(a.features.includes('marketing') || a.features.includes(need))) return { ok: false, error: 'Sem acesso.' }
  const db = await createScopedAdmin()
  if (input.campaignId) {
    const { data: camp } = await db.from('marketing_campaigns').select('id').eq('id', input.campaignId).maybeSingle()
    if (!camp) return { ok: false, error: 'Campanha não encontrada.' }
  }
  const table = input.kind === 'lead' ? 'leads' : 'contracts'
  const { data, error } = await db.from(table).update({ campaign_id: input.campaignId }).eq('id', input.id).select('id')
  if (error) return { ok: false, error: error.message }
  if (!data?.length) return { ok: false, error: 'Registro não encontrado.' }
  revalidatePath('/marketing')
  revalidatePath(input.kind === 'lead' ? `/leads/${input.id}` : `/contracts/${input.id}`)
  return { ok: true }
}
