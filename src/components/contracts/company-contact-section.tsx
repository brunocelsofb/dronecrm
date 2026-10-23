'use client'

// Fluxo: CNPJ é o ponto de entrada.
// 1. Usuário digita o CNPJ e clica em "Verificar"
// 2. Verificamos primeiro se JÁ existe uma empresa com esse CNPJ no nosso
//    banco (find) — se sim, mostramos ela e os contatos dela para escolher
// 3. Se não existir no nosso banco, consultamos a BrasilAPI para sugerir
//    razão social/nome fantasia, e pedimos os dados de um contato novo
//    (a empresa E o primeiro contato são criados junto com o contrato)
//
// Os campos ficam como <input type="hidden"> para o form pai (que usa
// Server Action tradicional) capturar tudo no submit, sem precisar de
// state compartilhado entre componentes.

import { useState, useEffect } from 'react'
import { lookupCnpj } from '@/lib/actions/cnpj-lookup'
import { getCompanySettings } from '@/lib/actions/company-settings'
import { findCompanyByCnpj } from '@/lib/actions/companies'
import { createClient } from '@/lib/supabase/client'

type Contact = { id: string; name: string; role: string | null }
type FoundCompany = { id: string; name: string; trade_name: string | null; cnpj?: string | null; contacts: Contact[] }

