import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { resolveTenantId } from '@/lib/tenant/context'

export default async function ZapSignTemplatesPage() {
  try {
    const supabase = await createClient()
    const [{ data: templates, error: templatesError }, { data: settings }] = await Promise.all([
      supabase.from('zapsign_templates').select('*').order('created_at', { ascending: false }),
      supabase.from('organization_settings').select('zapsign_api_token').eq('tenant_id', await resolveTenantId()).maybeSingle(),
    ])

    if (templatesError) {
      return (
        <div className="max-w-2xl rounded-lg border border-red-300 bg-red-50 p-6 space-y-2">
          <h1 className="text-lg font-semibold text-red-900">Erro ao carregar modelos</h1>
          <p className="font-mono text-sm text-red-700">{templatesError.message}</p>
          <p className="text-xs text-red-500">Code: {templatesError.code}</p>
        </div>
      )
    }

    const isConnected = !!settings?.zapsign_api_token

    return (
      <div className="max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Modelos ZapSign</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              Cadastre aqui os modelos de contrato/aditivo que você criou no ZapSign. O token do modelo fica em: ZapSign → Modelos → ver modelo → copiar token.
            </p>
          </div>
          {!isConnected && (
            <Link href="/settings" className="rounded-md border border-yellow-400 bg-yellow-50 px-3 py-1.5 text-xs text-yellow-800 hover:bg-yellow-100">
              ⚠️ Configure o token da ZapSign
            </Link>
          )}
        </div>

        <div className="space-y-2 rounded-lg border border-brand-100 bg-brand-100/40 p-4 text-xs text-gray-700">
          <p className="text-sm font-medium text-gray-900">Como montar o modelo</p>
          <ol className="list-decimal space-y-1 pl-4">
            <li>No Word, escreva o contrato e coloque as variáveis entre chaves duplas onde o CRM deve preencher.</li>
            <li>Na ZapSign: Modelos → Criar modelo → envie o .docx. Copie o token do modelo.</li>
            <li>Cadastre o modelo abaixo. No contrato do CRM, aba “Contrato e aditivos” → “Enviar para assinatura”.</li>
          </ol>
          <p className="pt-1 font-medium text-gray-900">Variáveis que o CRM preenche</p>
          <p className="font-mono text-[11px] leading-5 text-gray-600">
            {'{{cliente}} {{empresa}} {{cnpj}} {{contato}} {{email_contato}} {{telefone_contato}} {{processo}} {{valor_mensal}} {{inicio_vigencia}} {{fim_vigencia}} {{minha_empresa}} {{minha_cnpj}} {{data_hoje}}'}
          </p>
          <p className="text-[11px] text-gray-500">Campos personalizados do contrato também entram, pela chave do campo (ex.: {'{{chave_do_campo}}'}).</p>
        </div>

        <form method="POST" action="/api/zapsign/templates/create" className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-white p-4">
          <p className="text-sm font-medium text-gray-700">+ Novo modelo</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500">Nome do modelo</label>
              <input name="name" required placeholder="Ex: Contrato Padrão ORBIS" className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs text-gray-500">Tipo</label>
              <select name="type" className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none">
                <option value="contrato">Contrato</option>
                <option value="aditivo">Aditivo</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500">Token do modelo no ZapSign</label>
            <input name="zapsign_template_token" required placeholder="Cole o token que aparece no painel da ZapSign" className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-mono focus:border-brand-700 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs text-gray-500">Descrição (opcional)</label>
            <input name="description" placeholder="Ex: Modelo padrão pra novos projetos" className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
          </div>
          <button type="submit" className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800">
            Salvar modelo
          </button>
        </form>

        <div className="space-y-1.5">
          {(templates ?? []).map((t) => (
            <div key={t.id} className="flex items-start justify-between rounded-lg border border-gray-200 bg-white p-3 text-sm">
              <div>
                <span className="font-medium text-gray-900">{t.name}</span>
                <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${t.type === 'aditivo' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{t.type}</span>
                {t.description && <p className="mt-0.5 text-xs text-gray-400">{t.description}</p>}
                <p className="mt-0.5 font-mono text-[10px] text-gray-400">{t.zapsign_template_token}</p>
              </div>
              <form method="POST" action={`/api/zapsign/templates/${t.id}/delete`}>
                <button type="submit" className="text-xs text-negative-600 hover:underline">Remover</button>
              </form>
            </div>
          ))}
          {(templates ?? []).length === 0 && <p className="text-sm text-gray-400">Nenhum modelo cadastrado ainda.</p>}
        </div>
      </div>
    )
  } catch (e: any) {
    return (
      <div className="max-w-2xl space-y-4 rounded-lg border border-red-300 bg-red-50 p-6">
        <h1 className="text-lg font-semibold text-red-900">Erro ao carregar a página</h1>
        <p className="font-mono text-sm text-red-700">{e?.message ?? String(e)}</p>
        <p className="text-xs text-red-500">Stack: {String(e?.stack ?? '').slice(0, 300)}</p>
      </div>
    )
  }
}
