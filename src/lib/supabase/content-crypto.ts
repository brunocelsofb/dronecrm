// ─── Camada de criptografia nos clientes Supabase do servidor ─────────────────
// Toda consulta feita pelos clientes do servidor (admin e usuário) passa aqui:
//   - gravação (insert/upsert/update) nas colunas de ENCRYPTED_COLUMNS → cifra com
//     a chave da empresa da linha;
//   - leitura de qualquer tabela → abre o que vier cifrado (inclusive em junções).
// Assim nenhuma tela ou rotina precisa lembrar de cifrar/decifrar.
// Limite: filtros de texto (ilike/eq) nessas colunas não funcionam no banco — a
// busca da Central filtra depois de abrir (whatsapp-search).

import { decryptDeep, encryptJson, encryptText, ENCRYPTED_COLUMNS } from '@/lib/crypto/content'

type Row = Record<string, unknown>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
export type TenantResolver = (table: string, row: Row) => Promise<string | null>

const WRITE_OPS = new Set(['insert', 'upsert', 'update'])

async function encryptPayload(table: string, payload: unknown, resolve: TenantResolver): Promise<unknown> {
  const cols = ENCRYPTED_COLUMNS[table]
  if (!cols) return payload
  const one = async (row: unknown) => {
    if (!row || typeof row !== 'object') return row
    const r = row as Row
    if (!Object.keys(cols).some(c => r[c] !== undefined && r[c] !== null)) return row
    const tenantId = await resolve(table, r)
    const out: Row = { ...r }
    for (const [c, kind] of Object.entries(cols)) {
      if (out[c] === undefined || out[c] === null) continue
      out[c] = kind === 'json' ? encryptJson(tenantId, out[c]) : encryptText(tenantId, typeof out[c] === 'string' ? (out[c] as string) : String(out[c]))
    }
    return out
  }
  return Array.isArray(payload) ? Promise.all(payload.map(one)) : one(payload)
}

function decryptResult(res: Any): Any {
  if (!res || typeof res !== 'object' || !('data' in res) || res.data === null || res.data === undefined) return res
  const data = decryptDeep(res.data)
  return data === res.data ? res : { ...res, data }
}

// Builder comum (select/delete/filtros): só abre o resultado
function wrapBuilder(b: Any): Any {
  if (!b || (typeof b !== 'object' && typeof b !== 'function')) return b
  return new Proxy(b, {
    get(t, p) {
      if (p === 'then') {
        return (res?: (v: Any) => Any, rej?: (e: Any) => Any) => t.then((r: Any) => decryptResult(r)).then(res, rej)
      }
      const v = t[p]
      if (typeof v !== 'function') return v
      return (...args: unknown[]) => {
        const out = v.apply(t, args)
        return out && typeof out === 'object' && typeof out.then === 'function' ? wrapBuilder(out) : out
      }
    },
  })
}

// Gravação em tabela com coluna cifrada: guarda a cadeia e monta a consulta real
// só no "await" (cifrar é assíncrono porque pode precisar descobrir a empresa).
function deferredWrite(qb: Any, table: string, op: string, payload: unknown, opts: unknown, resolve: TenantResolver): Any {
  const chain: [string, unknown[]][] = []
  const run = async () => {
    const enc = await encryptPayload(table, payload, resolve)
    let b = opts === undefined ? qb[op](enc) : qb[op](enc, opts)
    for (const [m, a] of chain) b = b[m](...a)
    return decryptResult(await b)
  }
  const proxy: Any = new Proxy({}, {
    get(_t, p) {
      if (p === 'then') return (res?: (v: Any) => Any, rej?: (e: Any) => Any) => run().then(res, rej)
      if (p === 'catch') return (rej: (e: Any) => Any) => run().catch(rej)
      if (p === 'finally') return (f: () => void) => run().finally(f)
      return (...args: unknown[]) => { chain.push([String(p), args]); return proxy }
    },
  })
  return proxy
}

function wrapFrom(client: Any, resolve: TenantResolver) {
  return (table: string) => {
    const qb = client.from(table)
    return new Proxy(qb, {
      get(t, p) {
        const v = t[p]
        if (typeof v !== 'function') return v
        if (WRITE_OPS.has(String(p)) && ENCRYPTED_COLUMNS[table]) {
          return (payload: unknown, opts?: unknown) => deferredWrite(t, table, String(p), payload, opts, resolve)
        }
        return (...args: unknown[]) => wrapBuilder(v.apply(t, args))
      },
    })
  }
}

export function withContentCrypto<C>(client: C, resolve: TenantResolver): C {
  const c = client as Any
  return new Proxy(c, {
    get(t, p, recv) {
      if (p === 'from') return wrapFrom(t, resolve)
      if (p === 'schema') return (s: string) => withContentCrypto(t.schema(s), resolve)
      if (p === 'rpc') return (...args: unknown[]) => wrapBuilder(t.rpc(...args))
      const v = Reflect.get(t, p, recv)
      return typeof v === 'function' ? v.bind(t) : v
    },
  }) as C
}
