'use client'

// Editar empresa em abas: Dados, Outros dados e Pessoas.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { saveCompanyEdit, saveCompanyContact, deleteContact, type CompanyEditInput } from '@/lib/actions/companies'
import { CnpjLookupField } from '@/components/companies/cnpj-lookup-field'
import { segmentOf } from '@/lib/companies/settings'

type Contact = { id: string; name: string; role: string | null; email: string | null; phone: string | null; is_primary: boolean }
type Company = Record<string, unknown> & { id: string; name: string }

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none'
const lbl = 'mb-1 block text-xs font-semibold text-gray-700'
const STATUS = [
  { value: 'lead', label: 'Lead' }, { value: 'prospect', label: 'Prospect' }, { value: 'cliente_ativo', label: 'Cliente ativo' },
  { value: 'cliente_inativo', label: 'Cliente inativo' }, { value: 'nao_qualificado', label: 'Não qualificado' },
]
const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ')

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v))

export function EditCompanyForm({ company, contacts, segments, people, isAdmin }: {
  company: Company; contacts: Contact[]; segments: string[]; people: { id: string; name: string }[]; isAdmin: boolean
}) {
  const router = useRouter()
  const [tab, setTab] = useState<'dados' | 'outros' | 'pessoas'>('dados')
  const currentSeg = segmentOf(str(company.segment) || null)
  const segOptions = currentSeg && !segments.includes(currentSeg) ? [...segments, currentSeg] : segments
  const [f, setF] = useState<CompanyEditInput>({
    name: str(company.name), trade_name: str(company.trade_name), cnpj: str(company.cnpj), segment: currentSeg ?? '',
    status: str(company.status) || 'lead', account_owner_id: str(company.account_owner_id), phone: str(company.phone), email: str(company.email),
    company_size: str(company.company_size), zip_code: str(company.zip_code), street: str(company.street), street_number: str(company.street_number),
    neighborhood: str(company.neighborhood), city: str(company.city), state: str(company.state),
    capital_social: company.capital_social ? Number(company.capital_social).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '',
    main_activity: str(company.main_activity), notes: str(company.notes),
  })
  const set = (k: keyof CompanyEditInput, v: string) => { setMsg(null); setF(x => ({ ...x, [k]: v })) }
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function save() {
    setSaving(true); setMsg(null)
    const r = await saveCompanyEdit(company.id, f)
    setSaving(false)
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return }
    setMsg({ ok: true, text: 'Empresa salva.' })
    router.refresh()
  }

  const tabs = [{ k: 'dados', l: 'Dados' }, { k: 'outros', l: 'Outros dados' }, { k: 'pessoas', l: `Pessoas (${contacts.length})` }] as const

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        {tabs.map(t => (
          <button key={t.k} type="button" onClick={() => setTab(t.k)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === t.k ? 'border-brand-700 font-semibold text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>{t.l}</button>
        ))}
      </div>

      {tab === 'dados' && (
        <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
          <CnpjLookupField defaultValue={f.cnpj} onChange={v => set('cnpj', v)} onFound={d => {
            setF(x => ({
              ...x, name: d.razaoSocial || x.name, trade_name: d.nomeFantasia ?? x.trade_name,
              city: d.municipio ?? x.city, state: d.uf ?? x.state, street: d.logradouro ?? x.street, street_number: d.numero ?? x.street_number,
              neighborhood: d.bairro ?? x.neighborhood, zip_code: d.cep ?? x.zip_code, phone: x.phone || d.telefone || '', email: x.email || d.email || '',
              main_activity: d.cnaeDescricao ?? x.main_activity, capital_social: d.capitalSocial ? Number(d.capitalSocial).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : x.capital_social,
            }))
          }} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className={lbl}>Razão social *</span><input className={input} value={f.name} onChange={e => set('name', e.target.value)} /></label>
            <label className="block"><span className={lbl}>Nome fantasia</span><input className={input} value={f.trade_name} onChange={e => set('trade_name', e.target.value)} /></label>
            <label className="block"><span className={lbl}>Segmento *</span>
              <select className={input} value={f.segment} onChange={e => set('segment', e.target.value)}>
                <option value="">Selecione…</option>{segOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select></label>
            <label className="block"><span className={lbl}>Status</span>
              <select className={input} value={f.status} onChange={e => set('status', e.target.value)}>{STATUS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
            <label className="block"><span className={lbl}>Responsável pela conta</span>
              <select className={input} value={f.account_owner_id} onChange={e => set('account_owner_id', e.target.value)}>
                <option value="">Não informado</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>
            <label className="block"><span className={lbl}>Porte</span><input className={input} value={f.company_size} onChange={e => set('company_size', e.target.value)} placeholder="Ex.: Micro empresa, Médio porte" /></label>
            <label className="block"><span className={lbl}>Telefone da empresa</span><input className={input} value={f.phone} onChange={e => set('phone', e.target.value)} /></label>
            <label className="block"><span className={lbl}>E-mail da empresa</span><input className={input} type="email" value={f.email} onChange={e => set('email', e.target.value)} /></label>
          </div>
        </div>
      )}

      {tab === 'outros' && (
        <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_120px_160px]">
            <label className="block"><span className={lbl}>Logradouro</span><input className={input} value={f.street} onChange={e => set('street', e.target.value)} /></label>
            <label className="block"><span className={lbl}>Número</span><input className={input} value={f.street_number} onChange={e => set('street_number', e.target.value)} /></label>
            <label className="block"><span className={lbl}>CEP</span><input className={input} value={f.zip_code} onChange={e => set('zip_code', e.target.value)} /></label>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_100px]">
            <label className="block"><span className={lbl}>Bairro</span><input className={input} value={f.neighborhood} onChange={e => set('neighborhood', e.target.value)} /></label>
            <label className="block"><span className={lbl}>Cidade</span><input className={input} value={f.city} onChange={e => set('city', e.target.value)} /></label>
            <label className="block"><span className={lbl}>UF</span>
              <select className={input} value={f.state} onChange={e => set('state', e.target.value)}><option value="">—</option>{UFS.map(u => <option key={u}>{u}</option>)}</select></label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className={lbl}>Capital social (R$)</span><input className={input} value={f.capital_social} onChange={e => set('capital_social', e.target.value)} inputMode="decimal" /></label>
            <label className="block"><span className={lbl}>Atividade principal (CNAE)</span><input className={input} value={f.main_activity} onChange={e => set('main_activity', e.target.value)} /></label>
          </div>
          <label className="block"><span className={lbl}>Observações</span><textarea className={`${input} min-h-[90px]`} value={f.notes} onChange={e => set('notes', e.target.value)} /></label>
        </div>
      )}

      {tab === 'pessoas' && <PeopleTab companyId={company.id} contacts={contacts} isAdmin={isAdmin} />}

      {tab !== 'pessoas' && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-brand-700 px-5 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{saving ? 'Salvando…' : 'Salvar'}</button>
          <Link href={`/companies/${company.id}`} className="text-sm text-gray-500 hover:underline">Voltar para a empresa</Link>
          {msg && <span className={`text-sm ${msg.ok ? 'text-positive-700' : 'text-negative-700'}`}>{msg.text}</span>}
        </div>
      )}
    </div>
  )
}

