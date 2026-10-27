'use client'

// Juntar cores: cada grupo de cadastros da mesma peça vira uma peça só. A pessoa confere,
// escolhe a principal (fica com o código), o preço (se forem diferentes) e o nome da cor
// de cadastro sem cor ou com cor repetida.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { mergeRetailProducts } from '@/lib/actions/retail-products'
import { colorIssue, nameKey, photosAfter, pickMain, samePrice, type MergeMember } from '@/lib/retail/merge'
import { fmtBRL } from '@/lib/format'

const MAX_PHOTOS = 8
const inp = 'w-full rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-brand-700 focus:outline-none'
const statusLabel: Record<string, string> = { publicado: 'Publicada', rascunho: 'Rascunho', arquivado: 'Arquivada' }
const colorsText = (m: MergeMember) => m.colors.length ? m.colors.map(c => c ?? 'sem cor').join(', ') : 'sem cor'
const priceText = (m: MergeMember) => m.price === null ? 'sem preço' : `${fmtBRL(m.price)}${m.promo_price !== null ? ` (promo ${fmtBRL(m.promo_price)})` : ''}`

export function MergeView({ groups, all }: { groups: MergeMember[][]; all: MergeMember[] }) {
  const [done, setDone] = useState<string[]>([])
  const open = groups.filter(g => !g.some(m => done.includes(m.id)))
  return (
    <div className="space-y-4">
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-900">Sugestões: mesmo nome ({open.length})</h2>
        {open.length === 0
          ? <p className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">Nenhum nome repetido. Se a mesma peça foi cadastrada com nomes um pouco diferentes, use &quot;Juntar outras peças&quot; abaixo.</p>
          : open.map(g => <GroupCard key={g.map(m => m.id).join('-')} group={g} onDone={ids => setDone(d => [...d, ...ids])} />)}
      </section>
      <ManualPick all={all.filter(m => !done.includes(m.id))} onDone={ids => setDone(d => [...d, ...ids])} />
    </div>
  )
}

