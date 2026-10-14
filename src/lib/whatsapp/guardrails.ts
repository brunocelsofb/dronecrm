import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTenantId } from '@/lib/tenant/context'

const OPT_OUT_KEYWORDS = ['sair', 'parar', 'stop', 'cancelar', 'descadastrar', 'não quero mais']

export function isOptOutMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  return OPT_OUT_KEYWORDS.some((k) => normalized === k || normalized === k + '.')
}

export async function recordWhatsAppOptOut(phone: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('whatsapp_opt_outs').upsert({ phone })
}

export async function isWhatsAppOptedOut(phone: string): Promise<boolean> {
  const supabase = createAdminClient()
  const cleanPhone = phone.replace(/\D/g, '')
  const { data } = await supabase.from('whatsapp_opt_outs').select('phone').ilike('phone', `%${cleanPhone.slice(-8)}%`).maybeSingle()
  return !!data
}

// Checa opt-out E limite diário de uma vez — usar isso antes de
// qualquer envio AUTOMÁTICO (boas-vindas, lembrete, automação por
// gatilho). Envio manual, feito por uma pessoa, não passa por aqui.
export async function canSendAutomatedWhatsApp(phone: string, tenantId?: string | null): Promise<{ ok: boolean; reason?: string }> {
  const supabase = createAdminClient()

  const optedOut = await isWhatsAppOptedOut(phone)
  if (optedOut) return { ok: false, reason: 'opted_out' }

  const { data: settings } = await supabase.from('organization_settings').select('whatsapp_daily_auto_limit').eq('tenant_id', tenantId ?? await resolveTenantId()).maybeSingle()
  const limit = settings?.whatsapp_daily_auto_limit ?? 3

  const cleanPhone = phone.replace(/\D/g, '')
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('contract_whatsapp_messages')
    .select('id', { count: 'exact', head: true })
    .ilike('phone', `%${cleanPhone.slice(-8)}%`)
    .eq('triggered_automatically', true)
    .gte('created_at', oneDayAgo)

  if ((count ?? 0) >= limit) return { ok: false, reason: 'daily_limit' }

  return { ok: true }
}

// ------------------------------------------------------------
// Monta as mensagens automáticas do "bot" — usa o texto customizado
// da organização se tiver um configurado, senão cai num padrão
// razoável. Suporta {{empresa}} e {{link}} como variáveis.
// ------------------------------------------------------------
export const DEFAULT_WELCOME_OFFLINE = 'Olá! Aqui é da *{{empresa}}*. 👋\n\nPra te atendermos direito, precisamos de alguns dados seus — leva menos de 1 minuto:\n{{link}}\n\n(Se o link não abrir direto, salva nosso número nos seus contatos e copia o link pra abrir no navegador.)\n\nAssim que preencher, nosso time entra em contato. Se preferir, é só continuar escrevendo aqui mesmo que alguém do time vê.'

export const DEFAULT_WELCOME_ONLINE = 'Olá! Aqui é da *{{empresa}}*. 👋 Já estamos online e alguém do time já viu sua mensagem!\n\nEnquanto isso, se puder, deixa seus dados aqui pra agilizar o atendimento:\n{{link}}'

export const DEFAULT_REMINDER = 'Olá, aqui é da *{{empresa}}* de novo. 👋\n\nAinda não recebemos seus dados — pra te atendermos, preenche por aqui:\n{{link}}\n\n(Se o link não abrir direto, copia e cola no navegador.)'

export type WhatsAppBotSettings = {
  whatsapp_is_online: boolean
  whatsapp_welcome_message: string | null
  whatsapp_welcome_message_online: string | null
  whatsapp_reminder_message: string | null
  company_name: string | null
}

function fillBotVars(text: string, vars: { empresa: string; link: string }): string {
  return text.replace(/\{\{empresa\}\}/g, vars.empresa).replace(/\{\{link\}\}/g, vars.link)
}

export function buildWelcomeMessage(settings: WhatsAppBotSettings, captureUrl: string): string {
  const empresa = settings.company_name || 'nossa empresa'
  const template = settings.whatsapp_is_online
    ? settings.whatsapp_welcome_message_online || DEFAULT_WELCOME_ONLINE
    : settings.whatsapp_welcome_message || DEFAULT_WELCOME_OFFLINE
  return fillBotVars(template, { empresa, link: captureUrl })
}

export function buildReminderMessage(settings: WhatsAppBotSettings, captureUrl: string): string {
  const empresa = settings.company_name || 'nossa empresa'
  const template = settings.whatsapp_reminder_message || DEFAULT_REMINDER
  return fillBotVars(template, { empresa, link: captureUrl })
}
