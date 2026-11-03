import { NextResponse } from 'next/server'

// Temporário: confere se o servidor alcança a API pública do PNCP (só status e totais; dado público)
export const dynamic = 'force-dynamic'
export async function GET() {
  const t0 = Date.now()
  const out: Record<string, unknown> = {}
  for (const [k, url] of Object.entries({
    proposta: 'https://pncp.gov.br/api/consulta/v1/contratacoes/proposta?dataFinal=20261231&uf=SP&pagina=1&tamanhoPagina=10',
    publicacao: 'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?dataInicial=20261102&dataFinal=20261102&codigoModalidadeContratacao=6&pagina=1&tamanhoPagina=10',
  })) {
    const t = Date.now()
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' })
      const j = r.ok ? await r.json().catch(() => null) : null
      out[k] = { status: r.status, ms: Date.now() - t, total: (j as { totalRegistros?: number } | null)?.totalRegistros ?? null }
    } catch (e) { out[k] = { error: String((e as Error).message), ms: Date.now() - t } }
  }
  return NextResponse.json({ ...out, totalMs: Date.now() - t0, region: process.env.VERCEL_REGION ?? null })
}
