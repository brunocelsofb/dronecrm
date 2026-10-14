'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export type ActionState = { error?: string }

export async function createAutomationRule(formData: FormData): Promise<ActionState> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem criar automações.' }

  const name = (formData.get('name') as string)?.trim()
  const trigger_type = formData.get('trigger_type') as string
  const trigger_stage_id = (formData.get('trigger_stage_id') as string) || null
  const trigger_pipeline_id = (formData.get('trigger_pipeline_id') as string) || null
  const trigger_tag_id = (formData.get('trigger_tag_id') as string) || null
  const days_threshold = formData.get('days_threshold') ? Number(formData.get('days_threshold')) : null
  const action_type = formData.get('action_type') as string
  const target_stage_id = (formData.get('target_stage_id') as string) || null
  const target_pipeline_id = (formData.get('target_pipeline_id') as string) || null
  const task_content = (formData.get('task_content') as string) || null
  const email_template_id = (formData.get('email_template_id') as string) || null
  const whatsapp_template_id = (formData.get('whatsapp_template_id') as string) || null
  const notify_user_id = (formData.get('notify_user_id') as string) || null
  const notify_message = (formData.get('notify_message') as string) || null

  const isOutcomeTrigger = trigger_type === 'outcome_won' || trigger_type === 'outcome_lost'
  const isTagTrigger = trigger_type === 'tag_added' || trigger_type === 'tag_removed'
  const isExpirationTrigger = trigger_type === 'days_before_expiration'
  const isTicketTrigger = trigger_type === 'ticket_linked'
  const isStageBasedTrigger = !isOutcomeTrigger && !isTagTrigger && !isExpirationTrigger && !isTicketTrigger

  if (!name) return { error: 'Dê um nome pra automação.' }
  if (isOutcomeTrigger && !trigger_pipeline_id) return { error: 'Escolha o funil do gatilho.' }
  if (isTagTrigger && !trigger_tag_id) return { error: 'Escolha a tag do gatilho.' }
  if (isStageBasedTrigger && !trigger_stage_id) return { error: 'Escolha a etapa do gatilho.' }
  if ((trigger_type === 'days_without_progress' || isExpirationTrigger) && !days_threshold) {
    return { error: 'Informe quantos dias até disparar.' }
  }

  if (isTicketTrigger && action_type !== 'send_email') return { error: 'Esse gatilho só funciona com a ação "Enviar e-mail".' }
  if (action_type === 'send_whatsapp' && !whatsapp_template_id) return { error: 'Escolha o template de WhatsApp.' }

  if (action_type === 'move_to_stage' && !target_stage_id) return { error: 'Escolha a etapa de destino.' }
  if (action_type === 'create_task' && !task_content) return { error: 'Descreva a tarefa a ser criada.' }
  if (action_type === 'send_email' && !email_template_id) return { error: 'Escolha o template de e-mail.' }
  if (action_type === 'notify_user' && !notify_user_id) return { error: 'Escolha quem deve ser notificado.' }

  const supabase = await createClient()
  const { error } = await supabase.from('automation_rules').insert({
    name,
    trigger_type,
    trigger_stage_id,
    trigger_pipeline_id,
    trigger_tag_id,
    days_threshold,
    action_type,
    target_stage_id,
    target_pipeline_id,
    task_content,
    email_template_id,
    whatsapp_template_id,
    notify_user_id,
    notify_message,
  })

  if (error) return { error: error.message }
  revalidatePath('/automations')
  return {}
}

export async function toggleAutomationRule(ruleId: string, isActive: boolean): Promise<ActionState> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem alterar isso.' }
  const supabase = await createClient()
  const { error } = await supabase.from('automation_rules').update({ is_active: isActive }).eq('id', ruleId)
  if (error) return { error: error.message }
  revalidatePath('/automations')
  return {}
}

