// Exclusão de dados (pública): como pedir a exclusão dos dados recebidos do Facebook/Instagram
// e consulta do pedido feito pelo Meta (?codigo=). Exigida pelo Meta para o app da plataforma.
import { LegalPage, type LegalSection } from '@/components/legal/legal-page'
import { OPERATOR } from '@/lib/legal/dpa'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Exclusão de dados — Comercial Drone',
  description: 'Como pedir a exclusão dos dados recebidos do Facebook e do Instagram pelo Comercial Drone.',
}

const S: LegalSection[] = [
  { title: '1. Empresa que conectou o Facebook/Instagram ao sistema', body: [
    'No sistema, abra Anúncios (Meta) e clique em Desconectar. Na hora, o sistema apaga os acessos guardados, as páginas, os formulários e os números de anúncios lidos do Meta.',
    'Ou remova o app nas configurações do Facebook (Configurações e privacidade → Configurações → Integrações comerciais → remover). O Meta nos avisa e apagamos os mesmos dados automaticamente; você recebe um código para acompanhar o pedido nesta página.',
  ] },
  { title: '2. Pessoa que preencheu um formulário de anúncio', body: [
    'Se você preencheu o formulário de cadastro de um anúncio de uma empresa que usa o Comercial Drone, seus dados estão no CRM dessa empresa, que é a controladora deles. Peça a exclusão diretamente a ela. Se não conseguir, escreva para o contato abaixo informando a empresa e o seu e-mail ou telefone: encaminhamos o pedido e ajudamos a empresa a atender.',
  ] },
  { title: '3. Contato', body: [`E-mail: ${OPERATOR.email}`] },
]

export default async function DataDeletionPage({ searchParams }: { searchParams: Promise<{ codigo?: string }> }) {
  const code = String((await searchParams).codigo ?? '').trim()
  let found: { created_at: string; status: string } | null = null
  if (/^[0-9a-f]{18}$/.test(code)) {
    const { data } = await createAdminClient().from('meta_data_deletion_requests').select('created_at, status').eq('confirmation_code', code).maybeSingle()
    found = (data as { created_at: string; status: string } | null) ?? null
  }
  return (
    <LegalPage title="Exclusão de dados" updated="29 de outubro de 2026" intro="Como pedir a exclusão dos dados que o Comercial Drone recebeu do Facebook e do Instagram (Meta)." sections={S}>
      {code && (
        <div className={`mb-8 rounded-lg border p-4 text-sm ${found ? 'border-positive-600/30 bg-positive-100 text-positive-700' : 'border-gray-200 bg-gray-50 text-gray-700'}`}>
          {found
            ? <>Pedido <strong>{code}</strong> recebido em {new Date(found.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}: {found.status === 'concluido' ? 'dados excluídos.' : found.status}</>
            : <>Não encontramos o pedido <strong>{code}</strong>. Confira o código ou fale com {OPERATOR.email}.</>}
        </div>
      )}
    </LegalPage>
  )
}
