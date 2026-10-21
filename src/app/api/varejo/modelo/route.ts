// Planilha-modelo da importação de produtos do Varejo (uma linha por variação)
import * as XLSX from 'xlsx'
import { NextResponse } from 'next/server'
import { hasFeature } from '@/lib/auth/access'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!(await hasFeature('varejo'))) return NextResponse.json({ error: 'Sem acesso ao módulo Varejo.' }, { status: 403 })
  const header = ['codigo', 'nome', 'categoria', 'preco', 'preco_promocional', 'cor', 'tamanho', 'sku', 'estoque', 'descricao', 'composicao', 'cuidados', 'situacao']
  const example = [
    ['EX001', 'Peça de exemplo', 'Calças', '157,90', '', 'Preto', 'P', '', '2', 'Descrição curta da peça', '96% poliéster, 4% elastano', 'Lavar à mão', 'rascunho'],
    ['EX001', 'Peça de exemplo', 'Calças', '157,90', '', 'Preto', 'M', '', '1', '', '', '', ''],
  ]
  const help = [
    ['Como preencher'],
    ['Uma linha por variação (cor + tamanho). Linhas com o mesmo código formam uma peça.'],
    ['codigo: código da peça que você já usa (ex.: PC682). Obrigatório.'],
    ['nome e preco: obrigatórios na primeira linha de cada código. Preço no formato 157,90.'],
    ['sku: opcional. Em branco, o CRM monta CODIGO-COR-TAMANHO.'],
    ['estoque: quantidade daquela cor e tamanho.'],
    ['situacao: rascunho, publicado ou arquivado (em branco = rascunho).'],
    ['Importar de novo atualiza a peça (mesmo código) e a variação (mesmo SKU). Nada é apagado.'],
    ['Apague as linhas de exemplo (EX001) antes de importar.'],
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...example]), 'Produtos')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(help), 'Como preencher')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="modelo-produtos.xlsx"',
      'Cache-Control': 'no-store',
    },
  })
}