function PeopleTab({ companyId, contacts, isAdmin }: { companyId: string; contacts: Contact[]; isAdmin: boolean }) {
  const router = useRouter()
  const blank = { id: null as string | null, name: '', role: '', email: '', phone: '', is_primary: false }
  const [editing, setEditing] = useState<typeof blank | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState<Contact | null>(null)

  async function save() {
    if (!editing) return
    setBusy(true); setError(null)
    const r = await saveCompanyContact(companyId, editing)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setEditing(null); router.refresh()
  }
  async function remove(c: Contact) {
    setBusy(true); setError(null)
    const r = await deleteContact(c.id, companyId)
    setBusy(false); setConfirmDel(null)
    if (r.error) setError(r.error); else router.refresh()
  }

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex justify-end">
        <button type="button" onClick={() => setEditing({ ...blank })} className="inline-flex items-center gap-1 rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800"><Plus className="h-4 w-4" /> Pessoa</button>
      </div>
      {editing && (
        <div className="grid gap-2 rounded-lg border border-brand-700/30 bg-brand-100/40 p-3 sm:grid-cols-2">
          <label className="block"><span className={lbl}>Nome *</span><input className={input} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} autoFocus /></label>
          <label className="block"><span className={lbl}>Cargo na empresa</span><input className={input} value={editing.role} onChange={e => setEditing({ ...editing, role: e.target.value })} /></label>
          <label className="block"><span className={lbl}>E-mail</span><input className={input} type="email" value={editing.email} onChange={e => setEditing({ ...editing, email: e.target.value })} /></label>
          <label className="block"><span className={lbl}>Telefone / WhatsApp</span><input className={input} value={editing.phone} onChange={e => setEditing({ ...editing, phone: e.target.value })} /></label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={editing.is_primary} onChange={e => setEditing({ ...editing, is_primary: e.target.checked })} /> Contato principal (usado nos avisos por e-mail e WhatsApp)</label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" disabled={busy} onClick={save} className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar pessoa'}</button>
            <button type="button" onClick={() => setEditing(null)} className="px-2 text-xs text-gray-500">Cancelar</button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-negative-700">{error}</p>}
      {contacts.length === 0 ? <p className="text-sm text-gray-400">Nenhuma pessoa cadastrada.</p> : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase text-gray-500"><tr><th className="py-2 pr-3">Nome</th><th className="py-2 pr-3">E-mail</th><th className="py-2 pr-3">Telefone</th><th className="py-2 pr-3">Cargo</th><th className="py-2 pr-3">Principal</th><th className="py-2 text-right">Ações</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {contacts.map(c => (
                <tr key={c.id}>
                  <td className="py-2 pr-3 font-medium text-gray-900">{c.name}</td>
                  <td className="py-2 pr-3 text-gray-600">{c.email ?? '—'}</td>
                  <td className="py-2 pr-3 text-gray-600">{c.phone ?? '—'}</td>
                  <td className="py-2 pr-3 text-gray-600">{c.role ?? '—'}</td>
                  <td className="py-2 pr-3 text-gray-600">{c.is_primary ? 'Sim' : 'Não'}</td>
                  <td className="py-2 text-right">
                    <button type="button" onClick={() => setEditing({ id: c.id, name: c.name, role: c.role ?? '', email: c.email ?? '', phone: c.phone ?? '', is_primary: c.is_primary })} className="mr-2 text-xs font-medium text-brand-700 hover:underline">Editar</button>
                    {isAdmin && <button type="button" onClick={() => setConfirmDel(c)} className="text-xs text-gray-400 hover:text-negative-700">Remover</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {confirmDel && (
        <div role="dialog" aria-modal="true" onClick={() => setConfirmDel(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <p className="text-base font-semibold text-gray-900">Tem certeza que quer remover {confirmDel.name}?</p>
            <p className="mt-2 text-sm text-gray-600">A pessoa sai da empresa e das oportunidades em que está como contato. Não dá para desfazer.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDel(null)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">Cancelar</button>
              <button type="button" disabled={busy} onClick={() => remove(confirmDel)} className="rounded-lg bg-negative-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Sim, remover</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
