'use client'

// Nova campanha: nome, público e (opcional) quanto vai investir. O resto vem pronto.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveRetailCampaign } from '@/lib/actions/retail-campaigns'
import { AUDIENCES, type Audience } from '@/lib/retail/campaigns'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none'
const lbl = 'mb-1 block text-xs font-medium text-gray-600'
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

export function CampaignNew({ categories }: { categories: string[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [audience, setAudience] = useState<Audience>('aniversariantes')
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [days, setDays] = useState('90')
  const [category, setCategory] = useState(categories[0] ?? '')
  const [top, setTop] = useState('20')
  const [investment, setInvestment] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function create() {
    setBusy(true); setErr(null)
    const params = audience === 'aniversariantes' ? { month } : audience === 'inativas' ? { days: Number(days) } : audience === 'categoria' ? { category } : audience === 'melhores' ? { top: Number(top) } : {}
    const r = await saveRetailCampaign({ name, audience, params, investment })
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    router.push(`/varejo/campanhas/${r.id}`)
  }
  if (!open) return <button type="button" onClick={() => { setOpen(true); if (!name) setName(audience === 'aniversariantes' ? `Aniversariantes de ${MONTHS[month - 1]}` : '') }} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800">Nova campanha</button>
  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">Nova campanha</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><label className={lbl} htmlFor="c-name">Nome</label><input id="c-name" className={inp} value={name} onChange={e => setName(e.target.value)} placeholder="ex.: Dia das Mães" /></div>
        <div><label className={lbl} htmlFor="c-aud">Para quem</label>
          <select id="c-aud" className={inp} value={audience} onChange={e => setAudience(e.target.value as Audience)}>{AUDIENCES.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
          <p className="mt-1 text-[11px] text-gray-500">{AUDIENCES.find(a => a.id === audience)?.help}</p></div>
        {audience === 'aniversariantes' && <div><label className={lbl} htmlFor="c-month">Mês</label><select id="c-month" className={inp} value={month} onChange={e => setMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></div>}
        {audience === 'inativas' && <div><label className={lbl} htmlFor="c-days">Sem comprar há mais de (dias)</label><input id="c-days" className={inp} inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} /></div>}
        {audience === 'categoria' && <div><label className={lbl} htmlFor="c-cat">Categoria</label><select id="c-cat" className={inp} value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select></div>}
        {audience === 'melhores' && <div><label className={lbl} htmlFor="c-top">Quantas clientes</label><input id="c-top" className={inp} inputMode="numeric" value={top} onChange={e => setTop(e.target.value)} /></div>}
        <div><label className={lbl} htmlFor="c-inv">Quanto vai investir (opcional)</label><input id="c-inv" className={inp} inputMode="decimal" value={investment} onChange={e => setInvestment(e.target.value)} placeholder="ex.: 300,00 (anúncio, brinde, desconto)" /></div>
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={busy || !name.trim()} onClick={create} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? 'Criando…' : 'Criar e ver as clientes'}</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700">Cancelar</button>
      </div>
      {err && <p role="alert" className="text-sm text-negative-700">{err}</p>}
    </section>
  )
}
