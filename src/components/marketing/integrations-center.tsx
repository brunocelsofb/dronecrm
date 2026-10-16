'use client'

// Central de integrações (Marketing → Integrações): por categoria, cada
// ferramenta com o endereço próprio, o passo a passo e o código pronto.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { INTEGRATIONS, CATEGORY_LABEL, type IntegrationCategory, type IntegrationDef } from '@/lib/marketing/integrations'
import { activateIntegration, setIntegrationActive, rotateIntegrationKey, saveIntegrationSettings } from '@/lib/actions/integrations'
import { ToolConnect, type ToolsStatus } from './tool-connect'

export type IntegrationRow = {
  id: string; kind: string; name: string; key: string; active: boolean
  settings: Record<string, unknown> | null; received_count: number; last_received_at: string | null; last_error: string | null
}

const ICON: Record<string, string> = {
  meta_lead_ads: 'f', linkedin_lead_forms: 'in', google_ads_form: 'G', rd_station: 'RD', mailchimp: 'M',
  site: '</>', wordpress: 'W', google_forms: '≡', whatsapp_button: '✆', zapier: '⇄',
}
const brDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—')

export function IntegrationsCenter({ rows, campaigns, baseUrl, tools }: { rows: IntegrationRow[]; campaigns: { id: string; name: string; status: string }[]; baseUrl: string; tools: ToolsStatus }) {
  const [cat, setCat] = useState<IntegrationCategory>('ads')
  const [open, setOpen] = useState<string | null>(null)
  const byKind = new Map(rows.map(r => [r.kind, r]))
  const list = INTEGRATIONS.filter(i => i.category === cat)
  const def = open ? INTEGRATIONS.find(i => i.kind === open) ?? null : null

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-500">
        Cada ferramenta ganha um <strong>endereço próprio</strong> para mandar leads ao CRM. O lead entra com a origem, a campanha e o histórico.
        Se a mesma pessoa converter de novo, o CRM não duplica: registra a nova conversão no lead.
      </p>
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Categorias">
          {(Object.keys(CATEGORY_LABEL) as IntegrationCategory[]).map(c => (
            <button key={c} onClick={() => { setCat(c); setOpen(null) }}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm ${cat === c ? 'bg-positive-100 font-medium text-positive-700' : 'text-gray-600 hover:bg-gray-100'}`}>
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map(i => {
              const row = byKind.get(i.kind)
              return (
                <button key={i.kind} onClick={() => setOpen(open === i.kind ? null : i.kind)}
                  className={`flex items-start gap-3 rounded-2xl border bg-white p-4 text-left transition-colors hover:border-brand-700/50 ${open === i.kind ? 'border-brand-700' : 'border-gray-200'}`}>
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-sm font-bold text-white">{ICON[i.kind]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-gray-900">{i.name}</span>
                    <span className="block text-xs text-gray-500">{i.short}</span>
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${row?.active ? 'bg-positive-100 text-positive-700' : row ? 'bg-gray-100 text-gray-500' : 'bg-gray-100 text-gray-600'}`}>
                        {row?.active ? `Ativa · ${row.received_count} recebido(s)` : row ? 'Desativada' : 'Não configurada'}
                      </span>
                      {i.how === 'ponte' && <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] text-brand-800">via Zapier/Make</span>}
                      {((i.kind === 'mailchimp' && tools.mailchimp) || (i.kind === 'rd_station' && tools.rd_station)) && <span className="rounded-full bg-positive-100 px-2 py-0.5 text-[10px] text-positive-700">Envio de listas conectado</span>}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
          {def && <Detail key={def.kind} def={def} row={byKind.get(def.kind) ?? null} campaigns={campaigns} baseUrl={baseUrl} tools={tools} />}
        </div>
      </div>
    </div>
  )
}

function Detail({ def, row, campaigns, baseUrl, tools }: { def: IntegrationDef; row: IntegrationRow | null; campaigns: { id: string; name: string; status: string }[]; baseUrl: string; tools: ToolsStatus }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const s = row?.settings ?? {}
  const [campaignId, setCampaignId] = useState(typeof s.campaign_id === 'string' ? s.campaign_id : '')
  const [phone, setPhone] = useState(typeof s.phone === 'string' ? s.phone : '')
  const [waMsg, setWaMsg] = useState(typeof s.message === 'string' ? s.message : 'Olá! Vim pelo site e gostaria de falar com vocês.')
  const url = row ? `${baseUrl}/api/integracoes/${row.key}` : ''

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => start(async () => {
    const r = await fn()
    setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? 'Não foi possível.' })
    if (r.ok) router.refresh()
  })
  const copy = async (id: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 1500) } catch { setCopied(null) }
  }

  const snippet = row ? snippetFor(def.kind, url, typeof s.phone === 'string' ? s.phone : '', typeof s.message === 'string' ? s.message : '') : ''

  return (
    <section className="min-w-0 rounded-2xl border border-brand-700/30 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{def.name}</h3>
          <p className="text-sm text-gray-500">{def.short}</p>
        </div>
        {!row && (
          <button disabled={pending} onClick={() => run(() => activateIntegration(def.kind), 'Integração ativada. Siga o passo a passo.')}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">Ativar e gerar endereço</button>
        )}
        {row && (
          <div className="flex items-center gap-3 text-xs">
            <button disabled={pending} onClick={() => run(() => setIntegrationActive(row.id, !row.active), row.active ? 'Desativada: o endereço deixa de receber.' : 'Ativada.')}
              className="text-brand-700 hover:underline">{row.active ? 'Desativar' : 'Ativar'}</button>
            <button disabled={pending} onClick={() => { if (window.confirm('Gerar um novo endereço? O antigo para de funcionar e precisa ser trocado na ferramenta.')) run(() => rotateIntegrationKey(row.id), 'Novo endereço gerado. Troque na ferramenta.') }}
              className="text-gray-500 hover:underline">Gerar novo endereço</button>
          </div>
        )}
      </div>

      {row && (
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          <Info label="Situação" value={row.active ? 'Ativa' : 'Desativada'} />
          <Info label="Leads recebidos" value={String(row.received_count)} />
          <Info label="Último recebido" value={brDateTime(row.last_received_at)} />
        </div>
      )}
      {row?.last_error && <p className="mt-2 rounded-lg bg-negative-100 px-3 py-2 text-xs text-negative-700">Último problema: {row.last_error}</p>}

      <ol className="mt-4 space-y-1.5 text-sm text-gray-700">
        {def.steps.map((st, i) => (
          <li key={i} className="flex gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-medium text-gray-600">{i + 1}</span>
            <span>{st.includes('{url}') ? <>{st.split('{url}')[0]}<code className="break-all rounded bg-gray-100 px-1 text-[12px]">{row ? url : '(ative para gerar o endereço)'}</code>{st.split('{url}')[1]}</> : st}</span>
          </li>
        ))}
      </ol>
      {def.note && <p className="mt-2 text-xs text-gray-500">ℹ️ {def.note}</p>}

      {row && (
        <div className="mt-4 flex flex-col gap-3">
          <CopyBox id="url" label="Endereço desta integração" text={url} copied={copied} onCopy={copy} />

          {def.kind === 'whatsapp_button' && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-medium text-gray-700">WhatsApp (com DDD)
                <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="11 99999-9999" className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
              </label>
              <label className="text-xs font-medium text-gray-700">Mensagem inicial
                <input value={waMsg} onChange={e => setWaMsg(e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
              </label>
            </div>
          )}
          <label className="text-xs font-medium text-gray-700">Campanha padrão (para leads que chegam sem código de campanha)
            <select value={campaignId} onChange={e => setCampaignId(e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm">
              <option value="">Nenhuma — usar só o código que vier no link</option>
              {campaigns.filter(c => c.status !== 'encerrada' || c.id === campaignId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div>
            <button disabled={pending} onClick={() => run(() => saveIntegrationSettings(row.id, { campaign_id: campaignId || null, ...(def.kind === 'whatsapp_button' ? { phone, message: waMsg } : {}) }), 'Salvo.')}
              className="rounded-md border border-brand-700 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50">Salvar ajustes</button>
          </div>

          {snippet && (def.kind !== 'whatsapp_button' || typeof s.phone === 'string') && (
            <CopyBox id="code" label={def.kind === 'google_forms' ? 'Código para o Apps Script do formulário' : def.kind === 'whatsapp_button' ? 'Código do botão para colar no site' : 'Código do formulário para o site'} text={snippet} copied={copied} onCopy={copy} multiline />
          )}
          {def.kind === 'whatsapp_button' && typeof s.phone !== 'string' && <p className="text-xs text-gray-500">Salve o número do WhatsApp para gerar o código do botão.</p>}
        </div>
      )}
      {msg && <p role="status" className={`mt-3 text-sm ${msg.ok ? 'text-positive-700' : 'text-red-600'}`}>{msg.text}</p>}
      {(def.kind === 'mailchimp' || def.kind === 'rd_station') && <ToolConnect provider={def.kind} status={tools} />}
    </section>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="font-medium text-gray-900">{value}</p>
    </div>
  )
}

function CopyBox({ id, label, text, copied, onCopy, multiline }: { id: string; label: string; text: string; copied: string | null; onCopy: (id: string, t: string) => void; multiline?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        <button onClick={() => onCopy(id, text)} className="text-xs text-brand-700 hover:underline">{copied === id ? 'Copiado ✓' : 'Copiar'}</button>
      </div>
      {multiline
        ? <pre className="mt-1 max-h-72 overflow-auto rounded-lg bg-gray-900 p-3 text-[11px] leading-relaxed text-gray-100">{text}</pre>
        : <p className="mt-1 break-all rounded-lg bg-gray-50 px-2.5 py-2 font-mono text-[11px] text-gray-800">{text}</p>}
    </div>
  )
}

const ORIGIN_JS = `var q = new URLSearchParams(location.search);
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid'].forEach(function (k) { if (q.get(k)) d[k] = q.get(k); });
    d.landing_page = location.href; d.referrer = document.referrer;`

function snippetFor(kind: string, url: string, phone: string, message: string): string {
  if (kind === 'google_forms') {
    return `// Envia cada resposta deste formulário para o CRM
function onFormSubmit(e) {
  var dados = {};
  e.response.getItemResponses().forEach(function (r) {
    var v = r.getResponse();
    dados[r.getItem().getTitle()] = Array.isArray(v) ? v.join(', ') : String(v);
  });
  var email = e.response.getRespondentEmail();
  if (email) dados.email = email;
  UrlFetchApp.fetch('${url}', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(dados), muteHttpExceptions: true
  });
}`
  }
  if (kind === 'site' || kind === 'wordpress') {
    return `<form id="crm-lead-form">
  <input name="name" placeholder="Nome" required>
  <input name="email" type="email" placeholder="E-mail">
  <input name="phone" placeholder="Telefone">
  <input name="company_name" placeholder="Empresa">
  <input name="cnpj" placeholder="CNPJ">
  <textarea name="message" placeholder="Como podemos ajudar?"></textarea>
  <div style="position:absolute;left:-10000px" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div>
  <button type="submit">Enviar</button>
  <p id="crm-lead-ok" style="display:none">Recebido! Em breve falamos com você.</p>
</form>
<script>
  document.getElementById('crm-lead-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target, d = {};
    new FormData(f).forEach(function (v, k) { d[k] = v; });
    ${ORIGIN_JS}
    fetch('${url}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) })
      .then(function () { f.reset(); document.getElementById('crm-lead-ok').style.display = 'block'; });
  });
</script>`
  }
  if (kind === 'whatsapp_button' && phone) {
    const wa = `https://wa.me/${phone}${message ? `?text=${encodeURIComponent(message)}` : ''}`
    return `<script>
(function () {
  var URL_CRM = '${url}', WA = '${wa}';
  var b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', 'Falar no WhatsApp');
  b.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:99999;width:56px;height:56px;border-radius:50%;border:0;background:#32AF9D;color:#fff;font-size:24px;box-shadow:0 4px 12px rgba(0,0,0,.25);cursor:pointer';
  b.innerHTML = '&#9990;';
  var p = document.createElement('form');
  p.style.cssText = 'position:fixed;right:20px;bottom:86px;z-index:99999;width:280px;max-width:calc(100vw - 40px);background:#fff;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.2);padding:14px;font:14px sans-serif;display:none';
  p.innerHTML = '<p style="margin:0 0 8px;font-weight:600;color:#1B556B">Fale com a gente no WhatsApp</p>' +
    [['name','Nome'],['company_name','Empresa'],['phone','Seu WhatsApp']].map(function (f) {
      return '<input name="' + f[0] + '" placeholder="' + f[1] + '" required style="width:100%;box-sizing:border-box;margin:0 0 6px;padding:8px;border:1px solid #ccc;border-radius:6px">';
    }).join('') +
    '<button style="width:100%;padding:9px;border:0;border-radius:6px;background:#32AF9D;color:#fff;font-weight:600;cursor:pointer">Abrir WhatsApp</button>';
  b.onclick = function () { p.style.display = p.style.display === 'none' ? 'block' : 'none'; };
  p.onsubmit = function (e) {
    e.preventDefault();
    var d = {}; new FormData(p).forEach(function (v, k) { d[k] = v; });
    ${ORIGIN_JS}
    fetch(URL_CRM, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d), keepalive: true }).catch(function () {});
    window.open(WA, '_blank');
    p.reset(); p.style.display = 'none';
  };
  document.body.appendChild(p); document.body.appendChild(b);
})();
</script>`
  }
  return ''
}
