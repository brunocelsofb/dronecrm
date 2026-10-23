// Middleware: renova a sessao do Supabase a cada request e
// redireciona usuarios nao autenticados para /login.
// Tambem injeta o tenant de impersonation como REQUEST header.

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const COOKIE_TENANT_ID = 'orbis_imp_tid'

export async function proxy(request: NextRequest) {
  // Rotas de webhook externo passam direto (sem auth, sem injeção de headers)
  // Apenas webhooks reais que recebem chamadas server-to-server
  const isWebhook =
    request.nextUrl.pathname.startsWith('/api/webhook') ||
    request.nextUrl.pathname.startsWith('/api/evolution') ||
    request.nextUrl.pathname.startsWith('/api/zapi') ||
    request.nextUrl.pathname.startsWith('/api/vapi') ||
    request.nextUrl.pathname.startsWith('/api/asaas') ||
    request.nextUrl.pathname.startsWith('/api/iugu') ||
    request.nextUrl.pathname.startsWith('/api/stripe')
  if (isWebhook) {
    return NextResponse.next()
  }

  // Prepara request headers com impersonation (se ativo)
  // IMPORTANTE: request headers injetados via NextResponse.next({ request: { headers } })
  // ficam visiveis para Server Components via headers() do next/headers.
  // Response headers NAO sao visiveis para Server Components.
  const requestHeaders = new Headers(request.headers)
  // Caminho atual para o layout bloquear abas fora do plano
  requestHeaders.set('x-pathname', request.nextUrl.pathname)
  const impTenantId = request.cookies.get(COOKIE_TENANT_ID)?.value
  // Nunca aceitar este cabeçalho vindo do navegador: só o proxy o define (a partir do cookie)
  requestHeaders.delete('x-orbis-imp-tenant-id')
  if (impTenantId) {
    requestHeaders.set('x-orbis-imp-tenant-id', impTenantId)
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request: { headers: requestHeaders } })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Acesso de suporte: registra cada tela/ação para a empresa ver (quem, quando, o quê).
  // A função do banco ignora quem não está em sessão de suporte e não repete a mesma
  // tela em menos de 1 minuto. Pré-carregamento de links não conta.
  if (user && impTenantId && !request.headers.get('next-router-prefetch') && request.headers.get('purpose') !== 'prefetch') {
    try {
      await supabase.schema('contract_crm').rpc('log_support_view', {
        p_path: request.nextUrl.pathname + (request.nextUrl.search || ''),
        p_method: request.headers.get('next-action') ? 'ACTION' : request.method,
      })
    } catch { /* registro não pode derrubar a navegação */ }

    // Só leitura de verdade: em sessão de suporte, nenhuma ação (server action, POST/PUT/
    // PATCH/DELETE) nem GET com efeito chega ao app. Isso barra também o que sai para fora
    // (WhatsApp, e-mail, assinatura, integrações), que o bloqueio do banco não alcança.
    const method = request.method.toUpperCase()
    const path = request.nextUrl.pathname
    const sideEffectGet = path.startsWith('/api/settings/evo-instances') && request.nextUrl.searchParams.has('action')
    if ((!['GET', 'HEAD', 'OPTIONS'].includes(method) || sideEffectGet) && path !== '/api/support/end') {
      let inSupport = false
      try {
        const { data } = await supabase.schema('contract_crm').rpc('in_support_session')
        inSupport = data === true
      } catch { inSupport = true }   // na dúvida, bloqueia
      if (inSupport) {
        return NextResponse.json({ error: 'Acesso de suporte é só leitura: esta ação foi bloqueada e registrada.' }, { status: 403 })
      }
    }
  }

  const isAuthRoute = request.nextUrl.pathname.startsWith('/login') ||
                      request.nextUrl.pathname.startsWith('/register')

  const isPublicRoute =
    request.nextUrl.pathname.startsWith('/api/') ||
    request.nextUrl.pathname.startsWith('/nps/') ||
    request.nextUrl.pathname.startsWith('/survey/') ||
    request.nextUrl.pathname.startsWith('/proposal/') ||
    request.nextUrl.pathname.includes('/pdf/public') ||
    request.nextUrl.pathname.startsWith('/captura') ||
    request.nextUrl.pathname.startsWith('/suporte') ||
    request.nextUrl.pathname.startsWith('/acompanhar-ticket') ||
    request.nextUrl.pathname.startsWith('/proposals/client') ||
    request.nextUrl.pathname.startsWith('/loja/') || // proposta do Varejo para a cliente (link com token)
    // Políticas públicas — exigidas pelo Google para publicar o OAuth (Gmail)
    request.nextUrl.pathname === '/privacy' ||
    request.nextUrl.pathname === '/terms' ||
    request.nextUrl.pathname === '/contrato-de-dados'

  if (!user && !isAuthRoute && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    // Arquivos de public/ (logo do produto etc.) não passam pelo login
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
