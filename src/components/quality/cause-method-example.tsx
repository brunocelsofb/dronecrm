// Exemplo preenchido de um método de análise de causa (5 Porquês, Ishikawa ou só a causa raiz)
import { CAUSE_METHODS, type CauseMethod } from '@/lib/quality/action-plan'

export function CauseMethodExample({ method }: { method: CauseMethod }) {
  const m = CAUSE_METHODS[method]
  const ex = m.example
  return (
    <div className="space-y-2 rounded-lg border border-accent-sky/60 bg-accent-sky/10 p-3 text-xs text-gray-700">
      <p><span className="font-semibold text-brand-700">Exemplo · problema:</span> {ex.problem}</p>
      {ex.whys && (
        <ol className="space-y-0.5 pl-1">
          {ex.whys.map((w, i) => <li key={i}><span className="font-medium text-gray-500">{i + 1}º</span> {w}</li>)}
        </ol>
      )}
      {ex.ishikawa && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {ex.ishikawa.map(c => (
            <div key={c.category} className="rounded-md bg-white p-2">
              <p className="font-semibold text-gray-800">{c.category}</p>
              <ul className="list-disc pl-4">{c.causes.map(x => <li key={x}>{x}</li>)}</ul>
            </div>
          ))}
        </div>
      )}
      <p><span className="font-semibold text-brand-700">Causa raiz:</span> {ex.root}</p>
    </div>
  )
}
