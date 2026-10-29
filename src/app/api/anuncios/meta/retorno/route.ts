// Volta do "Entrar com o Facebook": confere o pedido, guarda o acesso da empresa (criptografado) e atualiza os números
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { getSupportSession } from '@/lib/tenant/support'
import { metaConfig, finishMetaLogin, saveMetaConnection, syncMetaAds } from '@/lib/ads/meta-server'
import { ADS_RETURN, isAdsModule } from '@/lib/ads/meta'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const COOKIE_PATH = '/api/anuncios/meta'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const [saved = '', savedMod = ''] = ((await cookies()).get('meta_oauth_state')?.value ?? '').split('.')
  const mod = isAdsModule(savedMod) ? savedMod : 'varejo'
  const back = new URL(ADS_RETURN[mod], request.url)
  const done = (r: NextResponse) => { r.cookies.delete({ name: 'meta_oauth_state', path: COOKIE_PATH }); return r }
  const fail = (msg: string) => { back.searchParams.set('meta_erro', msg); return done(NextResponse.redirect(back)) }
  const access = await hasFeature(mod)
  if (!access) return NextResponse.redirect(new URL('/', request.url))
  if (await getSupportSession()) return fail('Acesso de suporte é só leitura.')
  const cfg = metaConfig()
  if (!cfg) return fail('A conexão com o Meta ainda não foi liberada na plataforma.')
  if (url.searchParams.get('error')) return fail(url.searchParams.get('error_description') || 'A conexão foi cancelada no Facebook.')
  const state = url.searchParams.get('state') ?? ''
  if (!state || state !== saved) return fail('A conexão expirou. Clique em Conectar de novo.')
  const code = url.searchParams.get('code')
  if (!code) return fail('O Facebook não devolveu a autorização.')
  try {
    const tenantId = await requireTenantId()
    const r = await finishMetaLogin(cfg, code, new URL('/api/anuncios/meta/retorno', request.url).toString())
    if (!r.accounts.length && !r.pages.length) return fail('Esta conta do Facebook não tem conta de anúncios nem página autorizada. Entre com a conta que gerencia os anúncios da empresa e marque as páginas e contas na tela do Facebook.')
    await saveMetaConnection(tenantId, access.userId, r)
    if (r.accounts.length === 1) await syncMetaAds(tenantId)
    back.searchParams.set('meta', 'ok')
    return done(NextResponse.redirect(back))
  } catch (e) {
    console.error('[meta/retorno]', e instanceof Error ? e.message : e)
    return fail(`Não foi possível conectar: ${e instanceof Error ? e.message.slice(0, 200) : 'erro'}`)
  }
}
