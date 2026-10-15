'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const REGIOES = ['Norte', 'Centro-Oeste', 'Sudeste', 'Sul', 'Nordeste']
const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']
const ESFERAS = ['Pública Federal','Pública Estadual','Pública Municipal','Privado','Privado sem fins lucrativos']
const SEGMENTOS = ['Grupo Hospitalar (Geral e especializado)','Grupo Diagnóstico (imagem e laboratório)','Grupo Clínicas e Outros (Prestadores de Serviço / Comércio)']

// Mapa UF → Região para preenchimento automático
const UF_REGIAO: Record<string, string> = {
  AC:'Norte',AM:'Norte',AP:'Norte',PA:'Norte',RO:'Norte',RR:'Norte',TO:'Norte',
  AL:'Nordeste',BA:'Nordeste',CE:'Nordeste',MA:'Nordeste',PB:'Nordeste',PE:'Nordeste',PI:'Nordeste',RN:'Nordeste',SE:'Nordeste',
  DF:'Centro-Oeste',GO:'Centro-Oeste',MS:'Centro-Oeste',MT:'Centro-Oeste',
  ES:'Sudeste',MG:'Sudeste',RJ:'Sudeste',SP:'Sudeste',
  PR:'Sul',RS:'Sul',SC:'Sul',
}

type AbcConfig = {
  billing_tier1_max: number
  billing_tier2_max: number
  curve_a_min: number
  curve_b_min: number
}

function calcABC(fat: number, vis: number, fid: number, cfg: AbcConfig): { weight: number; curve: 'A' | 'B' | 'C' | null } {
  if (!fat || !vis || !fid) return { weight: 0, curve: null }
  const w = fat * 0.5 + vis * 0.3 + fid * 0.2
  const weight = Math.round(w * 100) / 100
  const curve = weight >= cfg.curve_a_min ? 'A' : weight >= cfg.curve_b_min ? 'B' : 'C'
  return { weight, curve }
}

type PortfolioData = {
  contract_number?: string | null
  sankhya_code?: string | null
  cnpj_billing?: string | null
  contract_type?: string | null
  monthly_value?: number | null
  validity_months?: number | null
  valid_until?: string | null
  valid_from?: string | null
  engineer_name?: string | null
  coordinator_name?: string | null
  abc_curve?: string | null
  sphere?: string | null
  segment?: string | null
  economic_group?: string | null
  nature?: string | null
  region?: string | null
  uf?: string | null
  score_billing?: number | null
  score_visit?: number | null
  score_loyalty?: number | null
  score_weight?: number | null
  has_measurement?: boolean
  has_audit?: boolean
  has_parts?: boolean
  team_type?: string | null
  municipality?: string | null
  state?: string | null
  internal_notes?: string | null
}

function MultiSelect({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  function toggle(opt: string) {
    onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt])
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
      {options.map(opt => (
        <button key={opt} type="button" onClick={() => toggle(opt)}
          style={{ padding: '4px 10px', fontSize: 11, borderRadius: 20, border: '0.5px solid', cursor: 'pointer',
            borderColor: value.includes(opt) ? '#1a1f36' : '#d1d8e8',
            background: value.includes(opt) ? '#1a1f36' : '#fff',
            color: value.includes(opt) ? '#fff' : '#52514e' }}>
          {opt}
        </button>
      ))}
    </div>
  )
}

