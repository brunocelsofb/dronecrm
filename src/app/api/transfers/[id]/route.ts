import { NextResponse } from 'next/server'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { id } = await params
  const { action, name, comment, promised_deadline, contract_id } = await req.json()
  // Só dentro da empresa de quem está logado (antes gravava sem conferir a empresa)
  const admin = await createScopedAdmin()
  const { data: tr } = await admin.from('transfer_requests').select('id, contract_id, from_user_id').eq('id', id).maybeSingle()
  if (!tr || (contract_id && tr.contract_id !== contract_id)) return NextResponse.json({ error: 'Transferência não encontrada.' }, { status: 404 })
  const now = new Date().toISOString()

  if (action === 'assume') {
    await admin.from('transfer_requests').update({
      status: 'in_progress', assumed_at: now, assumed_by_name: name,
      promised_deadline, promised_comment: comment,
    }).eq('id', id)
    await admin.from('activities').insert({
      contract_id, type: 'transfer',
      content: `🔄 ${name} assumiu a análise${promised_deadline ? ` · Retorno até ${new Date(promised_deadline).toLocaleDateString('pt-BR')}` : ''}${comment ? ` · ${comment}` : ''}.`,
      user_id: user.id,
    })
  } else if (action === 'complete') {
    await admin.from('transfer_requests').update({
      status: 'completed', completed_at: now, completed_comment: comment,
    }).eq('id', id)
    await admin.from('activities').insert({
      contract_id, type: 'transfer',
      content: `✅ Análise concluída e devolvida${comment ? ` · Parecer: ${comment}` : ''}.`,
      user_id: user.id,
    })
    // Retorno automático a quem transferiu (sino + WhatsApp + e-mail)
    try {
      const { resolveTenantId } = await import('@/lib/tenant/context')
      const { notifyPerson } = await import('@/lib/agent/handoff')
      const app = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.comercialdrone.com.br').replace(/\/$/, '')
      await notifyPerson(await resolveTenantId({ contractId: tr.contract_id as string }), tr.from_user_id as string | null, {
        text: `🤖 Farmer: ✅ ${name ?? 'Quem recebeu'} concluiu a análise transferida e devolveu.${comment ? `\nParecer: ${comment}` : ''}\n${app}/contracts/${tr.contract_id}`,
        subject: 'Análise concluída e devolvida', contractId: tr.contract_id as string,
      })
    } catch (e) { console.error('[transferência] retorno:', e) }
  }

  return NextResponse.json({ ok: true })
}
