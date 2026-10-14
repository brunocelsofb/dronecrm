// Adaptador: converte snapshot do Price + textos em formato do buildStandardProposalPage de julho
import { buildStandardProposalPage } from './proposal-pdf-builder'
import { createAdminClient } from '@/lib/supabase/admin'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

function san(text: string | null | undefined): string {
  if (!text) return ''
  const map: Record<string, string> = {
    '\u00e1':'a','\u00e0':'a','\u00e3':'a','\u00e2':'a',
    '\u00c1':'A','\u00c0':'A','\u00c3':'A','\u00c2':'A',
    '\u00e9':'e','\u00e8':'e','\u00ea':'e',
    '\u00c9':'E','\u00ca':'E',
    '\u00ed':'i','\u00ee':'i','\u00cd':'I',
    '\u00f3':'o','\u00f5':'o','\u00f4':'o',
    '\u00d3':'O','\u00d4':'O','\u00d5':'O',
    '\u00fa':'u','\u00fb':'u','\u00da':'U',
    '\u00e7':'c','\u00c7':'C',
    '\u2019':"'",'`':"'"
  }
  return Array.from(text).map(c => map[c] ?? (c.charCodeAt(0) > 127 ? '' : c)).join('')
}

export async function buildPriceProposalPage(params: {
  snapshot: any
  proposalValue: number
  validityDays: number
  submittedByName: string | null
  technicalApprovedByName: string | null
  technicalApprovedAt: string | null
  technicalComment: string | null
  commercialApprovedByName: string | null
  commercialApprovedAt: string | null
  contract: { client_name: string; process_number: string | null; cnpj: string | null } | null
  company?: { name?: string; cnpj?: string; address?: string; tradeName?: string; email?: string; phone?: string } | null
  contact?: { name?: string; email?: string; phone?: string; cpf?: string } | null
  org?: {
    companyName?: string
    cnpj?: string
    logoStoragePath?: string | null
    brandColor?: string | null
    headerText?: string | null
    footerText?: string | null
    proposalCode?: string
  } | null
  textoObjetivos?: string | null
  textoAtividades?: string | null
  textoEstruturaApoio?: string | null
}): Promise<Uint8Array> {
  const { snapshot: snap, proposalValue, validityDays } = params
  const dur = snap.contractDuration ?? 12
  const org = params.org ?? {}

  // Busca logo do Storage
  let logoBytes: Uint8Array | null = null
  let logoIsPng = false
  if (org.logoStoragePath) {
    try {
      const admin = (await createScopedAdmin())
      const { data } = await admin.storage.from('proposal-files').download(org.logoStoragePath)
      if (data) {
        logoBytes = new Uint8Array(await data.arrayBuffer())
        logoIsPng = org.logoStoragePath.toLowerCase().endsWith('.png')
      }
    } catch { /* logo opcional */ }
  }

  // Monta texto de características com escopo e equipe
  const profs = (snap.professionals ?? []).filter((p: any) => p.role?.trim())
  const escopo = (snap.escopoSanitizado ?? snap.escopoServicos ?? []).map(san).join(' - ')
  const equipeTxt = profs.map((p: any) => {
    const carga = p.hoursPerMonth === 220 ? '44h sem.' : p.hoursPerMonth === 180 ? '12x36' : `${p.hoursPerMonth}h/mes`
    return `0${p.quantity} ${san(p.role)} ${san(p.contractType)} ${carga}`
  }).join(', ')

  const chars = [
    escopo && `Escopo: ${escopo}`,
    equipeTxt && `Equipe: ${equipeTxt}`,
    snap.dimensionamento?.totalEquipamentos > 0 && `${snap.dimensionamento.totalEquipamentos} equipamentos gerenciados`,
  ].filter(Boolean).join(' | ')

  // Item principal
  const items = [{
    quantity: 1,
    category: san(snap.tipoEngenharia === 'Hospitalar' ? 'Engenharia Hospitalar' : 'Engenharia Clinica'),
    item: san(snap.tituloItemServico ?? 'Servico Continuo de Engenharia'),
    characteristics: chars.slice(0, 500),
    type: 'MRR',
    delivery_forecast: null,
    unit_value: proposalValue,
    discount: 0,
    subtotal: proposalValue,
  }]

  // Content blocks com textos personalizados
  const contentBlocks: any[] = []

  const addTextBlock = (titulo: string, texto: string | null | undefined) => {
    if (!texto?.trim()) return
    // Quebra o texto em linhas para renderizar no builder de julho
    const linhas = san(texto).split('\n').filter(l => l.trim())
    contentBlocks.push({
      block_type: 'table',
      image_storage_path: null,
      table_data: {
        rows: [
          [titulo],
          ...linhas.map(l => [l]),
          [''], // espaço após o bloco
        ]
      },
    })
  }

  addTextBlock('OBJETIVOS', params.textoObjetivos)
  addTextBlock('ATIVIDADES A SEREM DESENVOLVIDAS', params.textoAtividades)
  addTextBlock('ESTRUTURA DE APOIO', params.textoEstruturaApoio)

  // Aprovações internas
  const aprovLines = [
    params.submittedByName && `Enviada p/ aprovacao tecnica: ${san(params.submittedByName)}`,
    params.technicalApprovedByName && `Aprovada tecnicamente: ${san(params.technicalApprovedByName)}${params.technicalApprovedAt ? ` em ${new Date(params.technicalApprovedAt).toLocaleDateString('pt-BR')}` : ''}`,
    params.technicalComment && `Parecer: ${san(params.technicalComment)}`,
    params.commercialApprovedByName && `Aprovada comercialmente: ${san(params.commercialApprovedByName)}${params.commercialApprovedAt ? ` em ${new Date(params.commercialApprovedAt).toLocaleDateString('pt-BR')}` : ''}`,
  ].filter(Boolean) as string[]

  if (aprovLines.length > 0) {
    contentBlocks.push({
      block_type: 'table',
      image_storage_path: null,
      table_data: { rows: [['APROVACOES INTERNAS'], ...aprovLines.map(l => [l]), ['']] },
    })
  }

  const validUntil = new Date(Date.now() + validityDays * 86400000).toISOString().split('T')[0]
  const propCode = san(org.proposalCode ?? params.contract?.process_number ?? 'PROP')

  return buildStandardProposalPage({
    proposal: {
      control_code: propCode,
      currency: 'BRL',
      client_po_number: null,
      valid_until: validUntil,
      created_at: new Date().toISOString(),
      version: 1,
      discount_type: null,
      discount_value: 0,
      payment_terms: `${dur} parcelas mensais`,
      installments: dur,
      is_recurring: true,
    },
    items,
    company: params.company ? {
      name: san(params.company.name ?? ''),
      trade_name: san((params.company as any).tradeName ?? params.company.name ?? null),
      cnpj: san(params.company.cnpj ?? params.contract?.cnpj ?? null),
      legal_name: san((params.company as any).tradeName ?? params.company.name ?? params.contract?.client_name ?? null),
      nf_email: san((params.company as any).email ?? null),
      address: san(params.company.address ?? null),
    } : {
      name: san(params.contract?.client_name ?? ''),
      trade_name: null,
      cnpj: san(params.contract?.cnpj ?? null),
      legal_name: san(params.contract?.client_name ?? null),
      nf_email: null,
      address: null,
    },
    contact: params.contact ? {
      name: san(params.contact.name ?? ''),
      cpf: san((params.contact as any).cpf ?? null),
      email: san(params.contact.email ?? null),
      phone: san((params.contact as any).phone ?? null),
      address: null,
    } : null,
    org: {
      companyName: san(org.companyName ?? 'ORBIS GESTAO DE TECNOLOGIA EM SAUDE LTDA'),
      logoBytes,
      logoIsPng,
      createdByName: null,
      createdByEmail: null,
      headerText: san(org.headerText ?? null),
      footerText: san(org.footerText ?? null),
      brandColor: org.brandColor ?? '#1B556B',
    },
    contentBlocks,
  })
}