// ------------------------------------------------------------
// Executa a AÇÃO de uma regra já disparada — compartilhada entre os
// três gatilhos (entrar em etapa, tempo parado, desfecho), pra não
// repetir a mesma lógica em três lugares diferentes.
// ------------------------------------------------------------
export async function executeAutomationAction(
  rule: {
    id: string
    name: string
    action_type: string
    target_stage_id: string | null
    task_content: string | null
    email_template_id: string | null
    whatsapp_template_id: string | null
    notify_user_id: string | null
    notify_message: string | null
  },
  contractId: string,
  pipelineRunId: string | null
): Promise<void> {
  const supabase = (await createScopedAdmin())

  if ((rule.action_type === 'move_to_stage' || rule.action_type === 'move_to_pipeline') && rule.target_stage_id) {
    await supabase.from('activities').insert({
      contract_id: contractId,
      pipeline_run_id: pipelineRunId,
      type: 'automation_triggered',
      content: `Automação "${rule.name}" disparada.`,
      metadata: { rule_id: rule.id },
    })
    const { moveContractStage } = await import('./pipeline')
    await moveContractStage(contractId, rule.target_stage_id)
  } else if (rule.action_type === 'create_task' && rule.task_content) {
    await supabase.from('activities').insert({
      contract_id: contractId,
      pipeline_run_id: pipelineRunId,
      type: 'task',
      content: rule.task_content,
    })
  } else if (rule.action_type === 'notify_user' && rule.notify_user_id) {
    await supabase.from('notifications').insert({
      user_id: rule.notify_user_id,
      message: rule.notify_message || `Automação "${rule.name}" disparada num contrato.`,
    })
    await supabase.from('activities').insert({
      contract_id: contractId,
      pipeline_run_id: pipelineRunId,
      type: 'automation_triggered',
      content: `Automação "${rule.name}" disparada — notificação enviada.`,
      metadata: { rule_id: rule.id },
    })
  } else if (rule.action_type === 'send_email' && rule.email_template_id) {
    const { sendAutomatedTemplateEmail } = await import('./email')
    await sendAutomatedTemplateEmail(contractId, rule.email_template_id)
  } else if (rule.action_type === 'send_whatsapp' && rule.whatsapp_template_id) {
    const { sendAutomatedWhatsAppTemplateMessage } = await import('./whatsapp')
    await sendAutomatedWhatsAppTemplateMessage(contractId, rule.whatsapp_template_id)
  }
}

export async function deleteAutomationRule(ruleId: string) {
  const supabase = (await createScopedAdmin())
  await supabase.from('automation_rules').delete().eq('id', ruleId)
  revalidatePath('/automations')
}

// ------------------------------------------------------------
// Dispara automação por DESFECHO — chamada de dentro do closeRun()
// (Ganho/Perdido ou Renovado/Não renovado, dependendo do pipeline).
// Diferente das outras, essa é por PIPELINE inteiro, não por etapa.
// ------------------------------------------------------------
// ------------------------------------------------------------
// Dispara automação de TICKET VINCULADO a uma conta — chamada tanto
// na criação (se já nasce vinculado) quanto no vínculo manual depois.
// ------------------------------------------------------------
// ------------------------------------------------------------
// Dispara automação de TAG incluída/removida — chamada de dentro de
// setContractTag, tanto pra tag nova quanto pra tag que saiu.
// ------------------------------------------------------------
export async function checkAndTriggerTagAutomations(
  contractId: string,
  tagId: string,
  kind: 'tag_added' | 'tag_removed'
): Promise<void> {
  const supabase = (await createScopedAdmin())

  const { data: rules } = await supabase
    .from('automation_rules')
    .select('*')
    .eq('trigger_type', kind)
    .eq('trigger_tag_id', tagId)
    .eq('is_active', true)

  const { data: run } = await supabase.from('pipeline_runs').select('id').eq('contract_id', contractId).eq('status', 'open').maybeSingle()

  for (const rule of rules ?? []) {
    await executeAutomationAction(rule, contractId, run?.id ?? null)
  }
}

export async function checkAndTriggerTicketLinkedAutomations(ticketId: string): Promise<void> {
  const supabase = (await createScopedAdmin())

  const { data: rules } = await supabase
    .from('automation_rules')
    .select('*')
    .eq('trigger_type', 'ticket_linked')
    .eq('is_active', true)

  for (const rule of rules ?? []) {
    if (rule.action_type === 'send_email' && rule.email_template_id) {
      const { sendAutomatedTicketTemplateEmail } = await import('./email')
      await sendAutomatedTicketTemplateEmail(ticketId, rule.email_template_id)
    }
    // Outras ações (notificar, tarefa) não fazem muito sentido nesse
    // gatilho específico por enquanto — fica reservado pra "enviar
    // e-mail", que é o caso de uso pedido.
  }
}

export async function checkAndTriggerOutcomeAutomations(
  contractId: string,
  pipelineId: string,
  pipelineRunId: string,
  outcome: 'won' | 'lost'
): Promise<void> {
  const supabase = (await createScopedAdmin())

  const { data: rules } = await supabase
    .from('automation_rules')
    .select('*')
    .eq('trigger_type', outcome === 'won' ? 'outcome_won' : 'outcome_lost')
    .eq('trigger_pipeline_id', pipelineId)
    .eq('is_active', true)

  for (const rule of rules ?? []) {
    await executeAutomationAction(rule, contractId, pipelineRunId)
  }
}

