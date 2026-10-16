// Retorno do faturamento (ERP → CRM). Rotina da plataforma, por empresa:
// a chave (Financeiro → Integração) identifica a empresa; o envio é sempre
// procurado DENTRO dela. Serve para Sankhya, TOTVS ou qualquer integração
// intermediária que saiba fazer um POST.
//
// POST /api/faturamento/retorno
// Authorization: Bearer <chave da empresa>
// { "envio_id": "<id do envio no CRM>"  (ou "referencia_erp": "<id no ERP>"),
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
  if ((!envioId && !ref) || !nota || !data || !Number.isFinite(valor) || valor < 0) {
    return NextResponse.json({ ok: false, error: 'campos obrigatórios: envio_id ou referencia_erp, numero_nota, data_faturamento (AAAA-MM-DD), valor_faturado' }, { status: 400 })
  }

  let q = admin.from('billing_submissions').select('id, contract_id, status, amount_sent, year, month').eq('tenant_id', org.tenant_id)
  q = envioId ? q.eq('id', envioId) : q.eq('erp_reference', ref!)
  const { data: sub } = await q.in('status', ['enviado', 'faturado']).maybeSingle()
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
