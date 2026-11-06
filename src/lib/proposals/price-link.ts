// ─── Passe do Price → CRM ─────────────────────────────────────────────────────
// O Price roda no navegador e não guarda segredo. Por isso, ao abrir o Price pela
// proposta, o CRM entrega um passe assinado que vale só para aquela oportunidade e
// proposta, por tempo limitado. O Price devolve o passe ao enviar a precificação e
// /api/proposals/from-price recusa qualquer envio sem passe válido.
// Chave: PRICE_LINK_SECRET (env) ou, sem ela, derivada da chave de serviço do banco.
import { createHmac, timingSafeEqual } from 'crypto'

const TTL_DAYS = 30

function key(): Buffer {
  const base = process.env.PRICE_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base) throw new Error('Chave do passe do Price não configurada.')
  return createHmac('sha256', base).update('price-link-v1').digest()
}

function sign(contractId: string, proposalId: string, exp: number): string {
  return createHmac('sha256', key()).update(`${contractId}.${proposalId}.${exp}`).digest('base64url')
}

export function createPriceLinkToken(contractId: string, proposalId: string | null): string {
  const exp = Math.floor(Date.now() / 1000) + TTL_DAYS * 86400
  return `v1.${exp}.${sign(contractId, proposalId ?? '', exp)}`
}

export function verifyPriceLinkToken(token: unknown, contractId: string, proposalId: string | null | undefined): 'ok' | 'missing' | 'expired' | 'invalid' {
  if (typeof token !== 'string' || !token) return 'missing'
  const [v, expRaw, sig] = token.split('.')
  const exp = Number(expRaw)
  if (v !== 'v1' || !Number.isFinite(exp) || !sig) return 'invalid'
  const expected = Buffer.from(sign(contractId, proposalId ?? '', exp))
  const got = Buffer.from(sig)
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return 'invalid'
  if (exp < Math.floor(Date.now() / 1000)) return 'expired'
  return 'ok'
}
