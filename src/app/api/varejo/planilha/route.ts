// Planilha com as peças e o estoque de agora, no mesmo formato da importação.
// Uso: baixar → contar/corrigir a coluna "estoque" → importar em "Fazer contagem de estoque".
// O SKU de cada linha liga a planilha à variação certa (não duplica nada ao importar de volta).
import * as XLSX from 'xlsx'
import { NextResponse } from 'next/server'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { variantPrice } from '@/lib/retail/products'

export const dynamic = 'force-dynamic'

const money = (n: number | null | undefined) => (n === null || n === undefined ? '' : Number(n).toFixed(2).replace('.', ','))

export async function GET() {
  const access = await hasFeature('varejo')
  if (!access) return NextResponse.json({ error: 'Sem acesso ao módulo Varejo.' }, { status: 403 })
  const db = await createScopedAdmin(await requireTenantId())
  const { data } = await db.from('retail_products')
    .select('code, name, category, price, promo_price, cost_price, status, description, composition, care, retail_product_variants(sku, barcode, color, size, stock, active, price, promo_price)')
    .neq('status', 'arquivado').order('name').limit(10000)
  type V = { sku: string; barcode: string | null; color: string | null; size: string | null; stock: number; active: boolean; price: number | null; promo_price: number | null }
  type P = { code: string; name: string; category: string | null; price: number | null; promo_price: number | null; cost_price: number | null; status: string; description: string | null; composition: string | null; care: string | null; retail_product_variants: V[] }
  // Custo só para a administradora (fica no CRM, nunca na vitrine)
  const showCost = access.isAdmin
  const header = ['codigo', 'nome', 'categoria', 'preco', 'preco_promocional', ...(showCost ? ['custo'] : []), 'cor', 'tamanho', 'sku', 'codigo_barras', 'estoque', 'descricao', 'composicao', 'cuidados', 'situacao', 'preco_desta_cor (só leitura)']
  const rows: (string | number)[][] = []
  for (const p of (data ?? []) as unknown as P[]) {
    const vs = (p.retail_product_variants ?? []).filter(v => v.active)
      .sort((a, b) => `${a.color ?? ''}|${a.size ?? ''}`.localeCompare(`${b.color ?? ''}|${b.size ?? ''}`, 'pt-BR'))
    vs.forEach((v, i) => {
      const own = v.price !== null || v.promo_price !== null
      const vp = variantPrice({ price: p.price === null ? null : Number(p.price), promo_price: p.promo_price === null ? null : Number(p.promo_price) }, v)
      rows.push([
        p.code, i === 0 ? p.name : '', i === 0 ? p.category ?? '' : '', i === 0 ? money(p.price) : '', i === 0 ? money(p.promo_price) : '',
        ...(showCost ? [i === 0 ? money(p.cost_price) : ''] : []),
        v.color ?? '', v.size ?? '', v.sku, v.barcode ?? '', Number(v.stock),
        i === 0 ? p.description ?? '' : '', i === 0 ? p.composition ?? '' : '', i === 0 ? p.care ?? '' : '', i === 0 ? p.status : '',
        own && vp.final !== null ? money(vp.final) : '',
      ])
    })
  }
  const help = [
    ['Planilha do estoque de agora'],
    ['Uma linha por cor e tamanho. O SKU liga cada linha à variação certa: não mude o SKU.'],
    ['Contagem do mês: conte a loja, corrija só a coluna "estoque" e importe em Produtos → Histórico do estoque → Fazer contagem de estoque. O estoque fica igual ao da planilha.'],
    ['Chegou mercadoria: use a planilha de entrada só com as quantidades que chegaram (Dar entrada em mercadoria). Não use esta planilha com o estoque todo para entrada: somaria em dobro.'],
    ['Preço, nome e descrição: corrija aqui e importe em Cadastrar peças por planilha (não mexe no estoque).'],
    ['codigo_barras: o código da etiqueta (EAN). Pode preencher aqui de uma vez ou ligar na tela Somar peças, bipando.'],
    ['Uma cor e um tamanho por linha. Nada de "Preto / Azul" ou "P/M" na mesma célula.'],
    ['preco_desta_cor: só informa quando a cor tem preço próprio (muda em Produtos → peça → Preço por cor). A importação ignora essa coluna.'],
  ]
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
  ws['!cols'] = header.map(h => ({ wch: Math.max(10, Math.min(30, h.length + 4)) }))
  XLSX.utils.book_append_sheet(wb, ws, 'Produtos')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(help), 'Como usar')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="estoque-${day}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
}
