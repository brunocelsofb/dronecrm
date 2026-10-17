'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { getUserAccess } from '@/lib/auth/access'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { integrationDef } from '@/lib/marketing/integrations'

type Result = { ok: true } | { ok: false; error: string }

// Integrações são configuradas só pelo Admin (Configurações → Integrações)
async function allowed() {
  const a = await getUserAccess()
  return a && a.isAdmin ? a : null
}

const newKey = () => randomBytes(24).toString('hex')

export async function activateIntegration(kind: string): Promise<Result> {
  const me = await allowed()
  if (!me) return { ok: false, error: 'Só o Admin configura integrações.' }
  const def = integrationDef(kind)
  if (!def) return { ok: false, error: 'Integração desconhecida.' }
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const { data: existing } = await db.from('lead_integrations').select('id').eq('kind', kind).maybeSingle()
  if (existing) {
    const { error } = await db.from('lead_integrations').update({ active: true, updated_at: new Date().toISOString() }).eq('id', existing.id)
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await db.from('lead_integrations').insert({ kind, name: def.name, key: newKey(), created_by: me.userId })
    if (error) return { ok: false, error: error.message }
  }
  revalidatePath('/marketing')
  return { ok: true }
}

export async function setIntegrationActive(id: string, active: boolean): Promise<Result> {
  if (!(await allowed())) return { ok: false, error: 'Só o Admin configura integrações.' }
  const db = await createScopedAdmin()
  const { data, error } = await db.from('lead_integrations').update({ active, updated_at: new Date().toISOString() }).eq('id', id).select('id')
  if (error) return { ok: false, error: error.message }
  if (!data?.length) return { ok: false, error: 'Integração não encontrada.' }
  revalidatePath('/marketing')
  return { ok: true }
}

// Nova chave: o endereço antigo para de funcionar (use se o endereço vazou)
export async function rotateIntegrationKey(id: string): Promise<Result> {
  if (!(await allowed())) return { ok: false, error: 'Só o Admin configura integrações.' }
  const db = await createScopedAdmin()
  const { data, error } = await db.from('lead_integrations').update({ key: newKey(), updated_at: new Date().toISOString() }).eq('id', id).select('id')
  if (error) return { ok: false, error: error.message }
  if (!data?.length) return { ok: false, error: 'Integração não encontrada.' }
  revalidatePath('/marketing')
  return { ok: true }
}

// Campanha padrão (leads sem código de campanha) e, no botão de WhatsApp, número e mensagem
export async function saveIntegrationSettings(id: string, input: { campaign_id?: string | null; phone?: string | null; message?: string | null }): Promise<Result> {
  if (!(await allowed())) return { ok: false, error: 'Só o Admin configura integrações.' }
  const db = await createScopedAdmin()
  const { data: it } = await db.from('lead_integrations').select('id, kind, settings').eq('id', id).maybeSingle()
  if (!it) return { ok: false, error: 'Integração não encontrada.' }
  const settings: Record<string, unknown> = { ...((it.settings as Record<string, unknown>) ?? {}) }
  if (input.campaign_id !== undefined) {
    if (input.campaign_id) {
      const { data: camp } = await db.from('marketing_campaigns').select('id').eq('id', input.campaign_id).maybeSingle()
      if (!camp) return { ok: false, error: 'Campanha não encontrada.' }
      settings.campaign_id = input.campaign_id
    } else delete settings.campaign_id
  }
  if (it.kind === 'whatsapp_button') {
    if (input.phone !== undefined) {
      const digits = (input.phone ?? '').replace(/\D/g, '')
      if (digits && (digits.length < 10 || digits.length > 13)) return { ok: false, error: 'Número inválido: use DDI + DDD + número (ex.: 5511999999999).' }
      settings.phone = digits ? (digits.length <= 11 ? `55${digits}` : digits) : null
    }
    if (input.message !== undefined) settings.message = (input.message ?? '').trim().slice(0, 300) || null
  }
  const { error } = await db.from('lead_integrations').update({ settings, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/marketing')
  return { ok: true }
}
