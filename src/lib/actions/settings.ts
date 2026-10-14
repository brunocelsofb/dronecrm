'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { resolveTenantId } from '@/lib/tenant/context'

export type ActionState = { error?: string }

export async function updateOrganizationLogo(filePath: string): Promise<ActionState> {
  if (!(await isCurrentUserAdmin())) {
    return { error: 'Só administradores podem alterar o logo.' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('organization_settings')
    .update({ logo_storage_path: filePath, updated_at: new Date().toISOString() })
    .eq('tenant_id', await resolveTenantId())

  if (error) return { error: error.message }

  revalidatePath('/', 'layout')
  return {}
}

export async function updateOrganizationSettings(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  if (!(await isCurrentUserAdmin())) {
    return { error: 'Só administradores podem alterar as configurações gerais.' }
  }

  const name = (formData.get('name') as string)?.trim()
  const company_name = (formData.get('company_name') as string)?.trim() || null
  const company_cnpj = (formData.get('company_cnpj') as string)?.trim() || null
  const proposal_header_text = (formData.get('proposal_header_text') as string)?.trim() || null
  const proposal_footer_text = (formData.get('proposal_footer_text') as string)?.trim() || null
  const proposal_brand_color = (formData.get('proposal_brand_color') as string)?.trim() || '#1B556B'
  const assistantBudgetRaw = formData.get('assistant_monthly_budget_usd') as string
  const assistant_monthly_budget_usd = assistantBudgetRaw ? Number(assistantBudgetRaw) : 10
  const support_bg_url = (formData.get('support_bg_url') as string)?.trim() || null
  if (!name) return { error: 'Nome é obrigatório.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('organization_settings')
    .update({
      name,
      company_name,
      company_cnpj,
      proposal_header_text,
      proposal_footer_text,
      proposal_brand_color,
      assistant_monthly_budget_usd,
      support_bg_url,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', await resolveTenantId())

  if (error) return { error: error.message }

  revalidatePath('/', 'layout')
  return {}
}

// ------------------------------------------------------------
// Numeração de ticket/protocolo e proposta — configurável, atômica
// (usa sequência do banco, sem risco de número repetido).
// ------------------------------------------------------------
// ------------------------------------------------------------
// Domínio de recebimento de e-mail — base pro lastro bidirecional
// (resposta do cliente / e-mail mandado por fora do CRM). Fica
// configurável por organização desde já, pensando em multi-empresa no
// futuro (não fixo em código).
// ------------------------------------------------------------
export async function updateInboundEmailSettings(formData: FormData): Promise<ActionState> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem alterar isso.' }

  const inbound_email_domain = (formData.get('inbound_email_domain') as string)?.trim() || null
  const mailgun_webhook_signing_key = (formData.get('mailgun_webhook_signing_key') as string)?.trim() || null

  const supabase = await createClient()
  const { error } = await supabase
    .from('organization_settings')
    .update({ inbound_email_domain, mailgun_webhook_signing_key, updated_at: new Date().toISOString() })
    .eq('tenant_id', await resolveTenantId())

  if (error) return { error: error.message }
  revalidatePath('/settings')
  return {}
}

export async function updateNumberingPrefixes(formData: FormData): Promise<ActionState> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem alterar isso.' }

  const ticket_number_prefix = (formData.get('ticket_number_prefix') as string)?.trim() || 'TICKET'
  const proposal_number_prefix = (formData.get('proposal_number_prefix') as string)?.trim() || 'PROP'

  const supabase = await createClient()
  const { error } = await supabase
    .from('organization_settings')
    .update({ ticket_number_prefix, proposal_number_prefix, updated_at: new Date().toISOString() })
    .eq('tenant_id', await resolveTenantId())

  if (error) return { error: error.message }
  revalidatePath('/settings')
  return {}
}

export async function setNextTicketNumber(nextNumber: number): Promise<ActionState> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem alterar isso.' }
  const supabase = await createClient()
  const year = new Date().getFullYear()
  const { error } = await supabase.rpc('set_next_ticket_number_for_year', { p_year: year, new_start: nextNumber })
  if (error) return { error: error.message }
  revalidatePath('/settings')
  return {}
}

export async function setNextProposalNumber(nextNumber: number): Promise<ActionState> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem alterar isso.' }
  const supabase = await createClient()
  const year = new Date().getFullYear()
  const { error } = await supabase.rpc('set_next_proposal_number_for_year', { p_year: year, new_start: nextNumber })
  if (error) return { error: error.message }
  revalidatePath('/settings')
  return {}
}
