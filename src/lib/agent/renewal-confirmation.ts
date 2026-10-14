// ─── Confirmação de renovação ao cliente ─────────────────────────────────────
// Chamado quando o consultor marca "Renovado" no funil de Gestão de Contratos.
// Abre uma atividade para o responsável com a mensagem pronta (novo período);
// o consultor revisa e envia por WhatsApp + e-mail ("Revisar e enviar").
// Também encerra avisos de vencimento ainda pendentes do período anterior.

import { createAdminClient } from '@/lib/supabase/admin'
import { createAgentActivity } from './agent-activity'
import {
  resolveRenewalTemplates,
  resolveRenewalConfirmationSubject,
  renderRenewalTemplate,
} from './renewal-templates'

function brDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = String(iso).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : null
}

export async function createRenewalConfirmation(contractId: string): Promise<{ ok: boolean; detail?: string }> {
  const admin = createAdminClient()

  const { data: c, error } = await admin
    .from('contracts')
    .select('id, process_number, client_name, valid_from, valid_until, monthly_value, contact_id, owner_id, current_assignee_id')
    .eq('id', contractId)
    .maybeSingle()
  if (error || !c) return { ok: false, detail: error?.message ?? 'contrato não encontrado' }
  if (!c.valid_until) return { ok: false, detail: 'contrato sem nova vigência' }

  // 1. Encerra avisos de vencimento pendentes (período anterior)
  const { data: pending } = await admin
    .from('activities')
    .select('id, metadata')
    .eq('contract_id', contractId)
    .eq('metadata->>kind', 'renewal_alert')
    .neq('status', 'done')
  for (const a of pending ?? []) {
    const meta = (a.metadata ?? {}) as Record<string, unknown>
    await admin.from('activities').update({
      status: 'done',
      completed: true,
      metadata: { ...meta, approval: meta.approval === 'pending' ? 'cancelled' : meta.approval, closed_reason: 'contrato renovado' },
    }).eq('id', a.id)
  }

  // 2. Contato: contracts.contact_id, senão o principal em contract_contacts
  let contactId = c.contact_id as string | null
  if (!contactId) {
    const { data: links } = await admin
      .from('contract_contacts')
      .select('contact_id, is_primary')
      .eq('contract_id', contractId)
      .order('is_primary', { ascending: false })
      .limit(1)
    contactId = links?.[0]?.contact_id ?? null
  }
  const { data: contact } = contactId
    ? await admin.from('contacts').select('name, phone, email').eq('id', contactId).maybeSingle()
    : { data: null }

  const phoneDigits = contact?.phone?.replace(/\D/g, '') ?? ''
  const phone = phoneDigits.length >= 10 ? phoneDigits : null
  const email = contact?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim()) ? contact.email.trim() : null

  // 3. Textos (Configurações → Copiloto IA → Renovação concluída)
  const { data: org } = await admin
    .from('organization_settings').select('company_name, copilot_settings').eq('id', 'default').maybeSingle()
  const copilot = (org?.copilot_settings ?? {}) as { renewal_templates?: unknown; renewal_confirmation_subject?: unknown }
  const templates = resolveRenewalTemplates(copilot.renewal_templates)
  const vars = {
    contato:    contact?.name?.split(' ')[0] ?? c.client_name,
    cliente:    c.client_name,
    contrato:   c.process_number ?? '',
    inicio:     brDate(c.valid_from) ?? '',
    vencimento: brDate(c.valid_until) ?? '',
    dias:       '',
    empresa:    org?.company_name?.trim() || 'Equipe Comercial',
  }
  const draft = renderRenewalTemplate(templates.renovado, vars)
  const draftSubject = renderRenewalTemplate(resolveRenewalConfirmationSubject(copilot.renewal_confirmation_subject), vars)

  const periodo = `${vars.inicio || '—'} a ${vars.vencimento}`
  const ownerId = (c.owner_id ?? c.current_assignee_id ?? null) as string | null
  const dedupeKey = `renewal_confirmation:${String(c.valid_until).slice(0, 10)}`

  // 4. Atividade para o responsável
  const missing = [!phone && 'WhatsApp', !email && 'e-mail'].filter(Boolean) as string[]
  const r = missing.length > 0
    ? await createAgentActivity(admin, {
        contractId, dedupeKey, dueInDays: 1, assignedTo: ownerId, activityType: 'task',
        title: `Confirmação de renovação sem ${missing.join(' e ')} — ${c.client_name}`,
        content:
          `[Copiloto IA] Contrato ${c.process_number ?? ''} renovado — novo período ${periodo}.\n\n` +
          `A confirmação ao cliente vai por WhatsApp e e-mail juntos, mas o contato está sem ${missing.join(' e ')}. ` +
          `Cadastre no contato e avise o cliente.`,
        metadata: { kind: 'renewal_confirmation', valid_from: c.valid_from, valid_until: c.valid_until, missing },
      })
    : await createAgentActivity(admin, {
        contractId, dedupeKey, dueInDays: 1, assignedTo: ownerId, activityType: 'whatsapp',
        title: `Enviar confirmação de renovação — ${c.client_name}`,
        content:
          `[Copiloto IA] Contrato ${c.process_number ?? ''} renovado — novo período ${periodo}.\n\n` +
          `Confirmação ao cliente (WhatsApp + e-mail) pronta para revisão — para ${contact?.name ?? 'o contato'} ` +
          `(${phone} · ${email}). Clique em "Revisar e enviar".`,
        metadata: {
          kind:          'renewal_confirmation',
          valid_from:    c.valid_from,
          valid_until:   c.valid_until,
          draft_message: draft,
          draft_subject: draftSubject,
          target_phone:  phone,
          target_email:  email,
          contact_name:  contact?.name ?? null,
          approval:      'pending',
        },
      })

  if (r.status === 'error') return { ok: false, detail: r.error }
  return { ok: true, detail: r.status === 'skipped' ? r.reason : undefined }
}
