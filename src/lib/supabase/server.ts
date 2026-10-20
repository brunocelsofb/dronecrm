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
import { withContentCrypto } from './content-crypto'
import { resolveRowTenant } from './row-tenant'

export async function createClient() {
  const cookieStore = await cookies()

  // Conteúdo cifrado por empresa (mensagens de WhatsApp etc.) abre/fecha sozinho
  return withContentCrypto(createServerClient(
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
  ), resolveRowTenant)
}

/** Retorna o tenant_id ativo de impersonation.
 * Lê primeiro o cookie (funciona em Route Handlers onde o middleware não injeta headers),
 * e usa o header como fallback (funciona em Server Components/Actions via middleware). */
export async function getActiveTenantId(): Promise<string | null> {
  // Cookie: fonte primária — acessível em qualquer contexto server (Route Handlers incluídos)
  const cookieStore = await cookies()
  const headersList = await headers()
  const candidate = cookieStore.get('orbis_imp_tid')?.value ?? headersList.get('x-orbis-imp-tenant-id') ?? null
  if (!candidate) return null

  // Só vale para Super Admin: o cookie poderia ser forjado por qualquer usuário
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await createAdminClient()
    .from('profiles').select('is_super_admin, tenant_id').eq('id', user.id).maybeSingle()
  if (!profile?.is_super_admin) return null
  // Outra empresa: só com liberação de suporte ativa
  if (candidate !== profile.tenant_id) {
    const { activeSupportGrant } = await import('@/lib/tenant/support')
    if (!(await activeSupportGrant(candidate))) return null
  }
  return candidate
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
    // Super Admin em acesso de suporte: preso à empresa e só leitura
    const { createScopedAdmin } = await import('@/lib/tenant/scoped-admin')
    return { client: (await createScopedAdmin(tenantId)) as any, tenantId }
  }
  const regularClient = await createClient()
  return { client: regularClient as any, tenantId: null }
}
