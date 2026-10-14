import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { resolveTenantId } from '@/lib/tenant/context'

export async function GET() {
  const admin = createAdminClient()
  const { data } = await admin.from('opportunity_sequence').select('*').eq('tenant_id', await resolveTenantId()).maybeSingle()
  return NextResponse.json(data ?? { prefix: 'OPP', next_number: 1, year_reset: true })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Só admins' }, { status: 403 })

  const body = await req.json()
  const admin = createAdminClient()
  const { error } = await admin.from('opportunity_sequence').upsert(
    { id: 'default', prefix: body.prefix, next_number: body.next_number, year_reset: body.year_reset },
    { onConflict: 'id' }
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
