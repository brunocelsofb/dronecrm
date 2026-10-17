// ─── Entrada de um lead no CRM (núcleo comum) ────────────────────────────────
// Usado pelo formulário público (/captura), pelo endereço do site e pelas
// integrações (RD Station, Mailchimp, Google, Zapier/Make…). Grava sempre na
// empresa informada (tenantId), liga a campanha, calcula a pontuação, liga a
// empresa por CNPJ e a conversa de WhatsApp, e avisa o time.
// Repetido (mesmo e-mail, lead ainda aberto): não duplica — registra a nova
// conversão no histórico do lead, como fazem os CRMs de mercado.

import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { calculateLeadScore } from '@/lib/utils/lead-score'
import type { Tracking } from '@/lib/marketing/tracking'

export type IngestInput = {
  tenantId: string
  name: string
  email: string | null
  phone: string | null
  company_name: string | null
  cnpj: string | null
  message: string | null
  source: string
  tracking: Tracking
  campaignId?: string | null       // escolhida (formulário interno) ou padrão da integração
  integrationId?: string | null
  conversion?: string | null       // nome da conversão/formulário na origem
  dedupe?: boolean
  // Inbound (veio até a empresa: formulário, anúncio, integração) fica com o
  // marketing até ser passado ao comercial; outbound (prospecção) já nasce no comercial.
  entryType?: 'inbound' | 'outbound'
  handedOffBy?: string | null      // já entra no comercial (outbound, ou inbound atendido direto)
  assignedTo?: string | null
}

export type IngestResult = { leadId?: string; duplicate?: boolean; error?: string }

export async function ingestLead(input: IngestInput): Promise<IngestResult> {
  const db = await createScopedAdmin(input.tenantId)
  const { tenantId, name, email, phone, company_name, cnpj, message, source, tracking } = input

  // Campanha: pelo código do link (utm_campaign); senão a informada
  let campaignId: string | null = null
  if (tracking.utm_campaign) {
    const { data: camp } = await db.from('marketing_campaigns').select('id').eq('utm_campaign', tracking.utm_campaign).maybeSingle()
    campaignId = camp?.id ?? null
  }
  if (!campaignId && input.campaignId) {
    const { data: camp } = await db.from('marketing_campaigns').select('id').eq('id', input.campaignId).maybeSingle()
    campaignId = camp?.id ?? null
  }
  const via = input.conversion ? ` · ${input.conversion}` : ''

  // Mesmo e-mail com lead ainda aberto: registra a nova conversão, sem duplicar
  if (input.dedupe && email) {
    const safe = email.replace(/[%_\\]/g, m => `\\${m}`)
    const { data: existing } = await db.from('leads')
      .select('id, phone, company_name, cnpj, campaign_id, status')
      .ilike('email', safe).not('status', 'in', '(convertido,descartado)')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (existing) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (!existing.phone && phone) patch.phone = phone
      if (!existing.company_name && company_name) patch.company_name = company_name
      if (!existing.cnpj && cnpj) patch.cnpj = cnpj
      if (!existing.campaign_id && campaignId) patch.campaign_id = campaignId
      await db.from('leads').update(patch).eq('id', existing.id)
      await db.from('lead_activities').insert({
        lead_id: existing.id, type: 'system',
        content: `🔁 Nova conversão (${source}${via})${tracking.utm_campaign ? ` · campanha ${tracking.utm_campaign}` : ''}${message ? `: ${message.slice(0, 300)}` : ''}`,
      })
      return { leadId: existing.id, duplicate: true }
    }
  }

  // Pontuação (obs.: as regras hoje não têm empresa — são as mesmas para todas)
  const { data: rules } = await db.from('lead_scoring_rules').select('criterion_key, label, points, is_active').eq('is_active', true)
  const { score } = calculateLeadScore({ email, phone, company_name, message, source }, rules?.length ? rules : undefined)

  const { data, error } = await db
    .from('leads')
    .insert({
      name, email, phone, company_name, cnpj, message, source, score, tenant_id: tenantId,
      campaign_id: campaignId, integration_id: input.integrationId ?? null, ...tracking,
      entry_type: input.entryType ?? 'inbound',
      ...((input.entryType ?? 'inbound') === 'outbound' || input.handedOffBy
        ? { handed_off_at: new Date().toISOString(), handed_off_by: input.handedOffBy ?? null } : {}),
      ...(input.assignedTo ? { assigned_to: input.assignedTo } : {}),
    })
    .select('id')
    .single()
  if (error || !data) return { error: error?.message ?? 'Não foi possível registrar o contato.' }

  if (input.conversion) {
    await db.from('lead_activities').insert({ lead_id: data.id, type: 'system', content: `📥 Recebido por ${source}${via}` })
  }

  // Empresa já cadastrada com o mesmo CNPJ
  const cnpjDigits = (cnpj ?? '').replace(/\D/g, '')
  if (cnpjDigits.length === 14) {
    const { data: existingCompany } = await db.from('companies').select('id')
      .or(`cnpj.eq.${cnpjDigits},cnpj.eq.${(cnpj ?? '').replace(/[^\d./-]/g, '')}`)
      .limit(1).maybeSingle()
    if (existingCompany) {
      await db.from('activities').insert({ company_id: existingCompany.id, type: 'note', content: `📥 Novo lead recebido: "${name}" (${source})` })
    }
  }

  // Conversa de WhatsApp anterior (triagem) passa a ser deste lead
  const cleanPhone = (phone ?? '').replace(/\D/g, '')
  if (cleanPhone.length >= 8) {
    await db.from('contract_whatsapp_messages').update({ lead_id: data.id, unlinked_sender_name: null }).ilike('phone', `%${cleanPhone.slice(-8)}%`).is('contract_id', null)
    await db.from('whatsapp_capture_prompts').update({ lead_id: data.id }).ilike('phone', `%${cleanPhone.slice(-8)}%`)
  }

  // Aviso: inbound ainda com o marketing → marketing; senão → comercial (ou o responsável)
  const withMarketing = (input.entryType ?? 'inbound') === 'inbound' && !input.handedOffBy
  let team: { id: string }[] | null = input.assignedTo ? [{ id: input.assignedTo }] : null
  if (!team) {
    const area = withMarketing ? 'marketing' : 'comercial'
    const { data } = await db.from('profiles').select('id').eq('tenant_id', tenantId)
      .or(withMarketing ? `department.eq.${area},access_profile.eq.marketing` : `department.eq.${area},access_profile.in.(hunter,gestor)`)
    team = data ?? []
    // Ninguém nessa área ainda: avisa os administradores da empresa
    if (!team.length) team = (await db.from('profiles').select('id').eq('tenant_id', tenantId).eq('role', 'admin')).data ?? []
  }
  if (team?.length) {
    await db.from('notifications').insert(team.map(p => ({ user_id: p.id, message: `Novo lead: ${name}${company_name ? ` (${company_name})` : ''}.` })))
  }

  return { leadId: data.id }
}
