// /api/integracoes/<chave>
// Endereço de cada integração da Central de integrações (Marketing → Integrações).
// A chave identifica a empresa e a ferramenta; trocar a chave desliga o endereço antigo.
// GET: confirma que o endereço existe (o Mailchimp testa assim ao salvar o webhook).
// POST: recebe o lead (JSON, formulário comum ou multipart) e grava no CRM.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseIntegrationPayload, type IntegrationKind } from '@/lib/leads/parse'
import { ingestLead } from '@/lib/leads/ingest'
import { integrationDef } from '@/lib/marketing/integrations'
import { RD_CRM_PREFIX } from '@/lib/marketing/tools'

export const dynamic = 'force-dynamic'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

type Integration = { id: string; tenant_id: string; kind: IntegrationKind; name: string; active: boolean; settings: Record<string, unknown> | null; received_count: number }

async function findIntegration(key: string): Promise<Integration | null> {
  if (!/^[a-f0-9]{32,64}$/.test(key)) return null
  const { data } = await createAdminClient().from('lead_integrations')
    .select('id, tenant_id, kind, name, active, settings, received_count').eq('key', key).maybeSingle()
  return (data as Integration | null) ?? null
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const it = await findIntegration((await ctx.params).key)
  if (!it) return NextResponse.json({ ok: false, error: 'Endereço não encontrado.' }, { status: 404, headers: CORS })
  return NextResponse.json({ ok: true, ativo: it.active, integracao: it.name }, { headers: CORS })
}

export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const it = await findIntegration((await ctx.params).key)
  if (!it) return NextResponse.json({ ok: false, error: 'Endereço não encontrado.' }, { status: 404, headers: CORS })
  if (!it.active) return NextResponse.json({ ok: false, error: 'Integração desativada no CRM.' }, { status: 410, headers: CORS })
  const admin = createAdminClient()

  // Corpo: JSON, formulário comum ou multipart (texto sem tipo: tenta JSON)
  const type = req.headers.get('content-type') ?? ''
  let payload: unknown = {}
  try {
    if (type.includes('application/json')) payload = await req.json()
    else if (type.includes('form')) payload = Object.fromEntries([...(await req.formData()).entries()].filter(([, v]) => typeof v === 'string'))
    else { const t = await req.text(); payload = t ? JSON.parse(t) : {} }
  } catch {
    await admin.from('lead_integrations').update({ last_error: 'Corpo inválido (não é JSON nem formulário).' }).eq('id', it.id)
    return NextResponse.json({ ok: false, error: 'Corpo inválido.' }, { status: 400, headers: CORS })
  }

  const url = new URL(req.url)
  const query: Record<string, string> = {}
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid']) {
    const v = url.searchParams.get(k); if (v) query[k] = v
  }
  // Campo-armadilha de robôs (formulários de site)
  if (payload && typeof payload === 'object' && String((payload as Record<string, unknown>).website ?? '').trim()) {
    return NextResponse.json({ ok: true }, { headers: CORS })
  }

  const def = integrationDef(it.kind)
  const settings = it.settings ?? {}
  const leads = parseIntegrationPayload(it.kind, payload, query)
  let created = 0, duplicates = 0, skipped = 0
  const errors: string[] = []

  for (const l of leads) {
    // Mailchimp: descadastro não cria lead — registra no lead existente
    if (l.unsubscribe) {
      if (l.email) {
        // Entra na lista de descadastrados: as listas do CRM deixam de mandar para este e-mail
        await admin.from('marketing_optouts').upsert({ tenant_id: it.tenant_id, email: l.email, source: it.name }, { onConflict: 'tenant_id,email', ignoreDuplicates: true })
        const { data: lead } = await admin.from('leads').select('id').eq('tenant_id', it.tenant_id).ilike('email', l.email.replace(/[%_\\]/g, m => `\\${m}`)).limit(1).maybeSingle()
        if (lead) await admin.from('lead_activities').insert({ lead_id: lead.id, tenant_id: it.tenant_id, type: 'system', content: `🚫 Descadastrou-se da lista (${it.name}). Não enviar e-mail marketing.` })
      }
      skipped++
      continue
    }
    // Conversão que o próprio CRM mandou ao RD (envio de lista): não volta como lead
    if (it.kind === 'rd_station' && (l.conversion ?? '').toLowerCase().startsWith(RD_CRM_PREFIX)) { skipped++; continue }
    const name = l.name ?? (l.email ? l.email.split('@')[0] : null) ?? l.phone
    if (!name || (!l.email && !l.phone)) { skipped++; errors.push('lead sem nome e sem e-mail/telefone'); continue }
    const hasAd = !!(l.tracking.gclid || l.tracking.fbclid || /cpc|ads|paid|lead_ads|lead_gen/i.test(l.tracking.utm_medium ?? ''))
    const r = await ingestLead({
      tenantId: it.tenant_id, name, email: l.email, phone: l.phone, company_name: l.company_name, cnpj: l.cnpj, message: l.message,
      source: hasAd ? 'anuncio' : def?.source ?? 'formulario_site',
      tracking: l.tracking,
      campaignId: typeof settings.campaign_id === 'string' ? settings.campaign_id : null,
      integrationId: it.id,
      conversion: [it.name, l.conversion].filter(Boolean).join(' · '),
      dedupe: true,
    })
    if (r.error) errors.push(r.error)
    else if (r.duplicate) duplicates++
    else created++
  }

  await admin.from('lead_integrations').update({
    received_count: it.received_count + created + duplicates,
    ...(created + duplicates > 0 ? { last_received_at: new Date().toISOString() } : {}),
    last_error: errors.length ? errors.slice(0, 3).join(' · ').slice(0, 500) : null,
  }).eq('id', it.id)

  // Botão de WhatsApp: devolve o link para abrir a conversa
  const extra: Record<string, unknown> = {}
  if (it.kind === 'whatsapp_button' && typeof settings.phone === 'string' && settings.phone) {
    const msg = typeof settings.message === 'string' ? settings.message : ''
    extra.whatsapp = `https://wa.me/${settings.phone.replace(/\D/g, '')}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`
  }

  const ok = errors.length === 0 || created + duplicates > 0
  return NextResponse.json({ ok, criados: created, repetidos: duplicates, ignorados: skipped, ...(errors.length ? { erros: errors.slice(0, 3) } : {}), ...extra }, { status: ok ? 200 : 400, headers: CORS })
}