export function CompanyContactSection({ preselectedCompanyId }: { preselectedCompanyId?: string }) {
  const [segments, setSegments] = useState<string[]>([])
  useEffect(() => { getCompanySettings().then(x => setSegments(x.segments)).catch(() => {}) }, [])
  const [cnpj, setCnpj] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)
  const [loadingPreselected, setLoadingPreselected] = useState(!!preselectedCompanyId)

  const [foundCompany, setFoundCompany] = useState<FoundCompany | null>(null)
  const [newCompanyName, setNewCompanyName] = useState('')
  const [newCompanyTradeName, setNewCompanyTradeName] = useState('')

  const [selectedContactId, setSelectedContactId] = useState('')
  const [wantsNewContact, setWantsNewContact] = useState(false)
  const [newContactName, setNewContactName] = useState('')
  const [newContactRole, setNewContactRole] = useState('')
  const [newContactEmail, setNewContactEmail] = useState('')
  const [newContactPhone, setNewContactPhone] = useState('')

  useEffect(() => {
    if (!preselectedCompanyId) return

    async function loadPreselected() {
      const supabase = createClient()
      const { data: company } = await supabase
        .from('companies')
        .select('id, name, trade_name, cnpj')
        .eq('id', preselectedCompanyId!)
        .maybeSingle()

      if (!company) {
        setLoadingPreselected(false)
        return
      }

      const { data: contacts } = await supabase
        .from('contacts')
        .select('id, name, role')
        .eq('company_id', preselectedCompanyId!)
        .order('created_at')

      setFoundCompany({ ...company, contacts: contacts ?? [] })
      setChecked(true)
      setLoadingPreselected(false)
    }

    loadPreselected()
  }, [preselectedCompanyId])

  async function handleCheck() {
    setError(null)
    setChecking(true)
    setChecked(false)
    setFoundCompany(null)

    const digits = cnpj.replace(/\D/g, '')
    if (digits.length !== 14) {
      setError('CNPJ precisa ter 14 dígitos.')
      setChecking(false)
      return
    }

    // 1. Já existe na nossa base?
    const existing = await findCompanyByCnpj(digits)
    if (existing) {
      setFoundCompany(existing)
      setChecked(true)
      setChecking(false)
      return
    }

    // 2. Não existe — sugere dados via BrasilAPI (best-effort, pode falhar)
    const lookup = await lookupCnpj(digits)
    if (lookup.success) {
      setNewCompanyName(lookup.razaoSocial)
      setNewCompanyTradeName(lookup.nomeFantasia ?? '')
    } else {
      setNewCompanyName('')
      setNewCompanyTradeName('')
    }
    setWantsNewContact(true)
    setChecked(true)
    setChecking(false)
  }

  return (
    <div style={{ background: '#f8f9fb', borderRadius: 10, border: '0.5px solid #e8edf5', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 12, fontWeight: 500, color: '#1a1f36', margin: 0 }}>Empresa e contato responsável</p>

      {loadingPreselected && <p style={{ fontSize: 12, color: '#8892a4' }}>Carregando empresa...</p>}

      {/* Campo CNPJ — só aparece quando NÃO veio de uma empresa pré-selecionada */}
      {!preselectedCompanyId && (
        <div>
          <label style={{ display: 'block', fontSize: 10, color: '#8892a4', textTransform: 'uppercase' as const, letterSpacing: '0.7px', marginBottom: 4 }}>
            CNPJ <span style={{ color: '#8e4550' }}>*</span>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={cnpj} onChange={e => { setCnpj(e.target.value); setChecked(false) }}
              placeholder="00.000.000/0000-00"
              style={{ flex: 1, padding: '7px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', color: '#1a1f36', outline: 'none' }} />
            <button type="button" onClick={handleCheck}
              disabled={checking || cnpj.replace(/\D/g, '').length !== 14}
              style={{ padding: '7px 14px', fontSize: 12, borderRadius: 8, border: '0.5px solid #1a1f36', background: '#fff', color: '#1a1f36', cursor: 'pointer', whiteSpace: 'nowrap', opacity: (checking || cnpj.replace(/\D/g, '').length !== 14) ? 0.4 : 1 }}>
              {checking ? 'Verificando...' : 'Verificar'}
            </button>
          </div>
          {error && <p style={{ marginTop: 4, fontSize: 11, color: '#8e4550' }}>{error}</p>}
        </div>
      )}

      {checked && foundCompany && (
        <div>
          <input type="hidden" name="existing_company_id" value={foundCompany.id} />
          {foundCompany.cnpj && <input type="hidden" name="company_cnpj" value={foundCompany.cnpj.replace(/\D/g, '')} />}

          {/* Empresa pré-selecionada: só mostra o nome fixo, não o aviso de "verificada" */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: '#e3f5f1', border: '0.5px solid #bbddc8' }}>
            <span style={{ fontSize: 12, color: '#1f8c7d' }}>✓</span>
            <div>
              <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', margin: 0 }}>{foundCompany.name}</p>
              {foundCompany.trade_name && <p style={{ fontSize: 11, color: '#52514e', marginTop: 1 }}>{foundCompany.trade_name}</p>}
              {foundCompany.cnpj && (
                <p style={{ fontSize: 11, color: '#8892a4', marginTop: 2, fontFamily: 'monospace' }}>
                  CNPJ: {foundCompany.cnpj}
                </p>
              )}
            </div>
            {!preselectedCompanyId && (
              <button type="button" onClick={() => { setFoundCompany(null); setChecked(false); setCnpj('') }}
                style={{ marginLeft: 'auto', fontSize: 11, color: '#8892a4', background: 'none', border: 'none', cursor: 'pointer' }}>
                Trocar
              </button>
            )}
          </div>

          <label style={{ display: 'block', fontSize: 10, color: '#8892a4', textTransform: 'uppercase' as const, letterSpacing: '0.7px', marginBottom: 4 }}>
            Contato responsável
          </label>
          {!wantsNewContact ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <select name="existing_contact_id" value={selectedContactId}
                onChange={e => setSelectedContactId(e.target.value)}
                style={{ width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', color: '#1a1f36', outline: 'none' }}>
                <option value="">Selecione um contato...</option>
              {foundCompany.contacts.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.role ? ` — ${c.role}` : ''}</option>
                  ))}
              </select>
              <button type="button" onClick={() => setWantsNewContact(true)}
                style={{ fontSize: 11, color: '#1b556b', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' as const, padding: 0 }}>
                + Cadastrar novo contato para esta empresa
              </button>
            </div>
          ) : (
            <NewContactFields
              name={newContactName} setName={setNewContactName}
              role={newContactRole} setRole={setNewContactRole}
              email={newContactEmail} setEmail={setNewContactEmail}
              phone={newContactPhone} setPhone={setNewContactPhone}
              onCancel={foundCompany.contacts.length > 0 ? () => setWantsNewContact(false) : undefined}
            />
          )}
        </div>
      )}

      {checked && !foundCompany && (
        <div style={{ borderRadius: 8, border: '0.5px solid #e8edf5', background: '#fff', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input type="hidden" name="new_company_cnpj" value={cnpj.replace(/\D/g, '')} />
          <p style={{ fontSize: 11, color: '#8892a4' }}>
            Empresa nova — não encontramos esse CNPJ na sua base. Confira os dados abaixo antes de salvar.
          </p>
          <div>
            <label style={{ display: 'block', fontSize: 10, color: '#8892a4', textTransform: 'uppercase' as const, letterSpacing: '0.7px', marginBottom: 4 }}>Razão Social *</label>
            <input name="new_company_name" required value={newCompanyName} onChange={e => setNewCompanyName(e.target.value)}
              style={{ width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#f8f9fb', color: '#1a1f36', outline: 'none' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 10, color: '#8892a4', textTransform: 'uppercase' as const, letterSpacing: '0.7px', marginBottom: 4 }}>Nome Fantasia</label>
            <input name="new_company_trade_name" value={newCompanyTradeName} onChange={e => setNewCompanyTradeName(e.target.value)}
              style={{ width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#f8f9fb', color: '#1a1f36', outline: 'none' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 10, color: '#8892a4', textTransform: 'uppercase' as const, letterSpacing: '0.7px', marginBottom: 4 }}>Segmento *</label>
            <select name="new_company_segment" required defaultValue=""
              style={{ width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#f8f9fb', color: '#1a1f36', outline: 'none' }}>
              <option value="">Selecione...</option>
              {segments.map(sg => <option key={sg} value={sg}>{sg}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 10, color: '#8892a4', textTransform: 'uppercase' as const, letterSpacing: '0.7px', marginBottom: 4 }}>Contato responsável *</label>
            <NewContactFields
              name={newContactName} setName={setNewContactName}
              role={newContactRole} setRole={setNewContactRole}
              email={newContactEmail} setEmail={setNewContactEmail}
              phone={newContactPhone} setPhone={setNewContactPhone}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function NewContactFields({
  name, setName, role, setRole, email, setEmail, phone, setPhone, onCancel,
}: {
  name: string; setName: (v: string) => void
  role: string; setRole: (v: string) => void
  email: string; setEmail: (v: string) => void
  phone: string; setPhone: (v: string) => void
  onCancel?: () => void
}) {
  const inputStyle = { width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#f8f9fb', color: '#1a1f36', outline: 'none' }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 8, padding: 10, borderRadius: 8, border: '0.5px solid #e8edf5', background: '#f8f9fb' }}>
      <div style={{ gridColumn: '1/-1' }}>
        <input name="new_contact_name" required placeholder="Nome *" value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
      </div>
      <div>
        <input name="new_contact_role" placeholder="Cargo" value={role}
          onChange={e => setRole(e.target.value)} style={inputStyle} />
      </div>
      <div>
        <input name="new_contact_email" type="email" placeholder="E-mail" value={email}
          onChange={e => setEmail(e.target.value)} style={inputStyle} />
      </div>
      <div>
        <input name="new_contact_phone" placeholder="Telefone" value={phone}
          onChange={e => setPhone(e.target.value)} style={inputStyle} />
      </div>
      {onCancel && (
        <button type="button" onClick={onCancel}
          style={{ gridColumn: '1/-1', fontSize: 11, color: '#8892a4', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' as const, padding: 0 }}>
          Cancelar, escolher contato existente
        </button>
      )}
    </div>
  )
}
