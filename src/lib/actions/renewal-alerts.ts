'use server'

// Envio aprovado dos avisos de renovação criados pelo Copiloto IA.
// O agente (expiration-alerts) abre a atividade com metadata.approval='pending';
// aqui o consultor revisa o texto, escolhe o WhatsApp e envia.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendContractWhatsApp } from '@/lib/actions/whatsapp'
import { isWhatsAppOptedOut } from '@/lib/whatsapp/guardrails'
import { isPrivateInstance } from '@/lib/whatsapp/private-instances'
import { renderRenewalTemplate } from '@/lib/agent/renewal-templates'

export type SendableInstance = { name: string; label: string }

type AliasValue = string | { label?: string; private?: boolean }

// Lista os WhatsApps que podem enviar ao cliente (exclui instâncias privadas)
// e sugere o do responsável do contrato.
export async function getSendableInstances(contractId: string): Promise<{
  instances: SendableInstance[]
  suggested: string | null
  error?: string
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { instances: [], suggested: null, error: 'Não autenticado.' }

  const admin = createAdminClient()
  const [{ data: org }, { data: contract }] = await Promise.all([
    admin.from('organization_settings').select('evo_instance_aliases, evo_instance_name').eq('id', 'default').maybeSingle(),
    admin.from('contracts').select('owner_id, current_assignee_id').eq('id', contractId).maybeSingle(),
  ])

  const aliases = (org?.evo_instance_aliases ?? {}) as Record<string, AliasValue>
  const instances: SendableInstance[] = Object.entries(aliases)
    .filter(([, v]) => !(typeof v === 'object' && v?.private === true))
    .map(([name, v]) => ({ name, label: typeof v === 'string' ? v : v?.label ?? name }))

  const principal = org?.evo_instance_name ?? null
  if (principal && !instances.some(i => i.name === principal)) {
    instances.unshift({ name: principal, label: principal })
  }

  // Sugere a instância cujo rótulo contém o primeiro nome do responsável
  let suggested: string | null = principal
  const ownerId = contract?.owner_id ?? contract?.current_assignee_id
  if (ownerId) {
    const { data: owner } = await admin.from('profiles').select('full_name').eq('id', ownerId).maybeSingle()
    const first = owner?.full_name?.split(' ')[0]?.toLowerCase()
    const match = first ? instances.find(i => i.label.toLowerCase().includes(first) || i.name.toLowerCase().includes(first)) : null
    if (match) suggested = match.name
  }

  return { instances, suggested }
}

export async function sendRenewalAlert(
  activityId: string,
  message: string,
  instanceName: string,
): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }
  if (!message.trim()) return { error: 'A mensagem está vazia.' }
  if (!instanceName) return { error: 'Escolha o WhatsApp de envio.' }

  const admin = createAdminClient()
  const { data: activity, error: aErr } = await admin
    .from('activities')
    .select('id, contract_id, status, metadata')
    .eq('id', activityId)
    .maybeSingle()
  if (aErr || !activity) return { error: 'Atividade não encontrada.' }

  const meta = (activity.metadata ?? {}) as Record<string, unknown>
  if (meta.kind !== 'renewal_alert') return { error: 'Esta atividade não é um aviso de renovação.' }
  if (meta.approval !== 'pending') return { error: 'Este aviso já foi enviado ou descartado.' }
  const phone = typeof meta.target_phone === 'string' ? meta.target_phone : ''
  if (!phone) return { error: 'O aviso não tem telefone de destino.' }
  if (!activity.contract_id) return { error: 'Atividade sem contrato.' }

  if (await isPrivateInstance(instanceName)) return { error: 'Esse WhatsApp é privado e não envia para clientes.' }
  if (await isWhatsAppOptedOut(phone)) return { error: 'O cliente pediu para não receber mensagens por WhatsApp (opt-out).' }

  // Trava contra clique duplo: marca como "enviando" só se ainda estiver pendente
  const { data: locked } = await admin
    .from('activities')
    .update({ metadata: { ...meta, approval: 'sending' } })
    .eq('id', activityId)
    .eq('metadata->>approval', 'pending')
    .select('id')
  if (!locked?.length) return { error: 'Este aviso já está sendo enviado.' }

  // {{consultor}} = pessoa dona do WhatsApp escolhido (rótulo da instância)
  const { data: org } = await admin
    .from('organization_settings').select('evo_instance_aliases').eq('id', 'default').maybeSingle()
  const alias = ((org?.evo_instance_aliases ?? {}) as Record<string, AliasValue>)[instanceName]
  const consultor = typeof alias === 'string' ? alias : alias?.label ?? ''
  const finalMessage = renderRenewalTemplate(message.trim(), { consultor }).replace(/\n{3,}/g, '\n\n').trim()

  const result = await sendContractWhatsApp(activity.contract_id, phone, finalMessage, null, instanceName, { signWithSender: false })

  if (result.error) {
    await admin.from('activities').update({ metadata: { ...meta, approval: 'pending', last_error: result.error } }).eq('id', activityId)
    revalidatePath(`/contracts/${activity.contract_id}`)
    return { error: result.error }
  }

  await admin
    .from('activities')
    .update({
      status: 'done',
      completed: true,
      metadata: {
        ...meta,
        approval:      'sent',
        sent_at:       new Date().toISOString(),
        sent_by:       user.id,
        sent_instance: instanceName,
        final_message: finalMessage,
      },
    })
    .eq('id', activityId)

  revalidatePath(`/contracts/${activity.contract_id}`)
  return { ok: true }
}
