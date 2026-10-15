import { fmtPct, fmtNum1 } from '@/lib/format'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

function san(s: string | null | undefined): string {
  if (!s) return ''
  const map: Record<string, string> = {
    '\u00e1':'a','\u00e0':'a','\u00e3':'a','\u00e2':'a',
    '\u00c1':'A','\u00c0':'A','\u00c3':'A','\u00c2':'A',
    '\u00e9':'e','\u00e8':'e','\u00ea':'e',
    '\u00c9':'E','\u00ca':'E',
    '\u00ed':'i','\u00ee':'i','\u00cd':'I',
    '\u00f3':'o','\u00f5':'o','\u00f4':'o',
    '\u00d3':'O','\u00d4':'O','\u00d5':'O',
    '\u00fa':'u','\u00fb':'u','\u00da':'U',
    '\u00e7':'c','\u00c7':'C',
  }
  return Array.from(s).map(c => map[c] ?? (c.charCodeAt(0) > 127 ? '' : c)).join('')
}

async function generateControlCode(supabase: any): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `PROP-${year}-`
  const { data } = await supabase
    .from('proposals')
    .select('control_code')
    .ilike('control_code', `${prefix}%`)
    .order('control_code', { ascending: false })
    .limit(1)
  const last = data?.[0]?.control_code
  const lastNum = last ? parseInt(last.replace(prefix, ''), 10) : 0
  return `${prefix}${String((isNaN(lastNum) ? 0 : lastNum) + 1).padStart(4, '0')}`
}

