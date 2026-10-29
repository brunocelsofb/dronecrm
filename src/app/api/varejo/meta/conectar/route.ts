// Conectar o Meta Ads: leva a pessoa para "Entrar com o Facebook" (só leitura dos anúncios)
import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { hasFeature } from '@/lib/auth/access'
import { getSupportSession } from '@/lib/tenant/support'
import { metaConfig } from '@/lib/retail/meta-ads-server'
import { metaAuthUrl } from '@/lib/retail/meta-ads'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const back = new URL('/varejo/anuncios', request.url)
  const access = await hasFeature('varejo')
  if (!access) return NextResponse.redirect(new URL('/', request.url))
  if (await getSupportSession()) { back.searchParams.set('meta_erro', 'Acesso de suporte é só leitura.'); return NextResponse.redirect(back) }
  const cfg = metaConfig()
  if (!cfg) { back.searchParams.set('meta_erro', 'A conexão com o Meta ainda não foi liberada na plataforma.'); return NextResponse.redirect(back) }
  const state = randomBytes(24).toString('hex')
  const redirectUri = new URL('/api/varejo/meta/retorno', request.url).toString()
  const res = NextResponse.redirect(metaAuthUrl({ version: cfg.version, appId: cfg.appId, redirectUri, state, configId: cfg.configId }))
  res.cookies.set('meta_oauth_state', state, { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/varejo/meta', maxAge: 600 })
  return res
}
