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

  // Grava só o que veio no formulário: cada quadro de Configurações salva a sua
  // parte sem apagar as outras (antes, salvar o orçamento apagava o CNPJ e salvar
  // os dados da empresa voltava o orçamento para US$ 10).
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const text = (k: string) => (formData.get(k) as string | null)?.trim() || null
  if (formData.has('name')) {
    const name = text('name')
    if (!name) return { error: 'Nome é obrigatório.' }
    patch.name = name
  }
  for (const k of ['company_name', 'company_cnpj', 'proposal_header_text', 'proposal_footer_text', 'support_bg_url']) {
    if (formData.has(k)) patch[k] = text(k)
  }
  if (formData.has('proposal_brand_color')) patch.proposal_brand_color = text('proposal_brand_color') ?? '#1B556B'
  if (formData.has('assistant_monthly_budget_usd')) {
    const v = Number(formData.get('assistant_monthly_budget_usd'))
    if (!Number.isFinite(v) || v < 0) return { error: 'Orçamento inválido.' }
    patch.assistant_monthly_budget_usd = v
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('organization_settings')
    .update(patch)
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
  revalidatePath('/settings', 'layout')
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
  revalidatePath('/settings', 'layout')
  return {}
}

export async function setNextTicketNumber(nextNumber: number): Promise<ActionState> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem alterar isso.' }
  const supabase = await createClient()
  const year = new Date().getFullYear()
  const { error } = await supabase.rpc('set_next_ticket_number_for_year', { p_year: year, new_start: nextNumber })
  if (error) return { error: error.message }
  revalidatePath('/settings', 'layout')
  return {}
}

export async function setNextProposalNumber(nextNumber: number): Promise<ActionState> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem alterar isso.' }
  const supabase = await createClient()
  const year = new Date().getFullYear()
  const { error } = await supabase.rpc('set_next_proposal_number_for_year', { p_year: year, new_start: nextNumber })
  if (error) return { error: error.message }
  revalidatePath('/settings', 'layout')
  return {}
}