export async function POST(req: Request) {
  const body = await req.json()
  const { contract_id, proposal_id, proposal_value, margem_pct, technical_snapshot: snap } = body

  if (!contract_id || !proposal_value) {
    return NextResponse.json({ error: 'contract_id e proposal_value são obrigatórios' }, { status: 400, headers: CORS })
  }

  const supabase = createAdminClient()

  // 1. Atualiza o run com o valor
  await supabase
    .from('pipeline_runs')
    .update({ value: proposal_value })
    .eq('contract_id', contract_id)
    .eq('status', 'open')

  // 2. Gera review_token único para amarrar snapshot ao Price
  const { randomBytes } = await import('crypto')
  const reviewToken = randomBytes(24).toString('hex')

  // 3. Salva snapshot na proposals (novo modelo 1:N) ou proposal_status (fallback legado)
  if (proposal_id) {
    // Novo modelo: salva direto na linha da proposta
    const { error: propError } = await supabase.from('proposals').update({
      proposal_value,
      technical_snapshot: snap ?? null,
      review_token: reviewToken,
      updated_at: new Date().toISOString(),
    }).eq('id', proposal_id)
    if (propError) {
      console.error('[from-price] proposals update error:', propError)
      return NextResponse.json({ error: propError.message }, { status: 500, headers: CORS })
    }
  } else {
    // Fallback legado: proposal_status
    const { data: existing } = await supabase
      .from('proposal_status')
      .select('status, review_token')
      .eq('contract_id', contract_id)
      .maybeSingle()

    const existingToken = existing?.review_token ?? reviewToken
    const { error: upsertError } = await supabase.from('proposal_status').upsert({
      contract_id,
      status: existing?.status ?? 'rascunho',
      proposal_value,
      technical_snapshot: snap ?? null,
      review_token: existingToken,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'contract_id' })

    if (upsertError) {
      console.error('[from-price] upsert error:', upsertError)
      return NextResponse.json({ error: upsertError.message }, { status: 500, headers: CORS })
    }
  }

  // 3. Cria/atualiza proposta no sistema de julho com itens do Price
  if (snap) {
    const dur = snap.contractDuration ?? 12
    const escopo = (snap.escopoSanitizado ?? snap.escopoServicos ?? []).map(san).join(' - ')
    const profs = (snap.professionals ?? []).filter((p: any) => p.role?.trim())
    const equipeDesc = profs.map((p: any) => {
      const carga = p.hoursPerMonth === 220 ? '44h/sem' : p.hoursPerMonth === 180 ? '12x36h' : `${p.hoursPerMonth}h/mes`
      return `0${p.quantity} ${san(p.role)} (${san(p.contractType)}, ${carga})`
    }).join(' | ')

    const characteristics = [
      escopo && `Escopo: ${escopo}`,
      equipeDesc && `Equipe: ${equipeDesc}`,
      snap.dimensionamento?.totalEquipamentos > 0 && `${snap.dimensionamento.totalEquipamentos} equipamentos gerenciados`,
      snap.hospitalBeds > 0 && `${snap.hospitalBeds} leitos`,
    ].filter(Boolean).join(' · ')

    // Monta itens da proposta
    // Ponto 3: título derivado do tipo de engenharia — nunca hardcoded
    const tituloServico = san(
      snap.tituloItemServico?.trim()
        ? snap.tituloItemServico
        : snap.tipoEngenharia === 'Hospitalar'
          ? 'Servico Continuo de Engenharia Hospitalar'
          : 'Servico Continuo de Engenharia Clinica'
    )

    // REGRA: só inclui itens com valor real (> 0) vindo da precificação.
    const items = [
      {
        position: 0,
        quantity: 1,
        category: san(snap.tipoEngenharia === 'Hospitalar' ? 'Engenharia Hospitalar' : 'Engenharia Clinica'),
        item: tituloServico,
        characteristics: characteristics.slice(0, 500),
        type: 'MRR',
        delivery_forecast: null,
        unit_value: Number(proposal_value),
        discount: 0,
        subtotal: Number(proposal_value),
      },
      // Peças e Insumos: só inclui se tiver valor precificado real (pecasServicosTotal > 0)
      (snap.pecasServicosTotal > 0 || snap._priceState?.pecasServicos?.totalPecas > 0) && snap.tituloItemPecas && {
        position: 1,
        quantity: 1,
        category: san(snap.tipoEngenharia === 'Hospitalar' ? 'Engenharia Hospitalar' : 'Engenharia Clinica'),
        item: san(snap.tituloItemPecas),
        characteristics: 'Fornecimento de pecas e insumos sob demanda',
        type: 'MRR',
        delivery_forecast: null,
        unit_value: Number(snap.pecasServicosTotal ?? snap._priceState?.pecasServicos?.totalPecas ?? 0),
        discount: 0,
        subtotal: Number(snap.pecasServicosTotal ?? snap._priceState?.pecasServicos?.totalPecas ?? 0),
      },
      // Serviços Externos: só inclui se tiver valor precificado real (servicosExternosTotal > 0)
      (snap.servicosExternosTotal > 0 || snap._priceState?.pecasServicos?.totalServicos > 0) && snap.tituloItemServicosExternos && {
        position: 2,
        quantity: 1,
        category: san(snap.tipoEngenharia === 'Hospitalar' ? 'Engenharia Hospitalar' : 'Engenharia Clinica'),
        item: san(snap.tituloItemServicosExternos),
        characteristics: 'Servicos especializados externos sob demanda',
        type: 'Pontual',
        delivery_forecast: null,
        unit_value: Number(snap.servicosExternosTotal ?? snap._priceState?.pecasServicos?.totalServicos ?? 0),
        discount: 0,
        subtotal: Number(snap.servicosExternosTotal ?? snap._priceState?.pecasServicos?.totalServicos ?? 0),
      },
    ].filter(Boolean) as any[]

    const validUntil = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
    const controlCode = await generateControlCode(supabase)

    // Verifica se já existe proposta em rascunho para este contrato
    const { data: existingProposal } = await supabase
      .from('proposals')
      .select('id')
      .eq('contract_id', contract_id)
      .eq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let proposalId = existingProposal?.id

    if (proposalId) {
      // Atualiza itens da proposta existente
      await supabase.from('proposal_items').delete().eq('proposal_id', proposalId)
      await supabase.from('proposal_items').insert(
        items.map(it => ({ ...it, proposal_id: proposalId }))
      )
      // Atualiza validade
      await supabase.from('proposals').update({
        valid_until: validUntil,
        is_recurring: true,
        installments: dur,
        payment_terms: `${dur} parcelas mensais`,
        updated_at: new Date().toISOString(),
      }).eq('id', proposalId)
    } else {
      // Cria nova proposta
      const { data: newProposal } = await supabase
        .from('proposals')
        .insert({
          contract_id,
          control_code: controlCode,
          currency: 'BRL',
          valid_until: validUntil,
          is_recurring: true,
          installments: dur,
          payment_terms: `${dur} parcelas mensais`,
          discount_type: null,
          discount_value: 0,
        })
        .select('id')
        .single()

      proposalId = newProposal?.id

      if (proposalId) {
        // Insere itens
        await supabase.from('proposal_items').insert(
          items.map(it => ({ ...it, proposal_id: proposalId }))
        )
        // Adiciona página padrão
        await supabase.from('proposal_pages').insert({
          proposal_id: proposalId,
          position: 0,
          is_standard_proposal: true,
        })
      }
    }

    // Atualiza texto de introdução com objetoContrato + escopo
    const textoAtividades = snap.objetoContrato
      ? `${san(snap.objetoContrato)}\n\n${escopo}`
      : escopo

    await supabase.from('proposal_status').update({
      texto_atividades: textoAtividades || null,
    }).eq('contract_id', contract_id)
  }

  // 4. Atividade
  await supabase.from('activities').insert({
    contract_id,
    type: 'price',
    content: `Proposta precificada no ORBIS Price: R$ ${Number(proposal_value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/mes${margem_pct ? ` · Margem: ${fmtPct(Number(margem_pct))}` : ''}. Itens preenchidos automaticamente.`,
  })

  return NextResponse.json({ ok: true }, { headers: CORS })
}
