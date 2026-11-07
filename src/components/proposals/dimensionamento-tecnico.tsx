// Dimensionamento técnico vindo do Price (mesma conta da aba Metodologia), sem valores.
// A tela muda conforme a base: inventário (FTE), só quantidade (sem FTE), predial (sem FTE).
import { fmtNum1, fmtPct } from '@/lib/format'

export type DimTec = {
  versao: number
  tipo: 'clinica' | 'predial'
  base: 'inventario' | 'quantidade' | 'sem_dados' | 'predial'
  equipamentos: { total: number; fonte: 'inventario' | 'informado' | null; porRegime: { label: string; qtd: number }[] }
  leitos: number
  atendimento: { presenca: 'fixa' | 'sem_fixa' | 'remoto'; equipeVolante: boolean; acreditado: boolean }
  metodologia: null | {
    regimeCobertura: 'comercial' | 'plantao12h' | '24h'
    produtividadePct: number; absenteismoPct: number; hhLiquidoPorProfissional: number
    horasMes: { total: number; residente: number; volante: number; campo: number; laboratorial: number }
    fte: number
    equipeSugerida: { plantonistas: number; diaristas: number; total: number }
    equipeDefinida: { plantonistas: number; diaristas: number; total: number }
    ajusteManual: boolean; ocupacaoPct: number | null
  }
  gestao: { cargo: string; carga: string }[]
  equipeAlocada: { funcao: string; qtd: number; regime: string; jornada: string; gestao: boolean }[]
  equipamentosPorTecnico: number | null
}

const PRESENCA = { fixa: 'Equipe fixa na unidade', sem_fixa: 'Equipe rotativa (sem técnico fixo na unidade)', remoto: 'Atendimento remoto' }
const REGIME = { comercial: 'Horário comercial', plantao12h: 'Plantão 12h', '24h': 'Cobertura 24h' }
const BASE = {
  inventario: 'Calculado pelo inventário (demanda de horas por equipamento)',
  quantidade: 'Sem inventário: só a quantidade de equipamentos. A equipe foi definida pelo engenheiro (sem FTE calculado).',
  sem_dados: 'Sem inventário e sem quantidade de equipamentos informada.',
  predial: 'Engenharia predial: metodologia própria, sem cálculo de FTE.',
}

const n = (v: number) => v.toLocaleString('pt-BR')

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-gray-900">{value}</p>
      {hint && <p className="text-[11px] text-gray-500">{hint}</p>}
    </div>
  )
}

export function DimensionamentoTecnicoView({ d }: { d: DimTec }) {
  const m = d.metodologia
  const tecnicos = d.equipeAlocada.filter(e => !e.gestao).reduce((s, e) => s + e.qtd, 0)
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-brand-700">Base do dimensionamento</h2>
          <p className="mt-0.5 text-sm text-gray-700">{BASE[d.base]}</p>
          <p className="mt-1 text-xs text-gray-500">
            {PRESENCA[d.atendimento.presenca]}{d.atendimento.equipeVolante ? ' · com equipe volante' : ''}{d.atendimento.acreditado ? ' · unidade acreditada' : ''}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {d.tipo === 'clinica' && (
            <Kpi label="Equipamentos" value={d.equipamentos.total > 0 ? n(d.equipamentos.total) : '—'}
              hint={d.equipamentos.fonte === 'inventario' ? 'do inventário' : d.equipamentos.fonte === 'informado' ? 'informado (sem inventário)' : undefined} />
          )}
          {d.leitos > 0 && <Kpi label="Leitos" value={n(d.leitos)} />}
          <Kpi label="Técnicos alocados" value={n(tecnicos)} />
          {m && <Kpi label="FTE calculado" value={fmtNum1(m.fte)} hint={`${fmtNum1(m.horasMes.campo)} h/mês ÷ ${fmtNum1(m.hhLiquidoPorProfissional)} h`} />}
          {!m && d.equipamentosPorTecnico && <Kpi label="Equipamentos por técnico" value={n(d.equipamentosPorTecnico)} />}
        </div>
        {d.equipamentos.porRegime.length > 0 && (
          <p className="text-xs text-gray-500">Por regime: {d.equipamentos.porRegime.map(p => `${p.label} ${n(p.qtd)}`).join(' · ')}</p>
        )}
      </div>

      {m && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
          <h2 className="text-sm font-semibold text-brand-700">Metodologia (como no Price)</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Kpi label="Cobertura" value={REGIME[m.regimeCobertura]} />
            <Kpi label="Demanda" value={`${fmtNum1(m.horasMes.total)} h/mês`} hint={m.horasMes.volante > 0 ? `${fmtNum1(m.horasMes.volante)} h na volante` : undefined} />
            <Kpi label="HH líquido / prof." value={`${fmtNum1(m.hhLiquidoPorProfissional)} h`} hint={`produtividade ${m.produtividadePct}% · faltas ${m.absenteismoPct}%`} />
            <Kpi label="Ocupação da equipe" value={m.ocupacaoPct != null ? fmtPct(m.ocupacaoPct) : '—'} />
          </div>
          <table className="w-full text-xs">
            <thead><tr className="bg-gray-50 text-left text-gray-600"><th className="px-2 py-1.5">Equipe</th><th className="px-2 py-1.5">Plantonistas</th><th className="px-2 py-1.5">Diaristas</th><th className="px-2 py-1.5">Total</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              <tr><td className="px-2 py-1.5">Sugerida pelo cálculo</td><td className="px-2 py-1.5">{m.equipeSugerida.plantonistas}</td><td className="px-2 py-1.5">{m.equipeSugerida.diaristas}</td><td className="px-2 py-1.5 font-semibold">{m.equipeSugerida.total}</td></tr>
              <tr><td className="px-2 py-1.5">Definida na proposta</td><td className="px-2 py-1.5">{m.equipeDefinida.plantonistas}</td><td className="px-2 py-1.5">{m.equipeDefinida.diaristas}</td><td className="px-2 py-1.5 font-semibold">{m.equipeDefinida.total}</td></tr>
            </tbody>
          </table>
          {m.ajusteManual && <p className="text-xs font-medium text-warn-700">A equipe foi ajustada à mão em relação à sugerida pelo cálculo.</p>}
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <h2 className="text-sm font-semibold text-brand-700">Equipe alocada</h2>
        {d.equipeAlocada.length ? (
          <table className="w-full text-xs">
            <thead><tr className="bg-gray-50 text-left text-gray-600"><th className="px-2 py-1.5">Função</th><th className="px-2 py-1.5">Qtd</th><th className="px-2 py-1.5">Jornada</th><th className="px-2 py-1.5">Regime</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {d.equipeAlocada.map((e, i) => (
                <tr key={i}><td className="px-2 py-1.5">{e.funcao}{e.gestao ? ' (gestão)' : ''}</td><td className="px-2 py-1.5">{e.qtd}</td><td className="px-2 py-1.5">{e.jornada}</td><td className="px-2 py-1.5">{e.regime}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-sm text-gray-400">Nenhum profissional na proposta.</p>}
        {d.gestao.length > 0 && d.tipo === 'clinica' && (
          <p className="text-xs text-gray-500">Gestão recomendada pela metodologia: {d.gestao.map(g => `${g.cargo} (${g.carga})`).join(' · ')}</p>
        )}
      </div>
    </div>
  )
}
