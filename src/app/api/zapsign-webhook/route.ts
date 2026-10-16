// Aviso automático da ZapSign (webhook, cadastrado por empresa em Configurações).
// Rotina da plataforma: não confia no corpo recebido — usa só o token do
// documento, acha a empresa dona e consulta a ZapSign com a chave DELA
// (syncZapSignDoc). Um aviso falso, no máximo, provoca uma consulta.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncZapSignDoc, getTenantZapSignToken, type ZapSignDocRow } from '@/lib/zapsign/sync'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { token?: string; event_type?: string } | null
  const docToken = typeof body?.token === 'string' ? body.token : ''
  if (!docToken) return NextResponse.json({ ok: true, skipped: 'sem token' })

  const admin = createAdminClient()
  const { data: doc } = await admin.from('zapsign_documents')
    .select('id, tenant_id, contract_id, name, status, zapsign_doc_token, document_kind, signed_file_id, created_by')
    .eq('zapsign_doc_token', docToken).maybeSingle()
  if (!doc) return NextResponse.json({ ok: true, skipped: 'documento não é deste CRM' })

  const apiToken = await getTenantZapSignToken(doc.tenant_id)
  if (!apiToken) return NextResponse.json({ ok: true, skipped: 'empresa sem token' })

  try {
    const r = await syncZapSignDoc(doc as ZapSignDocRow, apiToken)
    console.log(`[zapsign] aviso ${body?.event_type ?? '?'} · doc ${doc.id} · status ${r.status}${r.savedSignedFile ? ' · PDF assinado guardado' : ''}`)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[zapsign] erro ao processar aviso:', e instanceof Error ? e.message : e)
    // 500 para a ZapSign tentar de novo
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
