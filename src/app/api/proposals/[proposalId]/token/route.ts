import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ proposalId: string }> }
) {
  const { proposalId } = await params
  // O código abre a precificação completa no Price: aprovador técnico não recebe
  const { getCurrentProfile } = await import('@/lib/auth/role')
  const { isTechnicalApprover } = await import('@/lib/proposals/technical')
  if (isTechnicalApprover((await getCurrentProfile())?.role)) return NextResponse.json({ review_token: null })
  const admin = (await createScopedAdmin())
  const { data } = await admin
    .from('proposals')
    .select('review_token')
    .eq('id', proposalId)
    .maybeSingle()
  return NextResponse.json({ review_token: data?.review_token ?? null })
}
