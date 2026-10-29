'use server'

// ─── Varejo: campanhas da loja ───────────────────────────────────────────────
// Criar/editar a campanha, enviar a mensagem para cada cliente (revisada pela atendente,
// pelo WhatsApp do Drone ou abrindo no aparelho) e pular quem não deve receber.
// Nada é disparado em massa: cada envio é um clique, como nas mensagens do pedido.

import { revalidatePath } from 'next/cache'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { cleanText, parseMoney } from '@/lib/retail/products'
import { campaignCode, isAudience, readParams, DEFAULT_MESSAGES, type Audience } from '@/lib/retail/campaigns'
import { getTenantEvoCreds } from '@/lib/whatsapp/tenant-evo'
import { sendEvoTextMessage } from '@/lib/whatsapp/evolution'
import { isWhatsAppOptedOut } from '@/lib/whatsapp/guardrails'
import { isPrivateInstance } from '@/lib/whatsapp/private-instances'

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function guard(): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const access = await hasFeature('varejo')
  if (!access) return { error: 'Sem acesso ao módulo Varejo.' }
  if (await getSupportSession()) return { error: 'Acesso de suporte é só leitura.' }
  return { tenantId: await requireTenantId(), userId: access.userId }
}

export type CampaignInput = { id?: string | null; name: string; audience: string; params?: unknown; message?: string | null; investment?: string | number | null; status?: string }

export async function saveRetailCampaign(input: CampaignInput): Promise<Result<{ id: string }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const name = cleanText(input.name, 120)
  if (!name) return { ok: false, error: 'Dê um nome à campanha.' }
  const audience: Audience = isAudience(input.audience) ? input.audience : 'nenhum'
  const investment = input.investment === null || input.investment === undefined || input.investment === '' ? 0 : parseMoney(input.investment)
  if (investment === null || investment < 0) return { ok: false, error: 'Investimento inválido.' }
  const row: Record<string, unknown> = {
    name, audience, audience_params: readParams(input.params), investment,
    message: (String(input.message ?? '').trim() || DEFAULT_MESSAGES[audience]).slice(0, 2000),
    status: input.status === 'encerrada' ? 'encerrada' : 'ativa', updated_at: new Date().toISOString(),
  }
  const db = await createScopedAdmin(g.tenantId)
  if (input.id) {
    if (!UUID.test(input.id)) return { ok: false, error: 'Campanha inválida.' }
    const { error } = await db.from('retail_campaigns').update(row).eq('id', input.id)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/varejo/campanhas'); revalidatePath(`/varejo/campanhas/${input.id}`)
    return { ok: true, id: input.id }
  }
  // Código do link único na loja (dia-das-maes, dia-das-maes-2, …)
  const base = campaignCode(name)
  const { data: taken } = await db.from('retail_campaigns').select('code').like('code', `${base}%`)
  const used = new Set((taken ?? []).map(t => t.code as string))
  let code = base, n = 1
  while (used.has(code)) { n += 1; code = `${base.slice(0, 36)}-${n}` }
  const { data, error } = await db.from('retail_campaigns').insert({ ...row, code, created_by: g.userId }).select('id').single()
  if (error || !data) return { ok: false, error: error?.message ?? 'Falha ao criar a campanha.' }
  revalidatePath('/varejo/campanhas')
  return { ok: true, id: data.id as string }
}

export async function deleteRetailCampaign(id: string): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!UUID.test(id)) return { ok: false, error: 'Campanha inválida.' }
  const db = await createScopedAdmin(g.tenantId)
  const { error } = await db.from('retail_campaigns').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/varejo/campanhas')
  return { ok: true }
}

