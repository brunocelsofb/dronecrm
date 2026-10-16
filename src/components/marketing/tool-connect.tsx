'use client'

// Envio de listas: conectar a chave de API do Mailchimp ou do RD Station.
// A chave fica criptografada no CRM e nunca volta para a tela (só o final).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveMailchimpKey, listMailchimpAudiences, saveMailchimpOptions, saveRdKey, disconnectTool } from '@/lib/actions/marketing-lists'

export type ToolsStatus = {
  mailchimp: { last4: string; dc: string; list_id: string | null; list_name: string | null; double_optin: boolean } | null
  rd_station: { last4: string; legal_basis: string | null } | null
}

export const LEGAL_BASES: { id: string; label: string; hint: string }[] = [
  { id: 'legitimate_interest', label: 'Legítimo interesse', hint: 'Comunicação relacionada ao que a pessoa já procurou.' },
  { id: 'consent', label: 'Consentimento', hint: 'A pessoa marcou que aceita receber comunicações.' },
  { id: 'pre_existent_contract', label: 'Contrato existente', hint: 'Clientes com contrato ativo.' },
]

export function ToolConnect({ provider, status }: { provider: 'mailchimp' | 'rd_station'; status: ToolsStatus }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [key, setKey] = useState('')
  const [dc, setDc] = useState('')
  const [audiences, setAudiences] = useState<{ id: string; name: string; members: number }[] | null>(null)
  const mc = status.mailchimp, rd = status.rd_station
  const [listId, setListId] = useState(mc?.list_id ?? '')
  const [double, setDouble] = useState(mc?.double_optin ?? false)
  const [legal, setLegal] = useState(rd?.legal_basis ?? 'legitimate_interest')

  const run = <T,>(fn: () => Promise<{ ok: true } & T | { ok: false; error: string }>, okText: string, after?: (r: T) => void) => start(async () => {
    const r = await fn()
    if (r.ok) { setMsg({ ok: true, text: okText }); after?.(r as unknown as T); setKey(''); router.refresh() }
    else setMsg({ ok: false, text: r.error })
  })

  return (
    <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <p className="text-sm font-semibold text-gray-900">Envio de listas do CRM para o {provider === 'mailchimp' ? 'Mailchimp' : 'RD Station'}</p>
      <p className="mt-0.5 text-xs text-gray-600">
        {provider === 'mailchimp'
          ? 'Com a chave de API, o CRM coloca os contatos das suas listas (Marketing → Listas) num público do Mailchimp, com a etiqueta "CRM - nome da lista". O disparo do e-mail é feito no Mailchimp.'
          : 'Com a chave de API, o CRM cria ou atualiza os contatos das suas listas (Marketing → Listas) no RD, com a etiqueta "CRM - nome da lista". O disparo do e-mail e as automações são feitos no RD.'}
      </p>

      {provider === 'mailchimp' && (
        <>
          <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs text-gray-600">
            <li>No Mailchimp: perfil → Profile → Extras → API keys → Create A Key (o caminho pode mudar; procure por &quot;API keys&quot;). Copie a chave.</li>
            <li>Cole abaixo. O prefixo do servidor (ex.: us21) vem no fim da chave; se não vier, veja no endereço do Mailchimp (us21.admin.mailchimp.com).</li>
            <li>Escolha o público (Audience) que vai receber os contatos.</li>
          </ol>
          {mc && <p className="mt-2 text-xs text-positive-700">Conectado · chave terminando em {mc.last4} · servidor {mc.dc}{mc.list_name ? ` · público: ${mc.list_name}` : ' · escolha o público'}</p>}
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_120px_auto]">
            <input value={key} onChange={e => setKey(e.target.value)} placeholder={mc ? 'Nova chave (só se for trocar)' : 'Chave de API do Mailchimp'} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" autoComplete="off" />
            <input value={dc} onChange={e => setDc(e.target.value)} placeholder="us21 (opcional)" className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
            <button disabled={pending || !key.trim()} onClick={() => run<{ audiences: { id: string; name: string; members: number }[] }>(() => saveMailchimpKey({ key, dc }), 'Mailchimp conectado. Escolha o público.', r => setAudiences(r.audiences))}
              className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">Conectar</button>
          </div>
          {mc && (
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
              <div className="flex gap-2">
                <select value={listId} onChange={e => setListId(e.target.value)} className="min-w-0 flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm">
                  <option value="">{audiences ? 'Escolha o público' : mc.list_name ?? 'Clique em "Buscar públicos"'}</option>
                  {(audiences ?? []).map(a => <option key={a.id} value={a.id}>{a.name} ({a.members} contatos)</option>)}
                  {!audiences && mc.list_id && <option value={mc.list_id}>{mc.list_name ?? mc.list_id}</option>}
                </select>
                <button disabled={pending} onClick={() => run<{ audiences: { id: string; name: string; members: number }[] }>(() => listMailchimpAudiences(), 'Públicos atualizados.', r => setAudiences(r.audiences))}
                  className="whitespace-nowrap rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700">Buscar públicos</button>
              </div>
              <button disabled={pending || !listId} onClick={() => run(() => saveMailchimpOptions({ listId, listName: audiences?.find(a => a.id === listId)?.name ?? mc.list_name ?? '', doubleOptin: double }), 'Público salvo.')}
                className="rounded-md border border-brand-700 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50">Salvar público</button>
              <label className="flex items-center gap-2 text-xs text-gray-700 sm:col-span-2">
                <input type="checkbox" checked={double} onChange={e => setDouble(e.target.checked)} className="accent-brand-700" />
                Pedir confirmação por e-mail para contatos novos (double opt-in) — mais seguro para a LGPD, mas só entra quem confirmar.
              </label>
            </div>
          )}
        </>
      )}

      {provider === 'rd_station' && (
        <>
          <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs text-gray-600">
            <li>No RD Station Marketing, entre no App Publisher (loja de apps do RD) com perfil Gestor ou Dono e clique em &quot;Gerar chave de API&quot;.</li>
            <li>Cole a chave abaixo e escolha a base legal (LGPD) que vale para os contatos enviados.</li>
            <li>Cada envio registra no RD uma conversão &quot;crm-lista-nome-da-lista&quot; e a etiqueta da lista.</li>
          </ol>
          {rd && <p className="mt-2 text-xs text-positive-700">Conectado · chave terminando em {rd.last4}</p>}
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_200px_auto]">
            <input value={key} onChange={e => setKey(e.target.value)} placeholder={rd ? 'Nova chave (só se for trocar)' : 'Chave de API do RD Station'} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" autoComplete="off" />
            <select value={legal} onChange={e => setLegal(e.target.value)} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" title={LEGAL_BASES.find(l => l.id === legal)?.hint}>
              {LEGAL_BASES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            <button disabled={pending || (!rd && !key.trim())} onClick={() => run(() => saveRdKey({ key, legalBasis: legal }), rd && !key ? 'Base legal salva.' : 'RD Station conectado.')}
              className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{rd && !key ? 'Salvar' : 'Conectar'}</button>
          </div>
          <p className="mt-1 text-[11px] text-gray-500">A base legal é uma decisão da empresa: na dúvida, confirme com o jurídico. O RD só confirma a chave no primeiro envio.</p>
        </>
      )}

      {(provider === 'mailchimp' ? mc : rd) && (
        <button disabled={pending} onClick={() => { if (window.confirm('Desconectar? As listas param de ser enviadas para esta ferramenta.')) run(() => disconnectTool(provider), 'Desconectado.') }}
          className="mt-3 text-xs text-gray-500 hover:underline">Desconectar</button>
      )}
      {msg && <p role="status" className={`mt-2 text-sm ${msg.ok ? 'text-positive-700' : 'text-red-600'}`}>{msg.text}</p>}
    </div>
  )
}
