import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(req: Request) {
  const body = await req.json()
  const { token, status, technical_comment, technical_restrictions, actor_name } = body

  if (!token || !status) {
    return NextResponse.json({ error: 'token e status são obrigatórios' }, { status: 400 })
  }

  // Verifica usuário logado no CRM (opcional — pode vir do Price sem sessão CRM)
  let loggedUserId: string | null = null
  try {
    const userClient = await createClient()
    const { data: { user } } = await userClient.auth.getUser()
    loggedUserId = user?.id ?? null
  } catch { /* chamado do Price sem sessão CRM */ }

  const admin = (await createScopedAdmin())

  // Busca o contrato pelo review_token
  const { data: proposal } = await admin
    .from('proposal_status')
    .select('id, status, contract_id')
    .eq('review_token', token)
    .maybeSingle()

  if (!proposal) return NextResponse.json({ error: 'Token inválido' }, { status: 404 })
  if (proposal.status !== 'em_aprovacao_tecnica') {
    return NextResponse.json({ error: 'Proposta não está em aprovação técnica' }, { status: 400 })
  }

  const contract_id = proposal.contract_id

  // Registra o parecer
  await admin.from('proposal_status').update({
    status,
    technical_comment,
    technical_restrictions: technical_restrictions || null,
    actor_name,
    technical_approved_by: loggedUserId,
    updated_at: new Date().toISOString(),
  }).eq('contract_id', contract_id)

  // Registra atividade
  const statusLabel = status === 'aprovado_tecnico' ? '🔧 Aprovado tecnicamente' : '❌ Reprovado tecnicamente'
  const restricoesText = technical_restrictions ? ` · Restrições: ${technical_restrictions}` : ''
  await admin.from('activities').insert({
    contract_id,
    type: 'proposal',
    content: `${statusLabel} por ${actor_name}. Parecer: "${technical_comment}"${restricoesText}`,
  })

  return NextResponse.json({ ok: true }, { headers: CORS })
}
