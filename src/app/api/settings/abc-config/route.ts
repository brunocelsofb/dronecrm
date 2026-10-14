import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Só admins' }, { status: 403 })

  const body = await request.json()
  const { nature, billing_tier1_max, billing_tier2_max, curve_a_min, curve_b_min } = body

  if (!['eng_clinica', 'eng_hospitalar'].includes(nature))
    return NextResponse.json({ error: 'Natureza inválida' }, { status: 400 })

  const admin = (await createScopedAdmin())
  const { error } = await admin.from('abc_config').upsert(
    { nature, billing_tier1_max, billing_tier2_max, curve_a_min, curve_b_min, updated_at: new Date().toISOString() },
    { onConflict: 'nature' }
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
