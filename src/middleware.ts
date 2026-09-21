import { NextRequest, NextResponse } from 'next/server'

const COOKIE_TENANT_ID = 'orbis_imp_tid'

export function middleware(request: NextRequest) {
  const response = NextResponse.next()

  const impTenantId = request.cookies.get(COOKIE_TENANT_ID)?.value

  if (impTenantId) {
    // Propaga o tenant de impersonation como header interno para os Server Components
    // lerem sem precisar acessar cookies novamente.
    response.headers.set('x-orbis-imp-tenant-id', impTenantId)
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
