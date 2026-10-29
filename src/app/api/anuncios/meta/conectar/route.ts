// Conectar o Meta Ads da empresa: leva a pessoa para "Entrar com o Facebook" (só leitura dos anúncios).
// ?volta=varejo|marketing decide para qual tela voltar; a conexão é a mesma para os dois.
import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { hasFeature } from '@/lib/auth/access'
import { getSupportSession } from '@/lib/tenant/support'
import { metaConfig } from '@/lib/ads/meta-server'
import { ADS_RETURN, isAdsModule, metaAuthUrl } from '@/lib/ads/meta'

export const dynamic = 'force-dynamic'
const COOKIE_PATH = '/api/anuncios/meta'

export async function GET(request: Request) {
  const v = new URL(request.url).searchParams.get('volta')
  const mod = isAdsModule(v) ? v : 'varejo'
  const back = new URL(ADS_RETURN[mod], request.url)
  if (!(await hasFeature(mod))) return NextResponse.redirect(new URL('/', request.url))
  if (await getSupportSession()) { back.searchParams.set('meta_erro', 'Acesso de suporte é só leitura.'); return NextResponse.redirect(back) }
  const cfg = metaConfig()
  if (!cfg) { back.searchParams.set('meta_erro', 'A conexão com o Meta ainda não foi liberada na plataforma.'); return NextResponse.redirect(back) }
  const state = randomBytes(24).toString('hex')
  const redirectUri = new URL('/api/anuncios/meta/retorno', request.url).toString()
  const res = NextResponse.redirect(metaAuthUrl({ version: cfg.version, appId: cfg.appId, redirectUri, state, configId: cfg.configId }))
  res.cookies.set('meta_oauth_state', `${state}.${mod}`, { httpOnly: true, secure: true, sameSite: 'lax', path: COOKIE_PATH, maxAge: 600 })
  return res
}
