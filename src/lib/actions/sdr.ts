'use server'

// SDR de IA: salvar configuração (Admin), testar conversa (Admin) e assumir conversa

import { revalidatePath } from 'next/cache'
import Anthropic from '@anthropic-ai/sdk'
import { getUserAccess } from '@/lib/auth/access'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { encryptSecret, getAnthropicKeyForTenant, NO_AI_KEY_MESSAGE } from '@/lib/ai/tenant-key'
import { readSdrSettings, bookingLinkFor, SDR_LIMITS, SDR_LIMIT_LABEL, type SdrSettings } from '@/lib/sdr/settings'
import { mergeAnswers, type ChatTurn } from '@/lib/sdr/prompt'
import { runSdrTurn } from '@/lib/sdr/turn'
import { takeOverConversation } from '@/lib/sdr/engine'

type Result = { ok: true } | { ok: false; error: string }
const NO_ADMIN = 'Só o Admin configura o SDR de IA.'

export async function saveSdrSettings(input: SdrSettings & { meta_token?: string; clear_meta_token?: boolean }): Promise<Result> {
  const me = await getUserAccess()
  if (!me?.isAdmin) return { ok: false, error: NO_ADMIN }
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const { data: cur } = await db.from('organization_settings').select('sdr_settings, sdr_meta_token_enc').eq('tenant_id', tenantId).maybeSingle()
  const prev = readSdrSettings(cur?.sdr_settings)

  // Texto acima do limite: avisa em vez de cortar sem aviso
  for (const k of Object.keys(SDR_LIMITS) as (keyof typeof SDR_LIMITS)[]) {
    const v = (input as Record<string, unknown>)[k]
    if (typeof v === 'string' && v.length > SDR_LIMITS[k]) {
      return { ok: false, error: `"${SDR_LIMIT_LABEL[k]}" tem ${v.length.toLocaleString('pt-BR')} caracteres; o limite é ${SDR_LIMITS[k].toLocaleString('pt-BR')}.` }
    }
  }
  const s = readSdrSettings(input)
  // Vendedores: só pessoas desta empresa
  if (s.sellers.length) {
    const { data: ok } = await db.from('profiles').select('id').eq('tenant_id', tenantId).in('id', s.sellers)
    const valid = new Set((ok ?? []).map(p => p.id as string))
    s.sellers = s.sellers.filter(id => valid.has(id))
    for (const k of Object.keys(s.booking_links)) if (!valid.has(k)) delete s.booking_links[k]
  }
  if (s.client_owner) {
    const { data: owner } = await db.from('profiles').select('id').eq('tenant_id', tenantId).eq('id', s.client_owner).maybeSingle()
    if (!owner) s.client_owner = ''
  }
  if (s.client_owner_phone && (s.client_owner_phone.length < 10 || s.client_owner_phone.length > 13)) {
    return { ok: false, error: 'WhatsApp do consultor de clientes inválido: use DDD + número.' }
  }
  if (s.enabled) {
    if (s.channel === 'evolution' && !s.instances.length && !s.departments.length) {
      return { ok: false, error: 'Escolha ao menos um número ou um setor da triagem para a IA atender.' }
    }
    if (!s.about.trim()) return { ok: false, error: 'Preencha "Sobre a empresa": é a base para a IA responder.' }
  }

  const patch: Record<string, unknown> = {}
  const token = input.meta_token?.trim()
  if (input.clear_meta_token) { patch.sdr_meta_token_enc = null; s.meta.last4 = null }
  else if (token) {
    if (token.length < 20) return { ok: false, error: 'Token da Meta parece incompleto.' }
    patch.sdr_meta_token_enc = encryptSecret(token)
    s.meta.last4 = token.slice(-4)
  } else s.meta.last4 = cur?.sdr_meta_token_enc ? prev.meta.last4 : null

  if (s.channel === 'meta' && s.enabled) {
    if (!s.meta.phone_number_id || !s.meta.api_version || !s.meta.last4) {
      return { ok: false, error: 'API oficial da Meta: informe o ID do número, a versão e o token.' }
    }
  }

  const { error } = await db.from('organization_settings').update({ sdr_settings: s, ...patch }).eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings/sdr')
  revalidatePath('/sdr')
  return { ok: true }
}

export type SimEvent = { tool: string; detail: string }

