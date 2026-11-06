import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

const CORS = {
  'Access-Control-Allow-Origin': 'https://orbis-price.vercel.app',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ contractId: string }> }
) {
  const { contractId } = await params
  // Precificação é conteúdo da empresa: só para quem está logado nela
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Faça login.' }, { status: 401, headers: CORS })
  const admin = await createScopedAdmin()

  const { data } = await admin
    .from('proposal_status')
    .select('technical_snapshot, status, proposal_value')
    .eq('contract_id', contractId)
    .maybeSingle()

  if (!data?.technical_snapshot) {
    return NextResponse.json({ snapshot: null }, { headers: CORS })
  }

  return NextResponse.json({ snapshot: data.technical_snapshot }, { headers: CORS })
}
