// Planilha-modelo da importação de clientes do Varejo
import * as XLSX from 'xlsx'
import { NextResponse } from 'next/server'
import { hasFeature } from '@/lib/auth/access'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!(await hasFeature('varejo'))) return NextResponse.json({ error: 'Sem acesso ao módulo Varejo.' }, { status: 403 })
  const header = ['nome', 'telefone', 'email', 'cpf', 'nascimento', 'cidade', 'uf', 'cep', 'endereco', 'observacoes', 'ultima_compra', 'total_comprado', 'qtd_compras', 'aceita_whatsapp']
  const example = [['Cliente de exemplo', '(62) 99999-0000', 'exemplo@email.com', '', '15/03/1985', 'Goiânia', 'GO', '74000000', '', 'Usa M', '10/06/2026', '459,80', '3', 'sim']]
  const help = [
    ['Como preencher'],
    ['Uma linha por cliente. nome é obrigatório; telefone com DDD identifica a cliente (mesmo telefone atualiza).'],
    ['ultima_compra, total_comprado e qtd_compras: histórico de antes do CRM. Contam para ativa ou inativa.'],
    ['aceita_whatsapp: sim só se a cliente autorizou receber novidades e ofertas (LGPD).'],
    ['Datas no formato dd/mm/aaaa. Valores no formato 459,80.'],
    ['Apague a linha de exemplo antes de importar.'],
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...example]), 'Clientes')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(help), 'Como preencher')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="modelo-clientes.xlsx"',
      'Cache-Control': 'no-store',
    },
  })
}
