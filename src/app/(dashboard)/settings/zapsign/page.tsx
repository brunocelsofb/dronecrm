import { redirect } from 'next/navigation'
import Link from 'next/link'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth/role'
import { resolveTenantId } from '@/lib/tenant/context'
import { ZapSignWebhookButton, ZapSignTestButton, ZapSignHookCard } from '@/components/zapsign/zapsign-webhook-button'
import { SettingsSubpage } from '@/components/settings/settings-subpage'

export const dynamic = 'force-dynamic'

export default async function ZapSignSettingsPage({ searchParams }: { searchParams: Promise<{ salvo?: string; zapsign?: string }> }) {
  const profile = await getCurrentProfile()
  if (profile?.role !== 'admin') redirect('/')
  const sp = await searchParams
  const supabase = await createClient()
  const { data: settings } = await supabase.from('organization_settings')
    .select('zapsign_api_token, zapsign_webhook_url, zapsign_env, zapsign_hook_secret')
    .eq('tenant_id', await resolveTenantId()).maybeSingle()
  const h = await headers()
  return (
    <SettingsSubpage title="ZapSign — assinatura digital" description="Contratos e aditivos assinados na ZapSign voltando sozinhos para o CRM.">
      {sp.salvo && <p role="status" className="rounded-lg bg-positive-100 px-3 py-2 text-sm text-positive-700">Configuração da ZapSign salva.</p>}
      {sp.zapsign === 'sem-permissao' && <p role="status" className="rounded-lg bg-negative-100 px-3 py-2 text-sm text-negative-700">Só o Admin altera a ZapSign.</p>}
        <div className="space-y-2 rounded-lg border border-brand-100 bg-brand-100/40 p-4 text-xs text-gray-700">
          <p className="text-sm font-semibold text-gray-900">✍️ ZapSign — como funciona</p>
          <p>São dois sentidos:</p>
          <p><strong className="text-positive-700">⬅ Volta: ZapSign → CRM (“todos assinaram”)</strong> — gratuito. O CRM gera o endereço no quadro <em>Avisos de assinatura sem Plano de API</em> e você cola na ZapSign em Configurações → Integrações → API ZapSign → Webhooks. Quando todos assinam, o PDF assinado volta para o contrato, o consultor recebe a tarefa de dar ganho e o gestor é avisado no WhatsApp.</p>
          <p><strong className="text-brand-800">➡ Ida: CRM → ZapSign (criar o documento)</strong> — só com o <strong>Plano de API</strong> da ZapSign (token + Ambiente abaixo, e “Testar conexão”). Sem o plano, o consultor cria e envia o documento na própria ZapSign e registra o link no contrato (aba Contrato e aditivos).</p>
        </div>

        <form method="POST" action="/api/zapsign/save-token" className="space-y-3 rounded-lg border border-gray-200 bg-white p-6">
          <div>
            <h3 className="text-sm font-medium text-gray-900">✍️ ZapSign — Assinatura Digital</h3>
            <p className="mt-0.5 text-xs text-gray-400">
              Token da API do ZapSign (em <a href="https://app.zapsign.com.br/conta/integracoes" target="_blank" rel="noopener noreferrer" className="underline">app.zapsign.com.br → Integrações → API ZAPSIGN</a>).
            </p>
          </div>
          {settings?.zapsign_api_token
            ? <p className="text-sm text-positive-700">✅ Token configurado</p>
            : <p className="text-xs text-yellow-700">⚠️ Não configurado ainda.</p>
          }
          <div>
            <label className="block text-xs text-gray-500">Ambiente</label>
            <select name="zapsign_env" defaultValue={settings?.zapsign_env === 'sandbox' ? 'sandbox' : 'producao'} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm">
              <option value="producao">Produção (validade jurídica — exige plano de API)</option>
              <option value="sandbox">Teste / sandbox (sem validade jurídica)</option>
            </select>
            <p className="mt-1 text-[11px] text-gray-400">O token de teste vem da conta sandbox da ZapSign e só funciona em “Teste”.</p>
          </div>
          <div>
            <label className="block text-xs text-gray-500">API Token</label>
            <input name="zapsign_api_token" type="password" placeholder={settings?.zapsign_api_token ? '••••••••' : 'Cole o token aqui'} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-mono focus:border-brand-700 focus:outline-none" />
          </div>
          <button type="submit" className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800">Salvar</button>
        </form>
        <ZapSignHookCard currentUrl={settings?.zapsign_hook_secret ? `https://${h.get('x-forwarded-host') ?? h.get('host')}/api/zapsign-webhook?k=${settings.zapsign_hook_secret}` : null} />
        <ZapSignTestButton hasToken={!!settings?.zapsign_api_token} />
        <ZapSignWebhookButton hasToken={!!settings?.zapsign_api_token} currentUrl={settings?.zapsign_webhook_url ?? null} />
      <p className="text-xs text-gray-500">Os modelos de contrato e aditivo ficam em <Link href="/zapsign" className="text-brand-700 hover:underline">Modelos ZapSign</Link>.</p>
    </SettingsSubpage>
  )
}
