// Aviso automático da ZapSign (webhook). Rotina da plataforma, por empresa.
//
// Dois modos:
//  • Sem Plano de API (?k=<chave da empresa>): o webhook é cadastrado na tela
//    da ZapSign (gratuito). A chave identifica a empresa; o documento precisa
//    estar registrado no contrato; o PDF assinado só é baixado de endereços da
//    ZapSign. Como não há API, usa o conteúdo do aviso.
//  • Com Plano de API (sem ?k): não confia no corpo — consulta a ZapSign com a
//    chave da empresa dona do documento (syncZapSignDoc).

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncZapSignDoc, applyZapSignState, getTenantZapSignToken, type ZapSignDocRow } from '@/lib/zapsign/sync'
import type { ZapSignDocument } from '@/lib/zapsign/api'

const DOC_COLS = 'id, tenant_id, contract_id, name, status, zapsign_doc_token, document_kind, signed_file_id, created_by'

type Body = {
  event_type?: string; token?: string; status?: string; name?: string; signed_file?: string | null
  signers?: { token?: string; name?: string; email?: string; status?: string; sign_url?: string; signed_at?: string | null }[]
}

export async function POST(request: Request) {
  const url = new URL(request.url)
  const body = await request.json().catch(() => null) as Body | null
  const docToken = typeof body?.token === 'string' ? body.token : ''
  if (!body || !docToken) return NextResponse.json({ ok: true, skipped: 'sem token' })
  const admin = createAdminClient()
  const key = url.searchParams.get('k') ?? ''

  // ── Sem Plano de API ────────────────────────────────────────────────────
  if (key) {
    if (key.length < 32) return NextResponse.json({ ok: false, error: 'chave inválida' }, { status: 401 })
    const { data: org } = await admin.from('organization_settings').select('tenant_id').eq('zapsign_hook_secret', key).maybeSingle()
    if (!org?.tenant_id) return NextResponse.json({ ok: false, error: 'chave inválida' }, { status: 401 })

    // O documento foi registrado no contrato pelo token do documento ou pelo de um signatário (link de assinatura)
    const candidates = [docToken, ...(body.signers ?? []).map(s => s.token).filter((x): x is string => typeof x === 'string' && x.length > 0)]
    const { data: docs } = await admin.from('zapsign_documents').select(DOC_COLS).eq('tenant_id', org.tenant_id).in('zapsign_doc_token', candidates).limit(1)
    const doc = docs?.[0]
    if (!doc) {
      console.log(`[zapsign] aviso ${body.event_type ?? '?'} de documento não registrado no CRM (empresa ${org.tenant_id})`)
      return NextResponse.json({ ok: true, skipped: 'documento não registrado em nenhum contrato' })
    }
    const state: ZapSignDocument = {
      token: docToken,
      status: typeof body.status === 'string' ? body.status : (body.event_type === 'doc_signed' ? 'signed' : body.event_type === 'doc_refused' ? 'refused' : 'pending'),
      name: typeof body.name === 'string' ? body.name : doc.name,
      original_file: null,
      signed_file: typeof body.signed_file === 'string' ? body.signed_file : null,
      signers: (body.signers ?? []).map(s => ({ token: s.token ?? '', name: s.name ?? '', email: s.email ?? '', status: s.status ?? '', sign_url: s.sign_url ?? '', signed_at: s.signed_at ?? null })),
    }
    try {
      // guarda o token do documento (o registro pode ter sido feito pelo link de um signatário)
      if (doc.zapsign_doc_token !== docToken) {
        await admin.from('zapsign_documents').update({ zapsign_doc_token: docToken }).eq('id', doc.id).eq('tenant_id', org.tenant_id)
      }
      const r = await applyZapSignState({ ...(doc as ZapSignDocRow), zapsign_doc_token: docToken }, state, url.origin)
      console.log(`[zapsign] aviso ${body.event_type ?? '?'} (sem API) · doc ${doc.id} · status ${r.status}${r.savedSignedFile ? ' · PDF assinado guardado' : ''}`)
      return NextResponse.json({ ok: true })
    } catch (e) {
      console.error('[zapsign] erro ao processar aviso (sem API):', e instanceof Error ? e.message : e)
      return NextResponse.json({ ok: false }, { status: 500 })
    }
  }

  // ── Com Plano de API ────────────────────────────────────────────────────
  const { data: doc } = await admin.from('zapsign_documents').select(DOC_COLS).eq('zapsign_doc_token', docToken).maybeSingle()
  if (!doc) return NextResponse.json({ ok: true, skipped: 'documento não é deste CRM' })
  const apiToken = await getTenantZapSignToken(doc.tenant_id)
  if (!apiToken) return NextResponse.json({ ok: true, skipped: 'empresa sem token' })
  try {
    const r = await syncZapSignDoc(doc as ZapSignDocRow, apiToken, url.origin)
    console.log(`[zapsign] aviso ${body.event_type ?? '?'} · doc ${doc.id} · status ${r.status}${r.savedSignedFile ? ' · PDF assinado guardado' : ''}`)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[zapsign] erro ao processar aviso:', e instanceof Error ? e.message : e)
    // 500 para a ZapSign tentar de novo
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
