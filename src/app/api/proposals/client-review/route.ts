import { fmtPct, fmtNum1 } from '@/lib/format'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidCpf } from '@/lib/utils/cpf'

export async function POST(req: Request) {
  const { token, contract_id, status, name, role, cpf, comment } = await req.json()
  if (!token || !status || !name?.trim()) {
    return NextResponse.json({ error: 'Parametros obrigatorios ausentes' }, { status: 400 })
  }
  // Normaliza: 'declinado' é alias legado de 'recusado'
  const normalizedStatus = status === 'declinado' ? 'recusado' : status
  const isAprovado = normalizedStatus === 'aprovado'

  if (status === 'aprovado') {
    if (!cpf?.trim()) return NextResponse.json({ error: 'CPF obrigatorio para aceitar a proposta' }, { status: 400 })
    if (!isValidCpf(cpf)) return NextResponse.json({ error: 'CPF invalido. Verifique o numero informado.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()
  const nowFmt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const label = status === 'aprovado'
    ? `✅ Proposta aceita digitalmente pelo cliente`
    : `❌ Proposta recusada pelo cliente`

  // Novo modelo: busca em proposals pelo token
  const { data: newProposal } = await admin
    .from('proposals')
    .select('id, contract_id, control_code, proposal_value')
    .eq('client_review_token', token)
    .maybeSingle()

  if (newProposal) {
    const newWorkflowStatus = isAprovado ? 'cliente_aprovado' : 'cliente_recusado'
    const { data: contractData } = await admin
      .from('contracts').select('client_name, title').eq('id', newProposal.contract_id).maybeSingle()
    const oppName = contractData?.client_name ?? contractData?.title ?? 'Oportunidade'
    const cpfFmt = cpf ? cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : null
    const valueFmt = newProposal.proposal_value
      ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(newProposal.proposal_value))
      : null

    await admin.from('proposals').update({
      client_status: normalizedStatus,
      client_approved_at: now,
      client_approved_by_name: name,
      client_approved_by_cpf: cpf || null,
      workflow_status: newWorkflowStatus,
      updated_at: now,
    }).eq('id', newProposal.id)

    // Aprovação final do cliente: o valor da proposta passa a ser o valor do contrato
    // (funil aberto e valor vigente do cadastro — o que aparece em "Valor vigente do contrato").
    if (isAprovado && newProposal.proposal_value) {
      const newVal = Number(newProposal.proposal_value)
      const [{ data: openRun }, { data: cur }] = await Promise.all([
        admin.from('pipeline_runs').select('id, value').eq('contract_id', newProposal.contract_id).eq('status', 'open').maybeSingle(),
        admin.from('contracts').select('monthly_value').eq('id', newProposal.contract_id).maybeSingle(),
      ])
      const oldValue = Number(cur?.monthly_value) || Number(openRun?.value) || 0
      if (openRun) await admin.from('pipeline_runs').update({ value: newVal }).eq('id', openRun.id)
      await admin.from('contracts').update({ monthly_value: newVal }).eq('id', newProposal.contract_id)
      if (Math.abs(oldValue - newVal) >= 0.005) {
        const pct = oldValue > 0 ? Math.round(((newVal - oldValue) / oldValue) * 1000) / 10 : null
        const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
        await admin.from('activities').insert({
          contract_id: newProposal.contract_id,
          pipeline_run_id: openRun?.id ?? null,
          type: 'system',
          content: pct !== null
            ? `Valor do contrato atualizado para ${fmtBRL(newVal)} via proposta ${newProposal.control_code} (${fmtPct(pct, { signed: true })} sobre ${fmtBRL(oldValue)}).`
            : `Valor do contrato atualizado para ${fmtBRL(newVal)} via proposta ${newProposal.control_code}.`,
        })
      }
    }

    // Central de regras (Quando o cliente aprova a proposta): tarefa para o responsável dar o ganho
    if (isAprovado) {
      try {
        const { eventOn } = await import('@/lib/rules/events-server')
        const { resolveTenantId } = await import('@/lib/tenant/context')
        const tenantId = await resolveTenantId({ contractId: newProposal.contract_id })
        if (await eventOn(tenantId, 'proposal_approved_task')) {
          const { createAgentActivity, agentForPipelineType, AGENT_LABEL } = await import('@/lib/agent/agent-activity')
          const [{ data: c }, { data: run }] = await Promise.all([
            admin.from('contracts').select('client_name, owner_id, current_assignee_id').eq('id', newProposal.contract_id).maybeSingle(),
            admin.from('pipeline_runs').select('pipeline_id').eq('contract_id', newProposal.contract_id).eq('status', 'open').maybeSingle(),
          ])
          const { data: pipe } = run ? await admin.from('pipelines').select('type').eq('id', run.pipeline_id).maybeSingle() : { data: null }
          const renewal = pipe?.type === 'gestao_contratos'
          const agent = agentForPipelineType(pipe?.type)
          const act = renewal ? 'marcar Renovado' : 'dar o ganho'
          const r = await createAgentActivity(admin, {
            contractId: newProposal.contract_id,
            dedupeKey: `proposal_approved:${newProposal.id}`,
            dedupeIncludeDone: true,
            dueInDays: 1,
            assignedTo: (c?.owner_id ?? c?.current_assignee_id ?? null) as string | null,
            activityType: 'task',
            agent,
            title: `Proposta aprovada pelo cliente — ${act} (${c?.client_name ?? oppName})`,
            content:
              `[${AGENT_LABEL[agent]}] O cliente aprovou a proposta ${newProposal.control_code}` +
              `${valueFmt ? ` (${valueFmt}/mês)` : ''} em ${nowFmt}, por ${name}${role ? ` (${role})` : ''}.\n` +
              `Confira e ${act} na oportunidade para seguir${renewal ? ' com a renovação' : ' para o funil de contratos'}.` +
              `${newProposal.proposal_value ? ' O valor do contrato já foi atualizado com o valor aprovado.' : ''}`,
            metadata: { kind: 'proposal_approved', proposal_id: newProposal.id },
          })
          if (r.status === 'error') console.error('[client-review] tarefa de ganho não criada:', r.error)
        }
      } catch (e) {
        console.error('[client-review] tarefa de ganho:', e)
      }
    }

    const logContent = isAprovado
      ? `✅ Proposta ${newProposal.control_code} aceita na oportunidade "${oppName}"${valueFmt ? ` · Valor: ${valueFmt}` : ''}. Aprovado por: ${name}${role ? ` (${role})` : ''}${cpfFmt ? ` · CPF: ${cpfFmt}` : ''}. Data/Hora: ${nowFmt}.`
      : `❌ Proposta ${newProposal.control_code} RECUSADA na oportunidade "${oppName}". Motivo: ${comment?.trim() || 'Não informado'}. Por: ${name}${role ? ` (${role})` : ''}${cpfFmt ? ` · CPF: ${cpfFmt}` : ''}. Data/Hora: ${nowFmt}.`

    await admin.from('activities').insert({
      contract_id: newProposal.contract_id,
      type: 'client_decision',
      metadata: { outcome: isAprovado ? 'aprovado' : 'recusado', proposal_id: newProposal.id },
      content: logContent,
    })
    return NextResponse.json({ ok: true })
  }

  // Fallback legado
  const { data: legacyProposal } = await admin
    .from('proposal_status')
    .select('client_review_token, contract_id')
    .eq('client_review_token', token)
    .maybeSingle()

  if (!legacyProposal) return NextResponse.json({ error: 'Token inválido' }, { status: 404 })

  const legacyWorkflow = isAprovado ? 'cliente_aprovado' : 'cliente_recusado'

  await admin.from('proposal_status').update({
    client_status: normalizedStatus,
    client_approved_at: now,
    client_approved_by_name: name,
    client_approved_by_cpf: cpf || null,
    status: legacyWorkflow,
    updated_at: now,
  }).eq('client_review_token', token)

  await admin.from('proposals').update({
    workflow_status: legacyWorkflow,
    client_status: normalizedStatus,
    client_approved_at: now,
    client_approved_by_name: name,
    client_approved_by_cpf: cpf || null,
    updated_at: now,
  }).eq('contract_id', legacyProposal.contract_id)
    .not('workflow_status', 'eq', 'rascunho')

  const legacyLogContent = isAprovado
    ? `✅ Proposta aceita pelo cliente — ${name}${cpf ? ` · CPF: ${cpf}` : ''}${comment ? ` · Obs: ${comment}` : ''}. Data/Hora: ${nowFmt}.`
    : `❌ Proposta RECUSADA. Motivo: ${comment?.trim() || 'Não informado'}. Por: ${name}${cpf ? ` · CPF: ${cpf}` : ''}. Data/Hora: ${nowFmt}.`

  await admin.from('activities').insert({
    contract_id: legacyProposal.contract_id,
    type: 'client_decision',
      metadata: { outcome: isAprovado ? 'aprovado' : 'recusado' },
    content: legacyLogContent,
  })
  return NextResponse.json({ ok: true })
}
