import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { randomBytes } from 'crypto'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function POST(req: Request) {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })

  const { contract_id, proposal_id } = await req.json()
  const admin = (await createScopedAdmin())

  // NOVO MODELO: busca/salva em proposals (1:N)
  if (proposal_id) {
    const { data: proposal } = await admin
      .from('proposals')
      .select('client_review_token')
      .eq('id', proposal_id)
      .maybeSingle()

    const token = proposal?.client_review_token ?? randomBytes(24).toString('hex')

    if (!proposal?.client_review_token) {
      await admin.from('proposals')
        .update({ client_review_token: token })
        .eq('id', proposal_id)
    }

    return NextResponse.json({ token })
  }

  // FALLBACK LEGADO: busca/salva em proposal_status
  const { data: existing } = await admin
    .from('proposal_status')
    .select('client_review_token')
    .eq('contract_id', contract_id)
    .maybeSingle()

  const token = existing?.client_review_token ?? randomBytes(24).toString('hex')

  if (!existing?.client_review_token) {
    await admin.from('proposal_status')
      .update({ client_review_token: token })
      .eq('contract_id', contract_id)
  }

  return NextResponse.json({ token })
}
