import { fmtPct, fmtNum1, fmtBRL } from '@/lib/format'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { readApresentacao, sectionsToApply, writePriceBlocks } from '@/lib/proposals/price-sections'
import { verifyPriceLinkToken } from '@/lib/proposals/price-link'

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

  // Price é recurso do plano: empresa sem ele não recebe precificação do Price
  {
    const { data: ct } = await createAdminClient().from('contracts').select('tenant_id').eq('id', contract_id).maybeSingle()
    const { getProposalConfig } = await import('@/lib/proposals/settings')
    if (!ct || !(await getProposalConfig(ct.tenant_id as string)).priceEnabled) {
      return NextResponse.json({ error: 'O Price não está liberado no plano desta empresa.' }, { status: 403, headers: CORS })
    }
  }

  // Só aceita quem abriu o Price pela proposta no CRM (passe assinado, ver lib/proposals/price-link.ts)
  const pass = verifyPriceLinkToken(body.crm_token, String(contract_id), proposal_id ?? null)
  if (pass !== 'ok') {
    console.warn('[from-price] passe recusado:', pass, contract_id)
    return NextResponse.json({
      error: pass === 'expired'
        ? 'O link do Price expirou. Abra o Price de novo pela proposta no CRM e envie outra vez.'
        : 'Envio não autorizado. Abra o Price pela proposta no CRM (botão Abrir Price) e envie de novo.',
      code: `token_${pass}`,
    }, { status: 401, headers: CORS })
  }

  const supabase = createAdminClient()

  // 1. Valor: em vendas o Price muda só a previsão do funil (valor da oportunidade). O valor do
  //    contrato (cadastro/"Valor vigente") só muda na aprovação final do cliente
  //    (api/proposals/client-review), em qualquer funil.
  const { data: prevProp } = proposal_id
    ? await supabase.from('proposals').select('proposal_value, control_code, version').eq('id', proposal_id).eq('contract_id', contract_id).maybeSingle()
    : { data: null }
  const previousValue = Number(prevProp?.proposal_value) || 0
  const { data: openRun } = await supabase.from('pipeline_runs')
    .select('id, pipeline_id').eq('contract_id', contract_id).eq('status', 'open').maybeSingle()
  const { data: runPipeline } = openRun
    ? await supabase.from('pipelines').select('type').eq('id', openRun.pipeline_id).maybeSingle()
    : { data: null }
  const isRenewal = runPipeline?.type === 'gestao_contratos'
  // O valor do contrato (cadastro) só muda na aprovação do cliente; aqui só a previsão do funil de vendas.
  if (openRun && !isRenewal) {
    await supabase.from('pipeline_runs').update({ value: proposal_value }).eq('id', openRun.id)
  }

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

  // 3a. Apresentação ao Cliente do Price (seções já calculadas): a proposta espelha o Price.
  //     Cada seção vira um bloco da montagem; itens = os mesmos do resumo do Price.
  const apresentacao = proposal_id ? readApresentacao(snap) : null
  let priceSync: string | null = null
  if (apresentacao) {
    const { data: prop } = await supabase.from('proposals')
      .select('id, contract_id, tenant_id, status, workflow_status, price_sections_hidden')
      .eq('id', proposal_id).maybeSingle()
    const closed = ['cliente_aprovado', 'cliente_recusado', 'declinada'].includes(prop?.workflow_status ?? '')
    if (!prop || prop.contract_id !== contract_id) {
      return NextResponse.json({ error: 'Proposta não pertence a esta oportunidade.' }, { status: 400, headers: CORS })
    }
    if (prop.status === 'draft' && !closed) {
      const tenantId = prop.tenant_id as string
      const { data: org } = await supabase.from('organization_settings')
        .select('price_sections, proposal_brand_color').eq('tenant_id', tenantId).maybeSingle()
      const secoes = sectionsToApply(apresentacao, (org?.price_sections as string[] | null) ?? null, prop.price_sections_hidden as string[] | null)
      const w = await writePriceBlocks(supabase, { proposalId: prop.id, tenantId, secoes, headerColor: org?.proposal_brand_color, mode: 'replace' })
      if (w.error) console.error('[from-price] blocos:', w.error)

      const itens = apresentacao.itens ?? []
      if (itens.length) {
        const categoria = snap?.tipoEngenharia ? `Engenharia ${snap.tipoEngenharia}` : null
        const rows = itens.map((it, i) => ({
          proposal_id: prop.id,
          tenant_id: tenantId,
          position: i,
          quantity: 1,
          category: categoria,
          item: it.titulo.slice(0, 300),
          characteristics: (it.descricao ?? '').slice(0, 500) || null,
          type: it.tipo === 'Pontual' ? 'Pontual' : 'MRR',
          delivery_forecast: null,
          unit_value: Math.round(Number(it.valorMensal) * 100) / 100,
          discount: 0,
          subtotal: Math.round(Number(it.valorMensal) * 100) / 100,
        }))
        await supabase.from('proposal_items').delete().eq('proposal_id', prop.id).eq('tenant_id', tenantId)
        const { error: itErr } = await supabase.from('proposal_items').insert(rows)
        if (itErr) console.error('[from-price] itens:', itErr.message)
      }
      const dur = Number(apresentacao.duracaoMeses ?? snap?.contractDuration) || null
      await supabase.from('proposals').update({
        is_recurring: true,
        ...(dur ? { installments: dur } : {}),
        updated_at: new Date().toISOString(),
      }).eq('id', prop.id).eq('tenant_id', tenantId)
      priceSync = `${secoes.length} seções da apresentação`
    }
  }

  // 3b. Formato antigo (Price sem a apresentação): cria/atualiza proposta com itens do Price
  if (snap && !apresentacao) {
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
  const v = Number(proposal_value)
  const changed = previousValue > 0 && Math.abs(previousValue - v) >= 0.005
  const content = previousValue > 0
    ? (changed
        ? `Precificação atualizada no Price: ${fmtBRL(v)}/mês (antes ${fmtBRL(previousValue)}/mês).`
        : `Precificação reenviada pelo Price, sem mudança de valor: ${fmtBRL(v)}/mês.`)
    : `Proposta precificada no Price: ${fmtBRL(v)}/mês.`
  // Reenvio igual em sequência (ex.: clique duplo) não repete o registro no histórico
  let duplicate = false
  if (proposal_id && !changed) {
    const since = new Date(Date.now() - 10 * 60_000).toISOString()
    const { data: recent } = await supabase.from('activities').select('id')
      .eq('contract_id', contract_id).eq('type', 'proposal')
      .eq('metadata->>proposal_id', proposal_id).eq('metadata->>actor', 'Price')
      .gte('created_at', since).limit(1)
    duplicate = !!recent?.length
  }
  if (!duplicate) await supabase.from('activities').insert({
    contract_id,
    type: 'proposal', // 'price' não é aceito na tabela de atividades
    metadata: proposal_id ? {
      proposal_id, contract_id, actor: 'Price', kind: previousValue > 0 ? 'price_update' : 'price_first',
      control_code: prevProp?.control_code ?? null, version: prevProp?.version ?? null, proposal_value: v || null,
    } : null,
    content: isRenewal && (changed || previousValue === 0)
      ? `${content} O valor vigente do contrato só muda após a aprovação final do cliente.`
      : content,
  })

  return NextResponse.json({ ok: true }, { headers: CORS })
}