export function PortfolioFieldsForm({ contractId, initial, contractNature, companyCity, companyState, abcConfig, tags, currentTagId, activeFields, wonDate }: {
  contractId: string
  initial: PortfolioData
  contractNature?: string | null
  companyCity?: string | null
  companyState?: string | null
  abcConfig?: { clinica?: AbcConfig | null; hospitalar?: AbcConfig | null } | null
  tags?: { id: string; name: string; color: string }[]
  currentTagId?: string | null
  activeFields?: string[] | null
  wonDate?: string | null  // YYYY-MM-DD da data de ganho do funil
}) {
  const show = (key: string) => !activeFields || activeFields.includes(key)
  const router = useRouter()
  const [tagId, setTagId] = useState(currentTagId ?? '')
  const [data, setData] = useState<PortfolioData>(() => ({
    ...initial,
    // Herda valid_from da data de ganho se não preenchido
    valid_from: initial.valid_from || wonDate || null,
    municipality: initial.municipality || companyCity || null,
    uf: initial.uf || (companyState ? JSON.stringify([companyState]) : null),
    region: initial.region || (companyState && UF_REGIAO[companyState] ? JSON.stringify([UF_REGIAO[companyState]]) : null),
  }))

  // Calcula vencimento automaticamente ao mudar início ou meses
  useEffect(() => {
    if (!data.valid_from || !data.validity_months) return
    const start = new Date(data.valid_from + 'T12:00:00') // meio-dia evita problemas de timezone
    start.setMonth(start.getMonth() + Number(data.validity_months))
    const yyyy = start.getFullYear()
    const mm = String(start.getMonth() + 1).padStart(2, '0')
    const dd = String(start.getDate()).padStart(2, '0')
    const calculated = `${yyyy}-${mm}-${dd}`
    if (calculated !== data.valid_until) {
      setData(prev => ({ ...prev, valid_until: calculated }))
    }
  }, [data.valid_from, data.validity_months])
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fatNota, setFatNota] = useState<number>(Number(initial.score_billing) || 0)
  const [visNota, setVisNota] = useState<number>(Number(initial.score_visit) || 0)
  const [fidNota, setFidNota] = useState<number>(Number(initial.score_loyalty) || 0)

  // Calcula fidelidade automaticamente pela data de início do contrato
  function calcFidelidadeByDate(startDate: string): number {
    if (!startDate) return 0
    const years = (Date.now() - new Date(startDate).getTime()) / (365.25 * 24 * 3600 * 1000)
    if (years >= 2) return 3
    if (years >= 1) return 2
    return 1
  }

  const isHospitalar = (data.nature ?? contractNature ?? '').includes('hospitalar')

  // Configurações da curva ABC — usa do banco ou hardcoded como fallback
  const cfgClinica: AbcConfig = abcConfig?.clinica ?? { billing_tier1_max: 20000, billing_tier2_max: 60000, curve_a_min: 2.40, curve_b_min: 1.60 }
  const cfgHospitalar: AbcConfig = abcConfig?.hospitalar ?? { billing_tier1_max: 50000, billing_tier2_max: 150000, curve_a_min: 2.40, curve_b_min: 1.60 }
  const cfg = isHospitalar ? cfgHospitalar : cfgClinica

  // Opções de faturamento dinâmicas conforme configuração
  const fatOptions = [
    { value: 1, label: `Até ${fmt(cfg.billing_tier1_max)}` },
    { value: 2, label: `${fmt(cfg.billing_tier1_max + 1)} – ${fmt(cfg.billing_tier2_max)}` },
    { value: 3, label: `Acima de ${fmt(cfg.billing_tier2_max)}` },
  ]

  const { weight, curve } = calcABC(fatNota, visNota, fidNota, cfg)

  useEffect(() => {
    if (curve) setData(prev => ({ ...prev, score_weight: weight, abc_curve: curve }))
  }, [weight, curve])

  function set(key: keyof PortfolioData, value: any) { setData(prev => ({ ...prev, [key]: value })); setSaved(false) }
  function parseMulti(val: string | null | undefined): string[] {
    if (!val) return []; try { return JSON.parse(val) } catch { return [val] }
  }
  function toMulti(arr: string[]): string { return JSON.stringify(arr) }

  // Quando UF muda, atualiza região automaticamente
  function handleUfChange(ufArr: string[]) {
    set('uf', toMulti(ufArr))
    const regioes = [...new Set(ufArr.map(u => UF_REGIAO[u]).filter(Boolean))]
    if (regioes.length > 0) set('region', toMulti(regioes))
  }

  async function handleSave() {
    setBusy(true); setSaved(false); setError(null)
    try {
      const res = await fetch(`/api/carteira/${contractId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, score_billing: fatNota || data.score_billing, score_visit: visNota || data.score_visit, score_loyalty: fidNota || data.score_loyalty }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? 'Erro ao salvar')
      // Salva tag do contrato separadamente
      if (tagId !== (currentTagId ?? '')) {
        await fetch(`/api/contracts/${contractId}/tag`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag_id: tagId || null }),
        })
      }
      setSaved(true); router.refresh()
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#f8f9fb', color: '#1a1f36', outline: 'none' }
  const lbl: React.CSSProperties = { display: 'block', fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 4 }
  const g3: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }
  const g2: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }
  const sec: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#1a1f36', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px', paddingTop: 8 }
  const ABC_STYLE: Record<string, { bg: string; color: string }> = {
    A: { bg: '#f6e9ea', color: '#8e4550' }, B: { bg: '#fbeee5', color: '#c2683d' }, C: { bg: '#f1f3f8', color: '#52514e' },
  }

  // Itens de contrato condicionais por natureza
  const ITENS_CLINICA = [
    { key: 'has_parts',       label: '✅ Com peças incluídas' },
    { key: 'has_measurement', label: '📐 Por medição' },
    { key: 'has_audit',       label: '🔍 Auditoria incluída' },
  ]
  const ITENS_HOSPITALAR = [
    { key: 'has_parts',       label: '📦 Com material incluído' },
    { key: 'has_measurement', label: '📐 Por medição' },
    // has_audit não aparece em hospitalar
  ]
  const itensContrato = isHospitalar ? ITENS_HOSPITALAR : ITENS_CLINICA

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* Identificação */}
      <p style={sec}>Identificação</p>
      <div style={g3}>
        {show('contract_number') && <div><label style={lbl}>Nº Contrato</label><input style={inp} value={data.contract_number ?? ''} onChange={e => set('contract_number', e.target.value)} placeholder="CT-2024-001" /></div>}
        {show('sankhya_code') && <div><label style={lbl}>Cód. Sankhya</label><input style={inp} value={data.sankhya_code ?? ''} onChange={e => set('sankhya_code', e.target.value)} /></div>}
        {show('cnpj_billing') &&
          <div><label style={lbl}>CNPJ Faturamento</label>
            <select style={inp} value={data.cnpj_billing ?? ''} onChange={e => set('cnpj_billing', e.target.value)}>
              <option value="">Selecione...</option>
              <option value="33.763.031/0001-53">CNPJ: 33.763.031/0001-53</option>
              <option value="23.129.279/0001-03">CNPJ: 23.129.279/0001-03</option>
              <option value="23.129.279/0002-94">CNPJ: 23.129.279/0002-94</option>
            </select>
          </div>}
        {show('economic_group') && <div><label style={lbl}>Grupo Econômico</label><input style={inp} value={data.economic_group ?? ''} onChange={e => set('economic_group', e.target.value)} /></div>}
      {tags && tags.length > 0 && (
        <div>
          <label style={lbl}>Tag do Contrato</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {tagId && <span style={{ padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500, color: '#fff', background: tags.find(t => t.id === tagId)?.color ?? '#888' }}>
              {tags.find(t => t.id === tagId)?.name}
            </span>}
            <select value={tagId} onChange={e => setTagId(e.target.value)}
              style={{ ...inp, cursor: 'pointer', flex: 1 }}>
              <option value="">Sem tag</option>
              {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
      )}
      </div>

      {/* Tipo e Valor */}
      <p style={sec}>Tipo e Valor</p>
      <div style={g3}>
        <div>
          <label style={lbl}>Tipo de Contrato</label>
          <select style={{ ...inp, cursor: 'pointer' }} value={data.contract_type ?? ''} onChange={e => set('contract_type', e.target.value || null)}>
            <option value="">Selecione...</option>
            <option value="fixo">Fixo</option>
            <option value="medicao">Por Medição</option>
          </select>
        </div>
        <div><label style={lbl}>Valor Mensal (R$)</label><input style={inp} type="number" value={data.monthly_value ?? ''} onChange={e => set('monthly_value', e.target.value ? Number(e.target.value) : null)} /></div>
        <div>
          <label style={lbl}>Natureza</label>
          <select style={{ ...inp, cursor: 'pointer' }} value={data.nature ?? ''} onChange={e => set('nature', e.target.value || null)}>
            <option value="">Selecione...</option>
            <option value="eng_clinica">Engenharia Clínica</option>
            <option value="eng_predial">Engenharia Predial</option>
          </select>
        </div>
        <div>
          <label style={lbl}>Início da Vigência</label>
          <input style={inp} type="date" value={data.valid_from ?? ''} onChange={e => {
            set('valid_from', e.target.value || null)
            if (e.target.value) setFidNota(calcFidelidadeByDate(e.target.value))
          }} />
          {data.valid_from && (
            <p style={{ fontSize: 10, color: '#524e9c', marginTop: 3 }}>
              ↳ Fidelidade calculada: nota {calcFidelidadeByDate(data.valid_from)} — {
                (() => { const y = (Date.now() - new Date(data.valid_from).getTime()) / (365.25*24*3600*1000); return y >= 2 ? '2+ anos' : y >= 1 ? '1–2 anos' : 'menos de 1 ano' })()
              }
            </p>
          )}
        </div>
        <div>
          <label style={lbl}>Vigência (meses)</label>
          <select style={{ ...inp, cursor: 'pointer' }} value={data.validity_months ?? ''} onChange={e => set('validity_months', e.target.value ? Number(e.target.value) : null)}>
            <option value="">Selecione...</option>
            {[1,2,3,4,5,6,7,8,9,10,11,12,24,36,48,60].map(m => (
              <option key={m} value={m}>{m} {m === 1 ? 'mês' : 'meses'}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={lbl}>Vencimento</label>
          <input style={{ ...inp, background: '#f8f9fb', cursor: 'default' }} type="date" value={data.valid_until ?? ''}
            readOnly
            title={data.valid_from && data.validity_months ? 'Calculado automaticamente: Início + Vigência' : 'Preencha Início e Vigência para calcular'}
            onChange={e => set('valid_until', e.target.value || null)}
          />
          {data.valid_from && data.validity_months && (
            <p style={{ fontSize: 10, color: '#1f8c7d', marginTop: 3 }}>✓ Calculado: início + {data.validity_months} meses</p>
          )}
        </div>
      </div>

      {/* Itens do contrato — condicionais por natureza */}
      <p style={sec}>Itens do Contrato {isHospitalar ? '— Eng. Hospitalar' : '— Eng. Clínica'}</p>
      <div style={{ display: 'flex', gap: 20, marginBottom: 16, flexWrap: 'wrap' }}>
        {itensContrato.map(({ key, label }) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#52514e', cursor: 'pointer' }}>
            <input type="checkbox" checked={(data as any)[key] ?? false} onChange={e => set(key as keyof PortfolioData, e.target.checked)} />
            {label}
          </label>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ fontSize: 12, color: '#8892a4' }}>Equipe:</label>
          {[{ value: 'fixo_unidade', label: '📍 Fixa na Unidade' }, { value: 'remota', label: '🌐 Remota' }].map(opt => (
            <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#52514e', cursor: 'pointer' }}>
              <input type="radio" name="team_type" value={opt.value} checked={data.team_type === opt.value} onChange={() => set('team_type', opt.value)} />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      {/* Responsáveis */}
      <p style={sec}>Responsáveis</p>
      <div style={g2}>
        <div><label style={lbl}>Coordenador</label><input style={inp} value={data.coordinator_name ?? ''} onChange={e => set('coordinator_name', e.target.value)} placeholder="Nome do coordenador" /></div>
        <div><label style={lbl}>Engenheiro</label><input style={inp} value={data.engineer_name ?? ''} onChange={e => set('engineer_name', e.target.value)} placeholder="Nome do engenheiro" /></div>
      </div>

      {/* Localização — UF preenche Região automaticamente */}
      <p style={sec}>Localização</p>
      <div style={g2}>
        <div><label style={lbl}>Município</label><input style={inp} value={data.municipality ?? ''} onChange={e => set('municipality', e.target.value)} placeholder="Goiânia" /></div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={lbl}>UF <span style={{ fontSize: 9, color: '#b0b8c8', textTransform: 'none', letterSpacing: 0 }}>— selecione para preencher a Região automaticamente</span></label>
        <MultiSelect options={UFS} value={parseMulti(data.uf)} onChange={handleUfChange} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={lbl}>Região</label>
        <MultiSelect options={REGIOES} value={parseMulti(data.region)} onChange={v => set('region', toMulti(v))} />
      </div>

      {/* Classificação */}
      <p style={sec}>Classificação</p>
      <div style={{ marginBottom: 12 }}>
        <label style={lbl}>Esfera</label>
        <MultiSelect options={ESFERAS} value={parseMulti(data.sphere)} onChange={v => set('sphere', toMulti(v))} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={lbl}>Segmento</label>
        <MultiSelect options={SEGMENTOS} value={parseMulti(data.segment)} onChange={v => set('segment', toMulti(v))} />
      </div>

      {/* Cálculo ABC — thresholds do banco */}
      <p style={sec}>Cálculo da Curva ABC</p>
      <div style={{ background: '#f8f9fb', borderRadius: 10, padding: 16, marginBottom: 16, border: '0.5px solid #e8edf5' }}>
        <p style={{ fontSize: 11, color: '#8892a4', marginBottom: 4 }}>
          Conta = (Faturamento × 0,5) + (Visibilidade × 0,3) + (Fidelidade × 0,2)
        </p>
        <p style={{ fontSize: 10, color: '#b0b8c8', marginBottom: 12 }}>
          {isHospitalar ? 'Eng. Hospitalar' : 'Eng. Clínica'}: A ≥ {cfg.curve_a_min} · B ≥ {cfg.curve_b_min} · C &lt; {cfg.curve_b_min}
        </p>
        <div style={g3}>
          <div>
            <label style={lbl}>Faturamento</label>
            <select style={{ ...inp, cursor: 'pointer' }} value={fatNota} onChange={e => setFatNota(Number(e.target.value))}>
              <option value={0}>Selecione...</option>
              {fatOptions.map(o => <option key={o.value} value={o.value}>{o.label} = {o.value}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Visibilidade</label>
            <select style={{ ...inp, cursor: 'pointer' }} value={visNota} onChange={e => setVisNota(Number(e.target.value))}>
              <option value={0}>Selecione...</option>
              <option value={3}>Ótima = 3</option>
              <option value={2}>Média = 2</option>
              <option value={1}>Indiferente = 1</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Fidelidade (início do contrato)</label>
            <select style={{ ...inp, cursor: 'pointer' }} value={fidNota} onChange={e => setFidNota(Number(e.target.value))}>
              <option value={0}>Selecione...</option>
              <option value={3}>2+ anos = 3</option>
              <option value={2}>1–2 anos = 2</option>
              <option value={1}>0–1 ano = 1</option>
            </select>
          </div>
        </div>
        {weight > 0 && (
          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: '#fff', border: '0.5px solid #e8edf5' }}>
            <p style={{ fontSize: 11, fontFamily: 'monospace', color: '#52514e', marginBottom: 6 }}>
              ({fatNota} × 0,5) + ({visNota} × 0,3) + ({fidNota} × 0,2) = <strong>{weight}</strong>
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#52514e' }}>Conta:</span>
              <strong>{weight}</strong>
              <span style={{ color: '#8892a4' }}>→</span>
              <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, ...(curve ? ABC_STYLE[curve] : {}) }}>
                Curva {curve}
              </span>
            </div>
          </div>
        )}
        {weight === 0 && data.abc_curve && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#8892a4' }}>Último cálculo:</span>
            <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, ...ABC_STYLE[data.abc_curve] }}>Curva {data.abc_curve}</span>
            {data.score_weight && <span style={{ fontSize: 11, color: '#b0b8c8' }}>Peso {data.score_weight}</span>}
          </div>
        )}
      </div>

      {/* Observação */}
      <p style={sec}>Observação Interna</p>
      <textarea style={{ ...inp, minHeight: 64, resize: 'vertical', marginBottom: 16, fontFamily: 'inherit' }}
        value={data.internal_notes ?? ''} onChange={e => set('internal_notes', e.target.value)} placeholder="Notas internas..." />

      {error && <p style={{ fontSize: 12, color: '#8e4550', marginBottom: 8 }}>{error}</p>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={handleSave} disabled={busy}
          style={{ padding: '8px 20px', fontSize: 13, fontWeight: 500, borderRadius: 8, border: 'none', background: '#1a1f36', color: '#fff', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Salvando...' : 'Salvar dados da carteira'}
        </button>
        {saved && <span style={{ fontSize: 12, color: '#1f8c7d' }}>✅ Salvo</span>}
      </div>
    </div>
  )
}

function fmt(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}
