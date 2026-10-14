import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ proposalId: string }> }
) {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  // Só admin pode excluir
  const admin = (await createScopedAdmin())
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const { proposalId } = await params
  await admin.from('proposals').update({ deleted_at: new Date().toISOString() }).eq('id', proposalId)

  return NextResponse.json({ ok: true })
}
