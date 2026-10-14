import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function DELETE(_req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const { itemId } = await params
  const admin = (await createScopedAdmin())
  await admin.from('proposal_items').delete().eq('id', itemId)
  return NextResponse.json({ ok: true })
}
