'use server'

// ─── Varejo: contas de recebimento (InfinitePay / Mercado Pago) ────────────────
// Só o administrador. Chaves ficam criptografadas e nunca voltam para a tela.

import { revalidatePath } from 'next/cache'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { encryptSecret } from '@/lib/ai/tenant-key'
import { cleanHandle, PAY_PROVIDERS, type PayProvider } from '@/lib/retail/payments'

type Result = { ok: true } | { ok: false; error: string }
const isProvider = (v: unknown): v is PayProvider => PAY_PROVIDERS.some(p => p.id === v)

// token: undefined = manter; '' ou null = apagar; texto = trocar
export async function saveRetailPaymentSetup(input: {
  pix_provider: string; card_provider: string; infinitepay_handle: string | null
  mp_token?: string | null; ip_token?: string | null
}): Promise<Result> {
  const access = await hasFeature('varejo')
  if (!access) return { ok: false, error: 'Sem acesso ao módulo Varejo.' }
  if (await getSupportSession()) return { ok: false, error: 'Acesso de suporte é só leitura.' }
  if (!access.isAdmin) return { ok: false, error: 'Só o administrador muda as contas de recebimento.' }
  if (!isProvider(input.pix_provider) || !isProvider(input.card_provider)) return { ok: false, error: 'Escolha quem gera o link.' }
  const handle = input.infinitepay_handle ? cleanHandle(input.infinitepay_handle) : null
  if (input.infinitepay_handle && !handle) return { ok: false, error: 'InfiniteTag inválida: use o @ da loja no app da InfinitePay, sem espaços.' }
  const uses = (p: PayProvider) => input.pix_provider === p || input.card_provider === p
  if (uses('infinitepay') && !handle) return { ok: false, error: 'Para usar a InfinitePay, informe a InfiniteTag da loja.' }

  const tenantId = await requireTenantId()
  const db = await createScopedAdmin(tenantId)
  const { data: org } = await db.from('organization_settings').select('retail_settings, retail_mp_token_enc').eq('tenant_id', tenantId).maybeSingle()
  const clean = (v: string | null | undefined) => (typeof v === 'string' ? v.trim() : v)
  const mp = clean(input.mp_token), ip = clean(input.ip_token)
  if (typeof mp === 'string' && mp && !/^[A-Za-z0-9_-]{20,300}$/.test(mp)) return { ok: false, error: 'Chave do Mercado Pago inválida: copie o "Access Token" de produção (começa com APP_USR-).' }
  if (typeof ip === 'string' && ip && !/^[A-Za-z0-9._-]{10,500}$/.test(ip)) return { ok: false, error: 'Token da InfinitePay inválido.' }
  const mpWillExist = typeof mp === 'string' ? !!mp : mp === null ? false : !!org?.retail_mp_token_enc
  if (uses('mercadopago') && !mpWillExist) return { ok: false, error: 'Para usar o Mercado Pago, cole a chave (Access Token) da conta da loja.' }

  const patch: Record<string, unknown> = {
    retail_settings: {
      ...((org as { retail_settings?: Record<string, unknown> } | null)?.retail_settings ?? {}),
      payments: { pix_provider: input.pix_provider, card_provider: input.card_provider, infinitepay_handle: handle },
    },
  }
  try {
    if (mp !== undefined) patch.retail_mp_token_enc = mp ? encryptSecret(mp) : null
    if (ip !== undefined) patch.retail_ip_token_enc = ip ? encryptSecret(ip) : null
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha ao proteger a chave.' }
  }
  const { error } = await db.from('organization_settings').update(patch).eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/varejo/precificacao')
  return { ok: true }
}
