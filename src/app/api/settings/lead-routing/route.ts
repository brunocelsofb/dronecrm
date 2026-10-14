import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

async function guardAdmin() {
  const s = await createClient()
  const { data: { user } } = await s.auth.getUser()
  if (!user) return null
  const { data: p } = await s.from('profiles').select('role').eq('id', user.id).maybeSingle()
  return p?.role === 'admin' ? (await createScopedAdmin()) : null
}

export async function POST(req: Request) {
  const admin = await guardAdmin()
  if (!admin) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  const body = await req.json()
  const { data: rule, error } = await admin.from('lead_routing_rules').insert(body).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  revalidatePath('/settings/lead-routing')
  return NextResponse.json({ rule })
}

export async function PATCH(req: Request) {
  const admin = await guardAdmin()
  if (!admin) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  const { id, ...updates } = await req.json()
  updates.updated_at = new Date().toISOString()
  const { error } = await admin.from('lead_routing_rules').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  revalidatePath('/settings/lead-routing')
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const admin = await guardAdmin()
  if (!admin) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  const { id } = await req.json()
  const { error } = await admin.from('lead_routing_rules').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  revalidatePath('/settings/lead-routing')
  return NextResponse.json({ ok: true })
}
