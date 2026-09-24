// Middleware: renova a sessao do Supabase a cada request e
// redireciona usuarios nao autenticados para /login.
// Tambem injeta o tenant de impersonation como REQUEST header.

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const COOKIE_TENANT_ID = 'orbis_imp_tid'

export async function proxy(request: NextRequest) {
  // Rotas de API passam direto (webhooks externos, endpoints internos, etc.)
  // Evita overhead de auth em chamadas server-to-server
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Prepara request headers com impersonation (se ativo)
  // IMPORTANTE: request headers injetados via NextResponse.next({ request: { headers } })
  // ficam visiveis para Server Components via headers() do next/headers.
  // Response headers NAO sao visiveis para Server Components.
  const requestHeaders = new Headers(request.headers)
  const impTenantId = request.cookies.get(COOKIE_TENANT_ID)?.value
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

  const isAuthRoute = request.nextUrl.pathname.startsWith('/login') ||
                      request.nextUrl.pathname.startsWith('/register')

  const isPublicRoute =
    request.nextUrl.pathname.startsWith('/nps/') ||
    request.nextUrl.pathname.startsWith('/survey/') ||
    request.nextUrl.pathname.startsWith('/proposal/') ||
    request.nextUrl.pathname.includes('/pdf/public') ||
    request.nextUrl.pathname.startsWith('/captura') ||
    request.nextUrl.pathname.startsWith('/suporte') ||
    request.nextUrl.pathname.startsWith('/acompanhar-ticket') ||
    request.nextUrl.pathname.startsWith('/proposals/client')

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
    '/((?!_next/static|_next/image|favicon.ico|api/).*)',
  ],
}
