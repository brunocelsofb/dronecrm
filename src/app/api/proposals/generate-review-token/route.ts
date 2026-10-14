import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { randomBytes } from 'crypto'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function POST(req: Request) {
  const { contract_id } = await req.json()
  if (!contract_id) return NextResponse.json({ error: 'contract_id obrigatório' }, { status: 400 })

  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const admin = (await createScopedAdmin())

  // Gera token único
  const token = randomBytes(24).toString('hex')

  await admin.from('proposal_status')
    .update({ review_token: token })
    .eq('contract_id', contract_id)

  const reviewUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://crm-gestaocontratos-pi.vercel.app'}/proposals/review/${token}`

  return NextResponse.json({ token, review_url: reviewUrl })
}
