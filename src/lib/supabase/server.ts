// Client Supabase para Server Components, Server Actions e Route Handlers
//
// NOTA: a forma de ler/escrever cookies dentro de createServerClient
// mudou em versões anteriores do @supabase/ssr (cookies.get/set/remove
// vs getAll/setAll). Verifique qual assinatura sua versão instalada
// espera — não tenho certeza de qual é a atual no momento em que
// você for instalar o pacote.

import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: 'contract_crm' },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll pode ser chamado de um Server Component, onde
            // não é permitido escrever cookies — isso é esperado e
            // seguro de ignorar se houver um middleware atualizando
            // a sessão (ver middleware.ts).
          }
        },
      },
    }
  )
}

/** Retorna o tenant_id ativo de impersonation (do request header injetado pelo middleware), ou null */
export async function getActiveTenantId(): Promise<string | null> {
  const headersList = await headers()
  return headersList.get('x-orbis-imp-tenant-id') ?? null
}

/**
 * Retorna o cliente Supabase adequado + o tenantId ativo.
 * - Normal: client = cliente com RLS, tenantId = null (RLS filtra automaticamente)
 * - Impersonando: client = admin (sem RLS), tenantId = ID do tenant alvo
 *
 * Quando tenantId for não-nulo, adicione .eq('tenant_id', tenantId)
 * nas queries de tabelas com escopo de tenant.
 */
export async function createClientForTenant(): Promise<{
  client: ReturnType<typeof createAdminClient>
  tenantId: string | null
}> {
  const tenantId = await getActiveTenantId()
  if (tenantId) {
    return { client: createAdminClient() as any, tenantId }
  }
  const regularClient = await createClient()
  return { client: regularClient as any, tenantId: null }
}
