// Avisos do Meta para o app da plataforma (webhook). Hoje: "leadgen" das páginas conectadas
// (alguém preencheu um formulário de cadastro do anúncio) → o lead entra no CRM da empresa.
// GET: verificação do endereço pelo Meta (hub.verify_token = META_WEBHOOK_VERIFY_TOKEN).
// POST: confere a assinatura (X-Hub-Signature-256 com o segredo do app) antes de qualquer coisa.
import { NextResponse } from 'next/server'
import { metaConfig, processLeadgen } from '@/lib/ads/meta-server'
import { validWebhookSignature } from '@/lib/ads/meta-crypto'
import { leadgenChanges } from '@/lib/ads/meta'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const cfg = metaConfig()
  const q = new URL(req.url).searchParams
  if (cfg?.verifyToken && q.get('hub.mode') === 'subscribe' && q.get('hub.verify_token') === cfg.verifyToken) {
    return new NextResponse(q.get('hub.challenge') ?? '', { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return NextResponse.json({ error: 'forbidden' }, { status: 403 })
}

export async function POST(req: Request) {
  const cfg = metaConfig()
  if (!cfg) return NextResponse.json({ error: 'not configured' }, { status: 503 })
  const raw = await req.text()
  if (!validWebhookSignature(raw, req.headers.get('x-hub-signature-256'), cfg.secret)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }
  let body: unknown = null
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ ok: true }) }
  const results = []
  for (const change of leadgenChanges(body)) {
    try { results.push(...(await processLeadgen(change))) } catch (e) { console.error('[meta/webhook]', e instanceof Error ? e.message : e) }
  }
  // Sempre 200 depois de validar: o Meta reenvia o que não recebeu 200, e a trava por leadgen_id evita duplicar
  return NextResponse.json({ ok: true, processed: results.length })
}
