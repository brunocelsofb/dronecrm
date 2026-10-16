// Retorno do faturamento (ERP → CRM). Rotina da plataforma, por empresa:
// a chave (Financeiro → Integração) identifica a empresa; o envio é sempre
// procurado DENTRO dela. Serve para Sankhya, TOTVS ou qualquer integração
// intermediária que saiba fazer um POST.
//
// POST /api/faturamento/retorno
// Authorization: Bearer <chave da empresa>
// { "envio_id": "<id do envio no CRM>"  (ou "referencia_erp": "<id no ERP>",
//    ou "cnpj" + "competencia" (AAAA-MM) [+ "tipo"] quando só houver um envio aberto),
//   "numero_nota": "12345", "data_faturamento": "2026-10-30", "valor_faturado": 1234.56 }

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const key = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  if (key.length < 32) return NextResponse.json({ ok: false, error: 'chave ausente' }, { status: 401 })

  const admin = createAdminClient()
  const { data: org } = await admin.from('organization_settings').select('tenant_id').eq('billing_erp->>webhook_secret', key).maybeSingle()
  if (!org?.tenant_id) return NextResponse.json({ ok: false, error: 'chave inválida' }, { status: 401 })

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const envioId = typeof body?.envio_id === 'string' ? body.envio_id : null
  const ref = typeof body?.referencia_erp === 'string' ? body.referencia_erp : null
  const nota = typeof body?.numero_nota === 'string' ? body.numero_nota.trim() : typeof body?.numero_nota === 'number' ? String(body.numero_nota) : ''
  const data = typeof body?.data_faturamento === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.data_faturamento) ? body.data_faturamento : null
  const valor = typeof body?.valor_faturado === 'number' ? Math.round(body.valor_faturado * 100) / 100 : NaN
  const cnpj = typeof body?.cnpj === 'string' ? body.cnpj.replace(/\D/g, '') : ''
  const comp = typeof body?.competencia === 'string' && /^\d{4}-\d{2}$/.test(body.competencia) ? body.competencia : null
  const tipo = body?.tipo === 'recorrente' || body?.tipo === 'medicao' || body?.tipo === 'avulso' ? body.tipo : null
  const byCnpj = !envioId && !ref && cnpj.length === 14 && !!comp
  if ((!envioId && !ref && !byCnpj) || !nota || !data || !Number.isFinite(valor) || valor < 0) {
    return NextResponse.json({ ok: false, error: 'campos obrigatórios: envio_id (ou referencia_erp, ou cnpj + competencia), numero_nota, data_faturamento (AAAA-MM-DD), valor_faturado' }, { status: 400 })
  }

  let sub: { id: string; contract_id: string; status: string; amount_sent: number; year: number; month: number } | null = null
  if (byCnpj) {
    // Contratos da empresa ligados a clientes com esse CNPJ
    const { data: comps } = await admin.from('companies').select('id, cnpj').eq('tenant_id', org.tenant_id)
    const compIds = (comps ?? []).filter(c => (c.cnpj ?? '').replace(/\D/g, '') === cnpj).map(c => c.id)
    const { data: ctrs } = compIds.length ? await admin.from('contracts').select('id').eq('tenant_id', org.tenant_id).in('company_id', compIds) : { data: [] as { id: string }[] }
    const [y, m] = comp!.split('-').map(Number)
    let q = admin.from('billing_submissions').select('id, contract_id, status, amount_sent, year, month')
      .eq('tenant_id', org.tenant_id).eq('year', y).eq('month', m).eq('status', 'enviado').in('contract_id', (ctrs ?? []).map(c => c.id))
    if (tipo) q = q.eq('source_type', tipo)
    const { data: subs } = (ctrs ?? []).length ? await q : { data: [] }
    if (!subs || subs.length === 0) return NextResponse.json({ ok: false, error: 'nenhum envio aberto para esse CNPJ e competência' }, { status: 404 })
    if (subs.length > 1) return NextResponse.json({ ok: false, error: 'mais de um envio aberto para esse CNPJ e competência: informe envio_id (ou tipo)' }, { status: 409 })
    sub = subs[0]
  } else {
    let q = admin.from('billing_submissions').select('id, contract_id, status, amount_sent, year, month').eq('tenant_id', org.tenant_id)
    q = envioId ? q.eq('id', envioId) : q.eq('erp_reference', ref!)
    const { data } = await q.in('status', ['enviado', 'faturado']).maybeSingle()
    sub = data
  }
  if (!sub) return NextResponse.json({ ok: false, error: 'envio não encontrado nesta empresa' }, { status: 404 })

  const { error } = await admin.from('billing_submissions').update({
    status: 'faturado', invoiced_amount: valor, invoice_number: nota, invoiced_at: data, invoiced_source: 'api',
  }).eq('id', sub.id).eq('tenant_id', org.tenant_id)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  await admin.from('activities').insert({
    tenant_id: org.tenant_id, contract_id: sub.contract_id, type: 'system',
    content: `✅ Faturado (retorno do ERP): NF ${nota} — R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
    metadata: { kind: 'billing_invoiced', submission_id: sub.id, source: 'api' },
  })
  console.log(`[faturamento] retorno · empresa ${org.tenant_id} · envio ${sub.id} · NF ${nota}`)
  return NextResponse.json({ ok: true })
}
