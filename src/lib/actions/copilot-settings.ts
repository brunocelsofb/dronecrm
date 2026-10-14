'use server'

// Configurações do Copiloto IA (organization_settings.copilot_settings)

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { RENEWAL_LEVELS, type RenewalLevelKey } from '@/lib/agent/renewal-templates'
import { INTERNAL_LEVELS, invalidEmails, parseEmailList, type InternalKey } from '@/lib/agent/internal-settings'
import { resolveTenantId } from '@/lib/tenant/context'

const MAX_TEMPLATE_LENGTH = 3000

export async function saveRenewalTemplates(
  templates: Partial<Record<RenewalLevelKey, string>>,
  emailSubject?: string,
  commercialEmail?: string,
  confirmationSubject?: string,
  extraCc?: string,
): Promise<{ ok?: true; error?: string }> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem alterar essas mensagens.' }

  const clean: Partial<Record<RenewalLevelKey, string>> = {}
  for (const { key, label } of RENEWAL_LEVELS) {
    const v = templates[key]
    if (typeof v !== 'string') continue
    const t = v.trim()
    if (!t) return { error: `O texto de "${label}" está vazio.` }
    if (t.length > MAX_TEMPLATE_LENGTH) return { error: `O texto de "${label}" passou de ${MAX_TEMPLATE_LENGTH} caracteres.` }
    clean[key] = t
  }

  const subject = emailSubject?.trim() ?? ''
  if (emailSubject !== undefined && !subject) return { error: 'O assunto do e-mail está vazio.' }
  if (subject.length > 200) return { error: 'O assunto do e-mail passou de 200 caracteres.' }

  const confSubject = confirmationSubject?.trim() ?? ''
  if (confSubject.length > 200) return { error: 'O assunto da renovação concluída passou de 200 caracteres.' }

  const commercial = commercialEmail?.trim() ?? ''
  if (commercial && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(commercial)) return { error: 'O e-mail comercial não é válido.' }

  if (extraCc !== undefined) {
    const bad = invalidEmails(extraCc)
    if (bad.length) return { error: `Cópia extra com e-mail inválido: ${bad.join(', ')}` }
  }

  const admin = createAdminClient()
  const { data, error: readErr } = await admin
    .from('organization_settings')
    .select('copilot_settings')
    .eq('tenant_id', await resolveTenantId())
    .maybeSingle()
  if (readErr) return { error: readErr.message }

  const current = (data?.copilot_settings ?? {}) as Record<string, unknown>
  const { error } = await admin
    .from('organization_settings')
    .update({
      copilot_settings: {
        ...current,
        renewal_templates: clean,
        ...(subject ? { renewal_email_subject: subject } : {}),
        ...(commercialEmail !== undefined ? { commercial_email: commercial || null } : {}),
        ...(confSubject ? { renewal_confirmation_subject: confSubject } : {}),
        ...(extraCc !== undefined ? { extra_cc_emails: parseEmailList(extraCc) } : {}),
      },
    })
    .eq('tenant_id', await resolveTenantId())
  if (error) return { error: error.message }

  revalidatePath('/settings/copiloto')
  return { ok: true }
}

// ─── Parte interna (time Orbis) ───────────────────────────────────────────────
export async function saveInternalSettings(input: {
  to: string
  cc: string
  templates: Record<InternalKey, string>
  subjects: Record<InternalKey, string>
  techTeamEmails: string
  implWeeks: number
  implReportDay: number
  implReportOwnerId: string | null
}): Promise<{ ok?: true; error?: string }> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem alterar essas configurações.' }

  const bad = [...invalidEmails(input.to), ...invalidEmails(input.cc), ...invalidEmails(input.techTeamEmails)]
  if (bad.length) return { error: `E-mail inválido: ${bad.join(', ')}` }

  for (const { key, label } of INTERNAL_LEVELS) {
    const t = input.templates[key]?.trim() ?? ''
    if (!t) return { error: `O texto de "${label}" está vazio.` }
    if (t.length > MAX_TEMPLATE_LENGTH) return { error: `O texto de "${label}" passou de ${MAX_TEMPLATE_LENGTH} caracteres.` }
    const sub = input.subjects[key]?.trim() ?? ''
    if (!sub) return { error: `O assunto de "${label}" está vazio.` }
    if (sub.length > 200) return { error: `O assunto de "${label}" passou de 200 caracteres.` }
  }
  if (!Number.isInteger(input.implWeeks) || input.implWeeks < 1 || input.implWeeks > 104) {
    return { error: 'O prazo da implantação deve ser de 1 a 104 semanas.' }
  }
  if (!Number.isInteger(input.implReportDay) || input.implReportDay < 1 || input.implReportDay > 28) {
    return { error: 'O dia do relatório mensal deve ser de 1 a 28.' }
  }

  const admin = createAdminClient()
  const { data, error: readErr } = await admin
    .from('organization_settings').select('copilot_settings').eq('tenant_id', await resolveTenantId()).maybeSingle()
  if (readErr) return { error: readErr.message }
  const current = (data?.copilot_settings ?? {}) as Record<string, unknown>

  const { error } = await admin
    .from('organization_settings')
    .update({
      copilot_settings: {
        ...current,
        internal_to:          parseEmailList(input.to),
        internal_cc:          parseEmailList(input.cc),
        internal_templates:   { ganho: input.templates.ganho.trim(), renovado: input.templates.renovado.trim() },
        internal_subjects:    { ganho: input.subjects.ganho.trim(), renovado: input.subjects.renovado.trim() },
        tech_team_emails:     parseEmailList(input.techTeamEmails),
        impl_weeks:           input.implWeeks,
        impl_report_day:      input.implReportDay,
        impl_report_owner_id: input.implReportOwnerId || null,
      },
    })
    .eq('tenant_id', await resolveTenantId())
  if (error) return { error: error.message }

  revalidatePath('/settings/copiloto')
  return { ok: true }
}
