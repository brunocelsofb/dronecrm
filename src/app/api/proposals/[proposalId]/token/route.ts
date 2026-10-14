import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ proposalId: string }> }
) {
  const { proposalId } = await params
  const admin = (await createScopedAdmin())
  const { data } = await admin
    .from('proposals')
    .select('review_token')
    .eq('id', proposalId)
    .maybeSingle()
  return NextResponse.json({ review_token: data?.review_token ?? null })
}
