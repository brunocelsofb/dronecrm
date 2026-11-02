import { NextResponse } from 'next/server'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { contract_id, to_user_id, to_name, to_department, reason, desired_deadline, from_name } = await req.json()
  // Só dentro da empresa de quem está logado (antes gravava sem conferir a empresa)
  const admin = await createScopedAdmin()
  const { data: own } = await admin.from('contracts').select('id').eq('id', contract_id).maybeSingle()
  if (!own) return NextResponse.json({ error: 'Oportunidade não encontrada.' }, { status: 404 })
  if (to_user_id) {
    const { data: dest } = await admin.from('profiles').select('id').eq('id', to_user_id).maybeSingle()
    if (!dest) return NextResponse.json({ error: 'Pessoa não encontrada nesta empresa.' }, { status: 400 })
  }

  // Fecha qualquer transferência ativa anterior
  await admin.from('transfer_requests')
    .update({ status: 'completed', completed_at: new Date().toISOString(), completed_comment: 'Substituída por nova transferência' })
    .eq('contract_id', contract_id)
    .in('status', ['pending', 'in_progress'])

  // Cria nova transferência
  const { data } = await admin.from('transfer_requests').insert({
    contract_id, from_user_id: user.id, to_user_id, from_name, to_name, to_department, reason,
    desired_deadline, status: 'pending',
  }).select('id').single()

  // Log na timeline
  await admin.from('activities').insert({
    contract_id, type: 'transfer',
    content: `↔ Transferida para ${to_name ?? to_department}${reason ? ` · Motivo: ${reason}` : ''}${desired_deadline ? ` · Prazo: ${new Date(desired_deadline).toLocaleDateString('pt-BR')}` : ''}.`,
    user_id: user.id,
  })

  return NextResponse.json({ ok: true, id: data?.id })
}
