import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ proposalId: string }> }
) {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { actor_name, reason } = await req.json()
  const { proposalId: id } = await params
  const admin = (await createScopedAdmin())

  const { data: proposal } = await admin
    .from('proposals').select('id, contract_id, control_code').eq('id', id).maybeSingle()
  if (!proposal) return NextResponse.json({ error: 'Proposta não encontrada' }, { status: 404 })

  await admin.from('proposals').update({
    workflow_status: 'declinada',
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  const motivo = reason?.trim() || 'Não informado'
  await admin.from('activities').insert({
    contract_id: proposal.contract_id,
    type: 'client_decision',
    content: `❌ Proposta ${proposal.control_code} DECLINADA internamente por ${actor_name}. Motivo: ${motivo}.`,
    metadata: { outcome: 'declinada', reason: motivo, proposal_id: id },
    user_id: user.id,
  })

  return NextResponse.json({ ok: true })
}