function GroupCard({ group, onDone }: { group: MergeMember[]; onDone: (ids: string[]) => void }) {
  const router = useRouter()
  const [mainId, setMainId] = useState(pickMain(group).id)
  const same = samePrice(group)
  const [priceFrom, setPriceFrom] = useState<string | null>(null)
  const [renamed, setRenamed] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string; id?: string } | null>(null)
  const main = group.find(m => m.id === mainId) ?? group[0]
  const others = group.filter(m => m.id !== main.id)
  const issues = Object.fromEntries(group.map(m => [m.id, colorIssue(m, group, renamed)]))
  const mainNoColor = issues[main.id] === 'sem cor'
  const missingName = others.filter(m => issues[m.id] === 'sem cor')
  const photos = photosAfter(group)
  const priceOk = same || !!priceFrom
  const finalColors = [...new Set(group.flatMap(m => (m.id !== main.id && renamed[m.id]?.trim() ? [renamed[m.id].trim()] : m.colors.map(c => c ?? 'sem cor'))))]
  const chosenPrice = same ? main : group.find(m => m.id === priceFrom) ?? null
  const blockers = [
    mainNoColor && 'A peça principal está sem cor: escolha outra como principal ou dê nome à cor dela na peça (passo 2).',
    missingName.length > 0 && `Dê o nome da cor de ${missingName.map(m => m.code).join(', ')}.`,
    !priceOk && 'Os preços são diferentes: escolha qual fica.',
    photos > MAX_PHOTOS && `Juntas ficam ${photos} fotos (máximo ${MAX_PHOTOS}). Remova algumas fotos antes.`,
  ].filter(Boolean) as string[]

  async function go() {
    if (!confirm(`Juntar ${group.length} cadastros em ${main.code} · ${main.name}? Os outros códigos deixam de existir como peça (viram variações desta).`)) return
    setBusy(true); setMsg(null)
    const r = await mergeRetailProducts({ mainId: main.id, otherIds: others.map(m => m.id), priceFrom: same ? null : priceFrom, colors: renamed })
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return }
    setMsg({ ok: true, text: 'Pronto: virou uma peça só.', id: r.id })
    onDone(group.map(m => m.id)); router.refresh()
  }

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-sm font-semibold text-gray-900">{group[0].name} <span className="font-normal text-gray-500">· {group.length} cadastros</span></p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="text-left text-xs text-gray-500"><th className="py-1 pr-2">Principal</th><th className="pr-2">Código</th><th className="pr-2">Cor(es)</th><th className="pr-2">Preço</th><th className="pr-2">Estoque</th><th className="pr-2">Fotos</th><th>Situação</th></tr></thead>
          <tbody>
            {group.map(m => (
              <tr key={m.id} className="border-t border-gray-100 align-top">
                <td className="py-2 pr-2"><input type="radio" name={`main-${group[0].id}`} checked={m.id === main.id} onChange={() => { setMainId(m.id); setRenamed(r => { const n = { ...r }; delete n[m.id]; return n }) }} aria-label={`Principal: ${m.code}`} /></td>
                <td className="whitespace-nowrap py-2 pr-2 font-medium text-gray-900">{m.code}</td>
                <td className="py-2 pr-2 text-gray-700">
                  {colorsText(m)}
                  {m.id !== main.id && issues[m.id] && (
                    <div className="mt-1 space-y-0.5">
                      <input className={inp} value={renamed[m.id] ?? ''} onChange={e => setRenamed(r => ({ ...r, [m.id]: e.target.value }))} placeholder={issues[m.id] === 'sem cor' ? 'Nome da cor (obrigatório)' : 'Outro nome de cor (opcional)'} aria-label={`Cor de ${m.code}`} />
                      <p className={`text-[11px] ${issues[m.id] === 'sem cor' ? 'text-warn-700' : 'text-gray-500'}`}>{issues[m.id] === 'sem cor' ? 'Este cadastro está sem cor.' : 'Mesma cor de outro cadastro: deixe vazio para somar o estoque (mesma peça) ou dê outro nome (peça diferente).'}</p>
                    </div>
                  )}
                </td>
                <td className="py-2 pr-2 text-gray-700">
                  {same ? priceText(m) : (
                    <label className="flex items-center gap-1"><input type="radio" name={`price-${group[0].id}`} checked={priceFrom === m.id} onChange={() => setPriceFrom(m.id)} disabled={m.price === null} />{priceText(m)}</label>
                  )}
                </td>
                <td className="py-2 pr-2 tabular-nums text-gray-700">{m.stock} un.</td>
                <td className="py-2 pr-2 tabular-nums text-gray-700">{m.photos}</td>
                <td className="py-2 text-gray-700">{statusLabel[m.status] ?? m.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-lg bg-brand-100/50 px-3 py-2 text-sm text-gray-800">
        <p><strong>Vai ficar:</strong> 1 peça <strong>{main.code}</strong> · {finalColors.length} cor(es): {finalColors.join(', ')} · {chosenPrice ? priceText(chosenPrice) : 'preço a escolher'} · {photos} foto(s){group.some(m => m.status === 'publicado') ? ' · Publicada' : ''}.</p>
        <p className="mt-0.5 text-xs text-gray-600">Estoque, códigos (SKU) e histórico continuam. Cada foto fica marcada com a cor do cadastro de onde veio. Os outros códigos deixam de ser peças e viram variações desta.</p>
      </div>
      {blockers.length > 0 && <ul className="space-y-0.5 rounded-lg bg-warn-100 px-3 py-2 text-xs text-warn-700">{blockers.map(b => <li key={b}>{b}</li>)}</ul>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || blockers.length > 0 || !!msg?.ok} onClick={go} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? 'Juntando…' : 'Juntar em uma peça'}</button>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-positive-700' : 'text-negative-700'}`}>{msg.text} {msg.id && <Link href={`/varejo/produtos/${msg.id}#fotos`} className="text-brand-700 underline">Abrir a peça</Link>}</p>}
      </div>
    </div>
  )
}

// Nomes diferentes (ex.: "Blazer Max Premium" e "Blazer Maxi Premiun"): escolher à mão
function ManualPick({ all, onDone }: { all: MergeMember[]; onDone: (ids: string[]) => void }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string[]>([])
  const term = nameKey(q)
  const found = useMemo(() => term.length < 2 ? [] : all.filter(m => nameKey(m.name).includes(term) || nameKey(m.code).includes(term)).slice(0, 30), [all, term])
  const picked = sel.map(id => all.find(m => m.id === id)).filter((m): m is MergeMember => !!m)
  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-base font-semibold text-gray-900">Juntar outras peças</h2>
      <p className="text-sm text-gray-600">Para a mesma peça cadastrada com nomes diferentes. Busque e marque os cadastros.</p>
      <input className={inp} value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nome ou código (ex.: blazer)" />
      {found.length > 0 && (
        <ul className="max-h-60 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-100">
          {found.map(m => (
            <li key={m.id}><label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm">
              <input type="checkbox" checked={sel.includes(m.id)} onChange={e => setSel(s => e.target.checked ? [...s, m.id].slice(0, 10) : s.filter(x => x !== m.id))} />
              <span className="font-medium text-gray-900">{m.code}</span><span className="text-gray-700">{m.name}</span><span className="text-xs text-gray-500">{colorsText(m)}</span>
            </label></li>
          ))}
        </ul>
      )}
      {picked.length >= 2 && <GroupCard key={sel.join('-')} group={picked} onDone={ids => { onDone(ids); setSel([]) }} />}
      {picked.length === 1 && <p className="text-xs text-gray-500">Marque ao menos mais um cadastro.</p>}
    </section>
  )
}
