import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function POST(req: Request) {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const { proposal_id, payment_terms, installments, is_recurring, discount_type, discount_value } = await req.json()
  const admin = (await createScopedAdmin())
  await admin.from('proposals').update({
    payment_terms, installments, is_recurring,
    discount_type: discount_type ?? null,
    discount_value: discount_value ?? 0,
    updated_at: new Date().toISOString(),
  }).eq('id', proposal_id)
  return NextResponse.json({ ok: true })
}