// Envio para uma cliente: pelo WhatsApp do Drone (instância da loja) ou "manual"
// (a atendente abriu o WhatsApp no aparelho e enviou de lá; aqui só registra)
export async function sendRetailCampaignMessage(campaignId: string, customerId: string, input: { text: string; via: 'drone' | 'manual'; instance?: string | null }): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!UUID.test(campaignId) || !UUID.test(customerId)) return { ok: false, error: 'Envio inválido.' }
  const text = String(input.text ?? '').trim().slice(0, 4000)
  if (!text) return { ok: false, error: 'A mensagem está vazia.' }
  const db = await createScopedAdmin(g.tenantId)
  const [{ data: c }, { data: camp }, { data: prev }] = await Promise.all([
    db.from('retail_customers').select('id, phone, whatsapp_optin').eq('id', customerId).maybeSingle(),
    db.from('retail_campaigns').select('id, status').eq('id', campaignId).maybeSingle(),
    db.from('retail_campaign_sends').select('status').eq('campaign_id', campaignId).eq('customer_id', customerId).maybeSingle(),
  ])
  if (!c || !camp) return { ok: false, error: 'Cliente ou campanha não encontrada.' }
  if (camp.status !== 'ativa') return { ok: false, error: 'A campanha está encerrada.' }
  if (!c.whatsapp_optin) return { ok: false, error: 'Esta cliente não autorizou receber WhatsApp da loja.' }
  if (!c.phone) return { ok: false, error: 'A cliente está sem WhatsApp no cadastro.' }
  if (prev?.status === 'enviada') return { ok: false, error: 'Esta cliente já recebeu esta campanha.' }
  if (await isWhatsAppOptedOut(c.phone as string)) return { ok: false, error: 'A cliente pediu para não receber mensagens por WhatsApp.' }

  if (input.via === 'drone') {
    const instance = cleanText(input.instance, 120)
    if (!instance) return { ok: false, error: 'Escolha o WhatsApp de envio.' }
    const { data: org } = await db.from('organization_settings').select('evo_instance_name, evo_instance_aliases').eq('tenant_id', g.tenantId).maybeSingle()
    const mine = [org?.evo_instance_name, ...Object.keys((org?.evo_instance_aliases ?? {}) as Record<string, unknown>)].filter(Boolean)
    if (!mine.includes(instance) || await isPrivateInstance(instance, g.tenantId)) return { ok: false, error: 'Esse WhatsApp não pode enviar para clientes.' }
    const creds = await getTenantEvoCreds(g.tenantId)
    if (!creds) return { ok: false, error: 'Servidor do WhatsApp não configurado.' }
    // Registra antes (trava contra clique duplo); se o WhatsApp falhar, desfaz
    const { error: lockErr } = await db.from('retail_campaign_sends').upsert({ campaign_id: campaignId, customer_id: customerId, status: 'enviada', channel: 'whatsapp_drone', message: text, sent_by: g.userId, sent_at: new Date().toISOString() }, { onConflict: 'campaign_id,customer_id' })
    if (lockErr) return { ok: false, error: lockErr.message }
    try {
      await sendEvoTextMessage({ ...creds, instanceName: instance, phone: c.phone as string, message: text })
    } catch (e) {
      await db.from('retail_campaign_sends').delete().eq('campaign_id', campaignId).eq('customer_id', customerId).eq('channel', 'whatsapp_drone')
      return { ok: false, error: `Não foi enviado: o WhatsApp falhou (${e instanceof Error ? e.message.slice(0, 200) : 'erro'}).` }
    }
  } else {
    const { error } = await db.from('retail_campaign_sends').upsert({ campaign_id: campaignId, customer_id: customerId, status: 'enviada', channel: 'whatsapp_manual', message: text, sent_by: g.userId, sent_at: new Date().toISOString() }, { onConflict: 'campaign_id,customer_id' })
    if (error) return { ok: false, error: error.message }
  }
  revalidatePath(`/varejo/campanhas/${campaignId}`)
  return { ok: true }
}

// Pular uma cliente nesta campanha (ou voltar a mostrar)
export async function skipRetailCampaignCustomer(campaignId: string, customerId: string, skip: boolean): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!UUID.test(campaignId) || !UUID.test(customerId)) return { ok: false, error: 'Inválido.' }
  const db = await createScopedAdmin(g.tenantId)
  const { data: prev } = await db.from('retail_campaign_sends').select('status').eq('campaign_id', campaignId).eq('customer_id', customerId).maybeSingle()
  if (prev?.status === 'enviada') return { ok: false, error: 'Já foi enviada.' }
  const { error } = skip
    ? await db.from('retail_campaign_sends').upsert({ campaign_id: campaignId, customer_id: customerId, status: 'descartada', sent_by: g.userId, sent_at: new Date().toISOString() }, { onConflict: 'campaign_id,customer_id' })
    : await db.from('retail_campaign_sends').delete().eq('campaign_id', campaignId).eq('customer_id', customerId).eq('status', 'descartada')
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/varejo/campanhas/${campaignId}`)
  return { ok: true }
}
