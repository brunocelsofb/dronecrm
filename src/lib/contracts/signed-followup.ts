// Contrato/aditivo assinado → tarefa para o consultor dar ganho (validando
// vigência, valor e afins à mão) + aviso no WhatsApp do gestor da empresa
// (Configurações → Agentes IA → Gestor). Nada muda de etapa sozinho.
// Usado pela ZapSign (todos assinaram) e pelo anexo marcado "já assinado"
// (contrato do cliente, assinado fora do CRM).

import { createAdminClient } from '@/lib/supabase/admin'
import { createAgentActivity } from '@/lib/agent/agent-activity'
import { sendWhatsApp } from '@/lib/agent/briefing-core'

export async function onContractSigned(opts: {
  tenantId: string
  contractId: string
  documentName: string
  kind: 'contrato' | 'aditivo'
  via: 'zapsign' | 'anexo'
  dedupeKey: string
  appUrl: string | null
}): Promise<{ task: string; whatsapp: string }> {
  const admin = createAdminClient()
  const { data: c } = await admin.from('contracts')
    .select('id, client_name, process_number, owner_id, current_assignee_id')
    .eq('id', opts.contractId).eq('tenant_id', opts.tenantId).maybeSingle()
  if (!c) return { task: 'contrato não encontrado', whatsapp: 'não enviado' }
  const ownerId = c.owner_id ?? c.current_assignee_id ?? null
  const { data: owner } = ownerId ? await admin.from('profiles').select('full_name').eq('id', ownerId).maybeSingle() : { data: null }
  const cliente = c.client_name ?? 'cliente'
  const isAditivo = opts.kind === 'aditivo'
  const origem = opts.via === 'zapsign' ? 'assinado por todos na ZapSign' : 'anexado como já assinado'

  const task = await createAgentActivity(admin, {
    contractId: c.id,
    dedupeKey: opts.dedupeKey,
    agent: isAditivo ? 'farmer' : 'hunter',
    activityType: 'task',
    dueInDays: 1,
    assignedTo: ownerId,
    title: isAditivo ? `Aditivo assinado — atualizar o contrato · ${cliente}` : `Contrato assinado — validar e dar ganho · ${cliente}`,
    content:
      `"${opts.documentName}" foi ${origem}. O PDF está na aba Contrato e aditivos.\n\n` +
      (isAditivo
        ? `Antes de concluir, confira e atualize no CRM o que o aditivo mudou:\n` +
          `• vigência (novo início e fim)\n• valor mensal / reajuste\n• escopo, equipe e quantidades\n`
        : `Antes de dar ganho, confira e preencha à mão:\n` +
          `• vigência (início e fim)\n• valor mensal e tipo de receita (recorrente ou medição)\n` +
          `• número do contrato/processo\n• responsável pela carteira\n` +
          `Depois, marque a oportunidade como ganha.\n`) +
      `\nDica: o Admin pode pedir a leitura do contrato (Farmer) para conferir datas e valores.`,
    metadata: { kind: isAditivo ? 'signed_addendum' : 'signed_win', via: opts.via },
  })

  const link = opts.appUrl ? `\n${opts.appUrl}/contracts/${c.id}` : ''
  const text =
    `✍️ *${isAditivo ? 'Aditivo' : 'Contrato'} assinado*\n` +
    `Cliente: ${cliente}${c.process_number ? ` (nº ${c.process_number})` : ''}\n` +
    `Documento: ${opts.documentName} — ${origem}\n` +
    `Consultor: ${owner?.full_name ?? 'sem responsável'}\n` +
    `Próximo passo: ${isAditivo ? 'atualizar vigência/valor no CRM' : 'validar vigência e valor e dar ganho'} (tarefa criada).` + link
  let whatsapp = 'não enviado'
  // só avisa quando a tarefa foi criada agora (evita aviso repetido)
  if (task.status === 'created') {
    try {
      const r = await sendWhatsApp(text, opts.tenantId)
      whatsapp = r.sent ? 'enviado' : `falhou: ${r.error}`
    } catch (e) {
      whatsapp = `falhou: ${e instanceof Error ? e.message : String(e)}`
    }
  }
  const taskTxt = task.status === 'created' ? 'criada' : task.status === 'skipped' ? `não criada (${task.reason})` : `erro: ${task.error}`
  console.log(`[assinatura] contrato ${c.id} · ${opts.documentName} · tarefa ${taskTxt} · WhatsApp gestor ${whatsapp}`)
  return { task: taskTxt, whatsapp }
}