// Testar conversa: mesma IA e mesmas instruções, sem WhatsApp e sem gravar nada
export async function simulateSdr(settingsInput: SdrSettings, history: ChatTurn[]): Promise<
  { ok: true; reply: string; events: SimEvent[]; ended: boolean; tokens: number } | { ok: false; error: string }
> {
  const me = await getUserAccess()
  if (!me?.isAdmin) return { ok: false, error: NO_ADMIN }
  const tenantId = await resolveTenantId()
  const key = (await getAnthropicKeyForTenant(tenantId)).key
  if (!key) return { ok: false, error: NO_AI_KEY_MESSAGE }
  const turns = history
    .filter(t => (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string' && t.content.trim())
    .slice(-40).map(t => ({ role: t.role, content: t.content.slice(0, 2000) }))
  if (!turns.length || turns[turns.length - 1].role !== 'user') return { ok: false, error: 'Escreva uma mensagem.' }

  const db = await createScopedAdmin(tenantId)
  const { data: org } = await db.from('organization_settings').select('company_name, name').eq('tenant_id', tenantId).maybeSingle()
  const s = readSdrSettings(settingsInput)
  const events: SimEvent[] = []
  let answers: Record<string, unknown> = {}
  try {
    const res = await runSdrTurn({
      client: new Anthropic({ apiKey: key }).messages,
      settings: s, companyName: (org?.company_name as string | null) || (org?.name as string | null) || 'nossa empresa',
      turns, repliesLeft: s.max_replies, contactName: null,
      onTool: async call => {
        if (call.name === 'registrar_respostas') {
          answers = mergeAnswers(answers, call.input)
          events.push({ tool: 'Registrou', detail: JSON.stringify(call.input) })
          return 'Registrado.'
        }
        if (call.name === 'passar_para_comercial') {
          const seller = s.sellers[0] ?? null
          let sellerName: string | null = null
          if (seller) sellerName = ((await db.from('profiles').select('full_name').eq('id', seller).maybeSingle()).data?.full_name as string | null)?.split(' ')[0] ?? null
          const link = bookingLinkFor(s, seller)
          events.push({ tool: 'Passaria ao comercial', detail: `${String(call.input.resumo ?? '')} · ${call.input.qualificado ? 'qualificado' : 'não qualificado'} · ${String(call.input.temperatura ?? '')}` })
          return link ? `Passado para ${sellerName ?? 'o time comercial'}. Link de agenda para enviar: ${link}` : `Passado para ${sellerName ?? 'o time comercial'}. Sem link de agenda: diga que o consultor vai entrar em contato.`
        }
        if (call.name === 'encaminhar_para_equipe') {
          if (call.input.cliente_atual === true && s.client_owner) {
            const owner = ((await db.from('profiles').select('full_name').eq('id', s.client_owner).maybeSingle()).data?.full_name as string | null) ?? null
            events.push({ tool: 'Encaminharia ao consultor de clientes', detail: `${owner ?? '—'} · ${String(call.input.motivo ?? '')}` })
            return `Encaminhado ao consultor de clientes${owner ? ` ${owner.split(' ')[0]}` : ''}.${s.client_owner_phone ? ` WhatsApp dele: ${s.client_owner_phone}.` : ''} Avise que ele vai dar sequência.`
          }
          events.push({ tool: 'Encaminharia ao time', detail: String(call.input.motivo ?? '') })
          return 'Encaminhado ao time. Avise que uma pessoa vai responder por aqui.'
        }
        events.push({ tool: 'Descartaria', detail: String(call.input.motivo ?? '') })
        return 'Encerrado.'
      },
    })
    return { ok: true, reply: res.text, events, ended: !!res.terminal, tokens: res.usage.input + res.usage.output }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : 'Falha ao chamar a IA.' }
  }
}

export async function takeOverSdr(conversationId: string): Promise<Result> {
  const me = await getUserAccess()
  if (!me || !(me.isAdmin || me.features.includes('sdr') || me.features.includes('whatsapp'))) return { ok: false, error: 'Sem acesso.' }
  const ok = await takeOverConversation(await resolveTenantId(), conversationId)
  if (!ok) return { ok: false, error: 'Conversa não está mais com a IA.' }
  revalidatePath('/sdr')
  return { ok: true }
}
