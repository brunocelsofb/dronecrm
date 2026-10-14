import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function POST(req: Request) {
  const { proposal_id, service_type } = await req.json()
  if (!proposal_id) return NextResponse.json({ error: 'proposal_id obrigatório' }, { status: 400 })
  const admin = (await createScopedAdmin())
  await admin.from('proposals').update({ template_service_type: service_type }).eq('id', proposal_id)
  return NextResponse.json({ ok: true })
}
