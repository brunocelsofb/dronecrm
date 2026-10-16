// /api/public/lead?empresa=<slug>
// Recebe leads do formulário do SITE da empresa (ou de Zapier/Make, formulário
// de anúncio etc.). Aceita JSON ou formulário comum (POST).
// Campos: name, email, phone, company_name, cnpj, message, source e a origem
// (utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid,
// landing_page, referrer). A campanha é ligada pelo utm_campaign.
// _next (opcional, https): para onde voltar depois do envio de um formulário comum.
// Mesmo comportamento da página pública /captura (sem login; campo-armadilha "website").

import { NextResponse } from 'next/server'
import { createLead } from '@/lib/actions/leads'
import { tenantIdForSlug } from '@/lib/tenant/context'

export const dynamic = 'force-dynamic'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(req: Request) {
  const url = new URL(req.url)
  const type = req.headers.get('content-type') ?? ''
  let fields: Record<string, unknown> = {}
  try {
    if (type.includes('application/json')) fields = (await req.json()) as Record<string, unknown>
    else fields = Object.fromEntries((await req.formData()).entries())
  } catch {
    return NextResponse.json({ ok: false, error: 'Corpo inválido.' }, { status: 400, headers: CORS })
  }

  const empresa = String(url.searchParams.get('empresa') ?? fields.empresa ?? '').trim()
  if (!empresa || !(await tenantIdForSlug(empresa))) {
    return NextResponse.json({ ok: false, error: 'Empresa não encontrada (parâmetro ?empresa=).' }, { status: 404, headers: CORS })
  }

  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) if (typeof v === 'string' || typeof v === 'number') fd.set(k, String(v).slice(0, 4000))
  fd.set('empresa', empresa)
  if (!fd.get('source')) fd.set('source', 'formulario_site')
  // Origem também pode vir no endereço do próprio aviso
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid']) {
    const v = url.searchParams.get(k)
    if (v && !fd.get(k)) fd.set(k, v)
  }
  if (!fd.get('referrer') && req.headers.get('referer')) fd.set('referrer', req.headers.get('referer')!.slice(0, 500))

  const r = await createLead(fd)
  const next = String(fields._next ?? '')
  if (!type.includes('application/json') && /^https:\/\//.test(next)) {
    return NextResponse.redirect(r.error ? `${next}${next.includes('?') ? '&' : '?'}erro=1` : next, { status: 303, headers: CORS })
  }
  if (r.error) return NextResponse.json({ ok: false, error: r.error }, { status: 400, headers: CORS })
  return NextResponse.json({ ok: true, lead_id: r.leadId ?? null }, { headers: CORS })
}
