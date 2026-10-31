import { createClient } from '@supabase/supabase-js'

const PRICE_URL = 'https://wcbxlqbpeodspoungwwz.supabase.co'

// A chave fica só na Vercel (PRICE_SERVICE_KEY). Nunca escreva chave no código: o repositório é público.
export function createPriceAdminClient() {
  const key = process.env.PRICE_SERVICE_KEY || process.env.PRICE_SUPABASE_SERVICE_ROLE_KEY || process.env.PRICE_KEY
  if (!key) throw new Error('Chave do Orbis Price não configurada (PRICE_SERVICE_KEY na Vercel).')
  return createClient(PRICE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
}