// ------------------------------------------------------------
// Verificação por tempo — chamada pelo cron diário. Olha cada regra
// "dias sem avançar", acha contratos parados na etapa monitorada há
// tempo demais, e dispara a ação — só UMA vez por contrato/regra (por
// isso a tabela automation_rule_triggers), senão disparava de novo
// todo dia enquanto o contrato continuasse parado ali.
// ------------------------------------------------------------
export async function checkAndTriggerTimeBasedAutomations(): Promise<{ checked: number; triggered: number }> {
  const supabase = (await createScopedAdmin())

  const { data: rules } = await supabase
    .from('automation_rules')
    .select('*')
    .eq('trigger_type', 'days_without_progress')
    .eq('is_active', true)

  let triggered = 0

  for (const rule of rules ?? []) {
    if (!rule.trigger_stage_id || !rule.days_threshold) continue

    const { data: stuckRuns } = await supabase
      .from('pipeline_runs')
      .select('id, contract_id, stage_entered_at')
      .eq('stage_id', rule.trigger_stage_id)
      .eq('status', 'open')

    for (const run of stuckRuns ?? []) {
      const daysStuck = Math.floor((Date.now() - new Date(run.stage_entered_at).getTime()) / 86_400_000)
      if (daysStuck < rule.days_threshold) continue

      // Já disparou antes pra esse contrato+regra? Não dispara de novo.
      const { data: existingTrigger } = await supabase
        .from('automation_rule_triggers')
        .select('id')
        .eq('rule_id', rule.id)
        .eq('contract_id', run.contract_id)
        .maybeSingle()
      if (existingTrigger) continue

      await supabase.from('automation_rule_triggers').insert({ rule_id: rule.id, contract_id: run.contract_id })

      if ((rule.action_type === 'move_to_stage' || rule.action_type === 'move_to_pipeline') && rule.target_stage_id) {
        const { moveContractStage } = await import('./pipeline')
        await moveContractStage(run.contract_id, rule.target_stage_id)
      } else if (rule.action_type === 'create_task' && rule.task_content) {
        await supabase.from('activities').insert({
          contract_id: run.contract_id,
          pipeline_run_id: run.id,
          type: 'task',
          content: rule.task_content,
        })
      } else if (rule.action_type === 'notify_user' && rule.notify_user_id) {
        await supabase.from('notifications').insert({
          user_id: rule.notify_user_id,
          message: rule.notify_message || `Automação "${rule.name}": um contrato está parado há ${daysStuck} dias.`,
        })
      } else if (rule.action_type === 'send_email' && rule.email_template_id) {
        const { sendAutomatedTemplateEmail } = await import('./email')
        await sendAutomatedTemplateEmail(run.contract_id, rule.email_template_id)
      }

      await supabase.from('activities').insert({
        contract_id: run.contract_id,
        pipeline_run_id: run.id,
        type: 'automation_triggered',
        content: `Automação "${rule.name}" disparada — contrato parado há ${daysStuck} dias na etapa.`,
        metadata: { rule_id: rule.id },
      })

      triggered++
    }
  }

  return { checked: rules?.length ?? 0, triggered }
}

// ------------------------------------------------------------
// Verificação de "dias antes do vencimento" — também chamada pelo
// cron diário. Olha a vigência (valid_until) de cada contrato e
// dispara quando faltar exatamente o número de dias configurado.
// ------------------------------------------------------------
export async function checkAndTriggerExpirationAutomations(): Promise<{ checked: number; triggered: number }> {
  const supabase = (await createScopedAdmin())

  const { data: rules } = await supabase
    .from('automation_rules')
    .select('*')
    .eq('trigger_type', 'days_before_expiration')
    .eq('is_active', true)

  let triggered = 0

  for (const rule of rules ?? []) {
    if (!rule.days_threshold) continue

    const targetDate = new Date()
    targetDate.setDate(targetDate.getDate() + rule.days_threshold)
    const targetDateStr = targetDate.toISOString().slice(0, 10)

    const { data: expiringContracts } = await supabase.from('contracts').select('id, valid_until').eq('valid_until', targetDateStr)

    for (const contract of expiringContracts ?? []) {
      // Se a regra tem um funil configurado, só considera contratos
      // que estão ATUALMENTE nesse funil.
      if (rule.trigger_pipeline_id) {
        const { data: run } = await supabase
          .from('pipeline_runs')
          .select('id, pipeline_id')
          .eq('contract_id', contract.id)
          .eq('status', 'open')
          .maybeSingle()
        if (!run || run.pipeline_id !== rule.trigger_pipeline_id) continue
      }

      const { data: existingTrigger } = await supabase
        .from('automation_rule_triggers')
        .select('id')
        .eq('rule_id', rule.id)
        .eq('contract_id', contract.id)
        .maybeSingle()
      if (existingTrigger) continue

      await supabase.from('automation_rule_triggers').insert({ rule_id: rule.id, contract_id: contract.id })

      const { data: run } = await supabase.from('pipeline_runs').select('id').eq('contract_id', contract.id).eq('status', 'open').maybeSingle()
      await executeAutomationAction(rule, contract.id, run?.id ?? null)

      await supabase.from('activities').insert({
        contract_id: contract.id,
        type: 'automation_triggered',
        content: `Automação "${rule.name}" disparada — vencimento em ${rule.days_threshold} dias.`,
        metadata: { rule_id: rule.id },
      })

      triggered++
    }
  }

  return { checked: rules?.length ?? 0, triggered }
}
