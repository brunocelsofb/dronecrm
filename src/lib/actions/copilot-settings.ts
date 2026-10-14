'use server'

// Configurações do Copiloto IA (organization_settings.copilot_settings)

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { RENEWAL_LEVELS, type RenewalLevelKey } from '@/lib/agent/renewal-templates'

const MAX_TEMPLATE_LENGTH = 3000

export async function saveRenewalTemplates(
  templates: Partial<Record<RenewalLevelKey, string>>,
  emailSubject?: string,
  commercialEmail?: string,
  confirmationSubject?: string,
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

  const admin = createAdminClient()
  const { data, error: readErr } = await admin
    .from('organization_settings')
    .select('copilot_settings')
    .eq('id', 'default')
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
      },
    })
    .eq('id', 'default')
  if (error) return { error: error.message }

  revalidatePath('/settings/copiloto')
  return { ok: true }
}
