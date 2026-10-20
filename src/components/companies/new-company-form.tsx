'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { createCompany, type ActionState } from '@/lib/actions/companies'
import { CnpjLookupField } from '@/components/companies/cnpj-lookup-field'
import type { CnpjData } from '@/lib/actions/cnpj-lookup'

const initialState: ActionState = {}

const STATUS_OPTIONS = [
  { value: 'lead', label: 'Lead', desc: 'Contato inicial — ainda não qualificado. Pode ser de uma campanha ou prospecção fria.' },
  { value: 'prospect', label: 'Prospect', desc: 'Lead qualificado — há interesse real e fit com o produto.' },
  { value: 'cliente_ativo', label: 'Cliente Ativo', desc: 'Tem contrato ativo com a sua empresa.' },
  { value: 'cliente_inativo', label: 'Cliente Inativo', desc: 'Já foi cliente, não tem contrato ativo no momento.' },
  { value: 'nao_qualificado', label: 'Não qualificado', desc: 'Avaliado e não tem fit com o produto ou serviço.' },
]

export function NewCompanyForm({ segments }: { segments: string[] }) {
  const [state, formAction, pending] = useActionState(createCompany, initialState)
  const [name, setName] = useState('')
  const [tradeName, setTradeName] = useState('')
  const [city, setCity] = useState('')
  const [uf, setUf] = useState('')
  const [street, setStreet] = useState('')
  const [streetNumber, setStreetNumber] = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [zipCode, setZipCode] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [capitalSocial, setCapitalSocial] = useState('')
  const [mainActivity, setMainActivity] = useState('')
  const [statusHover, setStatusHover] = useState<string | null>(null)
  const [segmento, setSegmento] = useState('')

  function onCnpjFound(data: { razaoSocial: string; nomeFantasia: string | null } & Partial<CnpjData>) {
    setName(data.razaoSocial)
    setTradeName(data.nomeFantasia ?? '')
    if (data.municipio) setCity(data.municipio)
    if (data.uf) setUf(data.uf)
    if (data.logradouro) setStreet(data.logradouro)
    if (data.numero) setStreetNumber(data.numero)
    if (data.bairro) setNeighborhood(data.bairro)
    if (data.cep) setZipCode(data.cep)
    if (data.telefone) setPhone(data.telefone)
    if (data.email) setEmail(data.email)
    if (data.capitalSocial) setCapitalSocial(String(data.capitalSocial))
    if (data.cnaeDescricao) setMainActivity(data.cnaeDescricao)
  }


  const inputStyle: React.CSSProperties = { width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#f8f9fb', color: '#1a1f36', outline: 'none' }
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 4 }

  return (
    <div style={{ maxWidth: 600, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Link href="/companies" style={{ fontSize: 12, color: '#8892a4', textDecoration: 'none' }}>← Voltar para Empresas</Link>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#1a1f36', margin: 0 }}>Nova Empresa</h1>
        <p style={{ fontSize: 12, color: '#8892a4', marginTop: 3 }}>Busque pelo CNPJ para preencher automaticamente.</p>
      </div>

      <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 16, background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 24 }}>

        {/* CNPJ com busca */}
        <CnpjLookupField onFound={onCnpjFound} />

        {/* Razão Social e Nome Fantasia */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>Razão Social <span style={{ color: '#8e4550' }}>*</span></label>
            <input name="name" required value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Nome Fantasia</label>
            <input name="trade_name" value={tradeName} onChange={e => setTradeName(e.target.value)} style={inputStyle} />
          </div>
        </div>

        {/* Status */}
        <div>
          <label style={labelStyle}>Status da Empresa <span style={{ color: '#8e4550' }}>*</span></label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            {STATUS_OPTIONS.map(s => (
              <label key={s.value} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
                onMouseEnter={() => setStatusHover(s.value)} onMouseLeave={() => setStatusHover(null)}>
                <input type="radio" name="status" value={s.value} defaultChecked={s.value === 'lead'}
                  style={{ accentColor: '#1a1f36' }} />
                <span style={{ fontSize: 12, color: '#1a1f36' }}>{s.label}</span>
              </label>
            ))}
          </div>
          {statusHover && (
            <p style={{ fontSize: 11, color: '#52514e', background: '#f8f9fb', padding: '6px 10px', borderRadius: 6, border: '0.5px solid #e8edf5' }}>
              ℹ️ {STATUS_OPTIONS.find(s => s.value === statusHover)?.desc}
            </p>
          )}
        </div>

        {/* Segmento (obrigatório, uma opção) */}
        <div>
          <label style={labelStyle}>Segmento <span style={{ color: '#8e4550' }}>*</span></label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {segments.map(s => (
              <label key={s} style={{ position: 'relative', padding: '4px 10px', fontSize: 11, borderRadius: 20, border: '0.5px solid', cursor: 'pointer',
                borderColor: segmento === s ? '#1B556B' : '#d1d8e8',
                background: segmento === s ? '#1B556B' : '#fff',
                color: segmento === s ? '#fff' : '#52514e' }}>
                <input type="radio" name="segment_choice" value={s} checked={segmento === s} onChange={() => setSegmento(s)} required
                  style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
                {s}
              </label>
            ))}
          </div>
          <input type="hidden" name="segment" value={segmento ? JSON.stringify([segmento]) : ''} />
          <p style={{ fontSize: 10, color: '#8892a4', marginTop: 4 }}>As opções ficam em Configurações → Segmentos e inativos.</p>
        </div>

        {/* Localização */}
        <div>
          <label style={{ ...labelStyle, marginBottom: 8 }}>Localização</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginBottom: 8 }}>
            <div><label style={labelStyle}>Logradouro</label><input name="street" value={street} onChange={e => setStreet(e.target.value)} style={inputStyle} /></div>
            <div style={{ width: 80 }}><label style={labelStyle}>Número</label><input name="street_number" value={streetNumber} onChange={e => setStreetNumber(e.target.value)} style={inputStyle} /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px 80px', gap: 8 }}>
            <div><label style={labelStyle}>Bairro</label><input name="neighborhood" value={neighborhood} onChange={e => setNeighborhood(e.target.value)} style={inputStyle} /></div>
            <div><label style={labelStyle}>Município</label><input name="city" value={city} onChange={e => setCity(e.target.value)} style={inputStyle} /></div>
            <div><label style={labelStyle}>UF</label><input name="state" value={uf} onChange={e => setUf(e.target.value)} style={inputStyle} maxLength={2} /></div>
            <div><label style={labelStyle}>CEP</label><input name="zip_code" value={zipCode} onChange={e => setZipCode(e.target.value)} style={inputStyle} /></div>
          </div>
        </div>

        {/* Contato */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><label style={labelStyle}>Telefone</label><input name="phone" value={phone} onChange={e => setPhone(e.target.value)} style={inputStyle} placeholder="(00) 00000-0000" /></div>
          <div><label style={labelStyle}>E-mail</label><input name="email" type="email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} /></div>
        </div>

        {/* Dados Receita */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>Capital Social (R$)</label>
            <input name="capital_social" type="number" value={capitalSocial} onChange={e => setCapitalSocial(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Atividade Principal (CNAE)</label>
            <input name="main_activity" value={mainActivity} onChange={e => setMainActivity(e.target.value)} style={inputStyle} />
          </div>
        </div>

        {/* Observações */}
        <div>
          <label style={labelStyle}>Observações</label>
          <textarea name="notes" rows={3} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>

        {state.error && <p style={{ fontSize: 12, color: '#8e4550' }}>{state.error}</p>}

        <button type="submit" disabled={pending}
          style={{ padding: '10px', fontSize: 13, fontWeight: 500, borderRadius: 8, border: 'none', background: '#1a1f36', color: '#fff', cursor: pending ? 'not-allowed' : 'pointer', opacity: pending ? 0.6 : 1 }}>
          {pending ? 'Salvando...' : 'Criar Empresa'}
        </button>
      </form>
    </div>
  )
}
