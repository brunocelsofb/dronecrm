import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { withContentCrypto } from './content-crypto'
import { resolveRowTenant } from './row-tenant'

// ⚠️ Este cliente usa a chave service_role, que IGNORA todo o RLS.
// Só deve ser usado em Server Actions que já checaram manualmente que
// o usuário atual é admin — nunca exponha isso a um Client Component,
// nunca importe este arquivo fora de código server-only.
//
// As colunas de conteúdo (mensagens de WhatsApp, conversas da assistente) são
// cifradas/decifradas sozinhas por empresa — ver content-crypto.ts.
export function createAdminClient() {
  return withContentCrypto(createRawAdminClient(), resolveRowTenant)
}

// Sem a camada de criptografia: só para descobrir a empresa de uma linha
// (row-tenant) e para a rotina que cifra mensagens antigas. Não use em telas.
export function createRawAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      db: { schema: 'contract_crm' },
      auth: { autoRefreshToken: false, persistSession: false },
    }
  )
}
