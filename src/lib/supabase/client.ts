// Client Supabase para Client Components ("use client").
// Cookies de sessão sem validade: fechar o navegador encerra o login (session-cookie.ts).
import { createBrowserClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr'
import { sessionOnly } from './session-cookie'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: 'contract_crm' },
      cookies: {
        getAll() {
          if (typeof document === 'undefined') return []
          return parseCookieHeader(document.cookie).map(c => ({ name: c.name, value: c.value ?? '' }))
        },
        setAll(cookiesToSet) {
          if (typeof document === 'undefined') return
          cookiesToSet.forEach(({ name, value, options }) => {
            document.cookie = serializeCookieHeader(name, value, sessionOnly(options))
          })
        },
      },
    }
  )
}
