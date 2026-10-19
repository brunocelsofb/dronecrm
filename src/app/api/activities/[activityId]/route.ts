import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ activityId: string }> }
) {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const { activityId } = await params
  // Só apaga registro da empresa de quem está logado
  const db = await createScopedAdmin()
  const { data, error } = await db.from('activities').delete().eq('id', activityId).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'Registro não encontrado' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
