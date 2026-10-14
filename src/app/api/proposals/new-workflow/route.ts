import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function POST(req: Request) {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { contract_id } = await req.json()
  const admin = (await createScopedAdmin())

  await admin.from('proposal_status').upsert({
    contract_id,
    status: 'rascunho',
    proposal_value: null,
    technical_snapshot: null,
    review_token: null,
    submitted_at: null,
    submitted_by_name: null,
    technical_approved_at: null,
    technical_approved_by_name: null,
    technical_approved_by_role: null,
    technical_comment: null,
    commercial_approved_at: null,
    commercial_approved_by_name: null,
    commercial_approved_by_role: null,
    client_status: null,
    client_review_token: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'contract_id' })

  return NextResponse.json({ ok: true })
}
