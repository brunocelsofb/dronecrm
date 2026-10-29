// Volta do "Entrar com o Facebook": confere o pedido, guarda o acesso (criptografado) e atualiza os números
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { getSupportSession } from '@/lib/tenant/support'
import { metaConfig, finishMetaLogin, saveMetaConnection, syncMetaAds } from '@/lib/retail/meta-ads-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const url = new URL(request.url)
  const back = new URL('/varejo/anuncios', request.url)
  const fail = (msg: string) => { back.searchParams.set('meta_erro', msg); const r = NextResponse.redirect(back); r.cookies.delete({ name: 'meta_oauth_state', path: '/api/varejo/meta' }); return r }
  const access = await hasFeature('varejo')
  if (!access) return NextResponse.redirect(new URL('/', request.url))
  if (await getSupportSession()) return fail('Acesso de suporte é só leitura.')
  const cfg = metaConfig()
  if (!cfg) return fail('A conexão com o Meta ainda não foi liberada na plataforma.')
  if (url.searchParams.get('error')) return fail(url.searchParams.get('error_description') || 'A conexão foi cancelada no Facebook.')
  const state = url.searchParams.get('state') ?? ''
  const saved = (await cookies()).get('meta_oauth_state')?.value ?? ''
  if (!state || state !== saved) return fail('A conexão expirou. Clique em Conectar de novo.')
  const code = url.searchParams.get('code')
  if (!code) return fail('O Facebook não devolveu a autorização.')
  try {
    const tenantId = await requireTenantId()
    const r = await finishMetaLogin(cfg, code, new URL('/api/varejo/meta/retorno', request.url).toString())
    if (!r.accounts.length) return fail('Esta conta do Facebook não tem nenhuma conta de anúncios. Entre com a conta que gerencia os anúncios da loja.')
    await saveMetaConnection(tenantId, access.userId, r)
    if (r.accounts.length === 1) await syncMetaAds(tenantId)
    back.searchParams.set('meta', 'ok')
    const res = NextResponse.redirect(back)
    res.cookies.delete({ name: 'meta_oauth_state', path: '/api/varejo/meta' })
    return res
  } catch (e) {
    console.error('[meta/retorno]', e instanceof Error ? e.message : e)
    return fail(`Não foi possível conectar: ${e instanceof Error ? e.message.slice(0, 200) : 'erro'}`)
  }
}
