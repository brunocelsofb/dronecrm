'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

type FieldDef = { key: string; label: string; section: string; active: boolean }

const DEFAULT_FIELDS: FieldDef[] = [
  { key: 'contract_number',   label: 'Nº Contrato',         section: 'Identificação', active: true },
  { key: 'sankhya_code',      label: 'Cód. Sankhya',        section: 'Identificação', active: true },
  { key: 'cnpj_billing',      label: 'CNPJ Faturamento',    section: 'Identificação', active: true },
  { key: 'economic_group',    label: 'Grupo Econômico',     section: 'Identificação', active: true },
  { key: 'contract_type',     label: 'Tipo de Contrato',    section: 'Tipo e Valor',  active: true },
  { key: 'monthly_value',     label: 'Valor Mensal',        section: 'Tipo e Valor',  active: true },
  { key: 'nature',            label: 'Natureza',            section: 'Tipo e Valor',  active: true },
  { key: 'valid_from',        label: 'Início da Vigência',  section: 'Tipo e Valor',  active: true },
  { key: 'valid_until',       label: 'Vencimento',          section: 'Tipo e Valor',  active: true },
  { key: 'validity_months',   label: 'Vigência (meses)',    section: 'Tipo e Valor',  active: true },
  { key: 'has_parts',         label: 'Com peças/material',  section: 'Itens',         active: true },
  { key: 'has_measurement',   label: 'Por medição',         section: 'Itens',         active: true },
  { key: 'has_audit',         label: 'Auditoria',           section: 'Itens',         active: true },
  { key: 'team_type',         label: 'Tipo de equipe',      section: 'Itens',         active: true },
  { key: 'coordinator_name',  label: 'Coordenador',         section: 'Responsáveis',  active: true },
  { key: 'engineer_name',     label: 'Engenheiro',          section: 'Responsáveis',  active: true },
  { key: 'municipality',      label: 'Município',           section: 'Localização',   active: true },
  { key: 'uf',                label: 'UF',                  section: 'Localização',   active: true },
  { key: 'region',            label: 'Região',              section: 'Localização',   active: true },
  { key: 'sphere',            label: 'Esfera',              section: 'Classificação', active: true },
  { key: 'segment',           label: 'Segmento',            section: 'Classificação', active: true },
  { key: 'score_billing',     label: 'Nota Faturamento',    section: 'Curva ABC',     active: true },
  { key: 'score_visit',       label: 'Nota Visibilidade',   section: 'Curva ABC',     active: true },
  { key: 'score_loyalty',     label: 'Nota Fidelidade',     section: 'Curva ABC',     active: true },
  { key: 'abc_curve',         label: 'Curva ABC',           section: 'Curva ABC',     active: true },
  { key: 'internal_notes',    label: 'Observação Interna',  section: 'Observações',   active: true },
]

export function CarteiraConfigManager() {
  const router = useRouter()
  const [fields, setFields] = useState<FieldDef[]>(DEFAULT_FIELDS)
  const [newLabel, setNewLabel] = useState('')
  const [newKey, setNewKey] = useState('')
  const [newSection, setNewSection] = useState('Identificação')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/settings/carteira-fields')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.activeFields && Array.isArray(d.activeFields)) {
          setFields(prev => prev.map(f => ({ ...f, active: d.activeFields.includes(f.key) })))
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function saveFields() {
    setSaving(true)
    const activeKeys = fields.filter(f => f.active).map(f => f.key)
    await fetch('/api/settings/carteira-fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeFields: activeKeys }),
    })
    setSaving(false)
    setSaved(true)
  }

  const sections = [...new Set(fields.map(f => f.section))]

  function toggleField(key: string) {
    setFields(prev => prev.map(f => f.key === key ? { ...f, active: !f.active } : f))
    setSaved(false)
  }

  function addField() {
    const label = newLabel.trim()
    const key = (newKey.trim() || label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''))
    if (!label || !key) return
    if (fields.some(f => f.key === key)) return
    setFields(prev => [...prev, { key, label, section: newSection, active: true }])
    setNewLabel(''); setNewKey('')
  }

  function removeField(key: string) {
    if (!confirm('Remover este campo da carteira?')) return
    setFields(prev => prev.filter(f => f.key !== key))
    setSaved(false)
  }

  const inp: React.CSSProperties = { padding: '6px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#f8f9fb', color: '#1a1f36', outline: 'none' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {sections.map(section => (
        <div key={section} style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: '0.5px solid #f1f3f8', background: '#f8f9fb' }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#1a1f36', textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0 }}>{section}</p>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {fields.filter(f => f.section === section).map(field => (
                <tr key={field.key} style={{ borderBottom: '0.5px solid #f8f9fb', opacity: field.active ? 1 : 0.4 }}>
                  <td style={{ padding: '10px 16px' }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', margin: 0 }}>{field.label}</p>
                    <p style={{ fontSize: 10, fontFamily: 'monospace', color: '#b0b8c8', marginTop: 2 }}>{field.key}</p>
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                      <button onClick={() => toggleField(field.key)}
                        style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, border: '0.5px solid', cursor: 'pointer',
                          background: field.active ? '#e3f5f1' : '#f1f3f8',
                          color: field.active ? '#1f8c7d' : '#8892a4',
                          borderColor: field.active ? '#bbddc8' : '#d1d8e8' }}>
                        {field.active ? 'Ativo' : 'Inativo'}
                      </button>
                      <button onClick={() => removeField(field.key)}
                        style={{ fontSize: 11, color: '#8e4550', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                        Remover
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* Adicionar campo */}
      <div style={{ background: '#f8f9fb', borderRadius: 10, border: '0.5px solid #e8edf5', padding: 16 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: '#1a1f36', marginBottom: 10 }}>+ Adicionar campo</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <p style={{ fontSize: 10, color: '#8892a4', marginBottom: 4 }}>Nome</p>
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Ex: Tipo de serviço" style={{ ...inp, width: 160 }} />
          </div>
          <div>
            <p style={{ fontSize: 10, color: '#8892a4', marginBottom: 4 }}>Chave (auto)</p>
            <input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="tipo_servico" style={{ ...inp, width: 130 }} />
          </div>
          <div>
            <p style={{ fontSize: 10, color: '#8892a4', marginBottom: 4 }}>Seção</p>
            <select value={newSection} onChange={e => setNewSection(e.target.value)} style={{ ...inp, cursor: 'pointer', width: 140 }}>
              {sections.map(s => <option key={s} value={s}>{s}</option>)}
              <option value="Outros">Outros</option>
            </select>
          </div>
          <button onClick={addField} disabled={!newLabel.trim()}
            style={{ padding: '6px 16px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: 'none', background: '#1a1f36', color: '#fff', cursor: 'pointer', opacity: !newLabel.trim() ? 0.4 : 1 }}>
            Adicionar
          </button>
        </div>
      </div>

      <p style={{ fontSize: 11, color: '#8892a4' }}>
        💡 As alterações aqui são visuais — os campos já existem no banco. Ativar/inativar controla apenas o que aparece na tela de dados da carteira.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={saveFields} disabled={saving}
          style={{ padding: '8px 20px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', background: '#1a1f36', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Salvando...' : 'Salvar configurações'}
        </button>
        {saved && !saving && <span style={{ fontSize: 12, color: '#1f8c7d' }}>✓ Salvo</span>}
      </div>
    </div>
  )
}
