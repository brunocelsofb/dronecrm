import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Conversa do WhatsApp → oportunidade no funil escolhido.
// Antes gravava colunas que não existem (status, value, entered_at) e sem o
// número da oportunidade — a criação falhava. Agora segue o mesmo formato da
// criação normal e, se vier de um lead, leva a origem (campanha) junto.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { phone, leadId, pipelineId, stageId, title, value, companyId } = await req.json()

  try {
    const cleanPhone = String(phone ?? '').replace(/\D/g, '')

    const { data: stage } = await supabase.from('stages').select('id, pipeline_id').eq('id', stageId).maybeSingle()
    if (!stage || stage.pipeline_id !== pipelineId) return NextResponse.json({ error: 'Etapa inválida para o funil escolhido.' }, { status: 400 })

    const { data: lead } = leadId
      ? await supabase.from('leads').select('id, name, source, campaign_id, status').eq('id', leadId).maybeSingle()
      : { data: null }

    let processNumber = `OPP-${Date.now()}`
    try {
      const { data: seq } = await supabase.rpc('next_opportunity_number' as never)
      if (seq) processNumber = seq as unknown as string
    } catch { /* sem sequência: usa o provisório */ }

    const name = String(title || lead?.name || `Oportunidade ${phone ?? ''}`).trim()
    const { data: contract, error } = await supabase.from('contracts').insert({
      process_number: processNumber,
      title: name,
      client_name: name,
      owner_id: user.id,
      current_assignee_id: user.id,
      company_id: companyId || null,
      lead_id: lead?.id ?? null,
      campaign_id: lead?.campaign_id ?? null,
      lead_source: lead?.source ?? 'whatsapp',
    }).select('id').single()

    if (error || !contract) {
      console.error('[convert-lead]', error?.message)
      return NextResponse.json({ error: error?.message ?? 'Erro ao criar oportunidade' }, { status: 500 })
    }

    const now = new Date().toISOString()
    const amount = Number(value)
    const { data: run, error: runError } = await supabase.from('pipeline_runs').insert({
      contract_id: contract.id,
      pipeline_id: pipelineId,
      stage_id: stageId,
      stage_entered_at: now,
      status: 'open',
      value: Number.isFinite(amount) && amount > 0 ? amount : null,
      created_by: user.id,
    }).select('id').single()
    if (runError || !run) {
      await supabase.from('contracts').delete().eq('id', contract.id)
      return NextResponse.json({ error: `Falha ao colocar no funil: ${runError?.message ?? 'erro desconhecido'}` }, { status: 500 })
    }
    await supabase.from('stage_history').insert({ pipeline_run_id: run.id, stage_id: stageId, entered_at: now, changed_by: user.id })

    // Vincula mensagens WhatsApp ao contrato
    if (cleanPhone.length >= 8) {
      await supabase.from('contract_whatsapp_messages')
        .update({ contract_id: contract.id })
        .ilike('phone', `%${cleanPhone.slice(-10)}`)
        .is('contract_id', null)
    }

    if (lead && lead.status !== 'convertido') {
      await supabase.from('leads').update({ status: 'convertido', converted_contract_id: contract.id, updated_at: now }).eq('id', lead.id)
    }

    return NextResponse.json({ ok: true, contractId: contract.id })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 })
  }
}
