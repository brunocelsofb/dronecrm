// Pedido de exclusão de dados do Meta ("Data Deletion Request Callback"): quando a pessoa remove o
// app no Facebook, o Meta manda um signed_request. Apagamos o que o Drone leu do Meta pelas conexões
// dela e devolvemos o endereço para acompanhar e o código de confirmação.
import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { metaConfig, deleteMetaDataForUser } from '@/lib/ads/meta-server'
import { parseSignedRequest } from '@/lib/ads/meta-crypto'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const cfg = metaConfig()
  if (!cfg) return NextResponse.json({ error: 'not configured' }, { status: 503 })
  let signed = ''
  try { signed = String((await req.formData()).get('signed_request') ?? '') } catch { /* corpo inválido */ }
  const data = parseSignedRequest(signed, cfg.secret)
  const userId = data?.user_id ? String(data.user_id) : ''
  if (!userId) return NextResponse.json({ error: 'invalid signed_request' }, { status: 400 })
  const removed = await deleteMetaDataForUser(userId)
  const code = randomBytes(9).toString('hex')
  await createAdminClient().from('meta_data_deletion_requests').insert({ confirmation_code: code, meta_user_id: userId, connections_removed: removed })
  const url = new URL(`/exclusao-de-dados?codigo=${code}`, req.url).toString()
  return NextResponse.json({ url, confirmation_code: code })
}
