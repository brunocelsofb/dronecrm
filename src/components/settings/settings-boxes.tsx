'use client'

// Configurações: cada assunto no seu quadro (usado pela página /settings).
// A busca no topo destaca os quadros e itens que batem com o termo.
import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import { Search, X } from 'lucide-react'
import { Building2, Users, KanbanSquare, Target, Briefcase, FileText, PenLine, Mail, MessageCircle, BrainCircuit, ClipboardList, Plug, Settings2, Store } from 'lucide-react'
import { featureForPath } from '@/lib/config/plans'

// keywords: palavras que a pessoa pode procurar e não aparecem no nome/descrição
// Aparece só se a empresa tem a aba dona do endereço (plano); anyOf: basta uma destas abas
type Item = { href: string; label: string; description: string; keywords?: string; anyOf?: string[] }
type Box = { title: string; description: string; icon: LucideIcon; items: Item[] }

const BOXES: Box[] = [
  {
    title: 'Loja (Varejo)', icon: Store, description: 'Vitrine, preços, mensagens do pedido e Estúdio IA.',
    items: [
      { href: '/varejo/configurar', label: 'Configurar loja', description: 'Atalhos da loja e Zerar a loja (o Estúdio IA fica intacto)', keywords: 'zerar recomeçar apagar estoque loja' },
      { href: '/varejo/vitrine', label: 'Vitrine', description: 'Capa, cores, textos, ocasiões, looks e políticas do site', keywords: 'site landing lp capa tema políticas troca' },
      { href: '/varejo/precificacao', label: 'Custos e preço', description: 'Impostos, taxas, custos fixos, margem e fidelidade', keywords: 'margem imposto mei simples taxa cartão fidelidade cashback' },
      { href: '/varejo/mensagens', label: 'Mensagens do pedido', description: 'Textos de WhatsApp e e-mail de cada etapa do pedido', keywords: 'whatsapp e-mail pedido rastreio pagamento' },
      { href: '/varejo/estudio', label: 'Conta de IA do Estúdio', description: 'Chave do Gemini ou ChatGPT para gerar modelos, cenários e looks', keywords: 'gemini chatgpt openai chave api imagem modelo' },
    ],
  },
  {
    title: 'Empresa', icon: Building2, description: 'Quem é a empresa no CRM e as metas.',
    items: [
      { href: '/settings/empresa', label: 'Dados da empresa', description: 'Logo, nome, CNPJ e visual das propostas', keywords: 'cnpj logo marca link de login razão social' },
      { href: '/settings/privacidade', label: 'Privacidade e dados', description: 'Contrato de dados (LGPD), acesso de suporte, retenção, criptografia e exportação dos dados', keywords: 'exportar exportação backup baixar zip csv portabilidade lgpd privacidade contrato dados suporte acesso super admin retenção apagar mensagens criptografia dpa' },
      { href: '/settings/segmentos', label: 'Segmentos e inativos', description: 'Segmentos das empresas e regra de cliente inativo', keywords: 'segmento grupo hospitalar clinicas diagnostico inativo reativação hunter campanha' },
      { href: '/settings/metas', label: 'Metas de receita', description: 'Meta mês a mês e prazo do relatório de medição', keywords: 'meta receita faturamento medição', anyOf: ['dashboard', 'painel', 'financeiro'] },
      { href: '/settings/protocolos', label: 'Numeração de chamados e propostas', description: 'Prefixo e próximo número', anyOf: ['tickets', 'propostas'] },
      { href: '/settings/wallpapers', label: 'Papéis de parede', description: 'Fundo do login e das páginas públicas' },
    ],
  },
  {
    title: 'Equipe e acesso', icon: Users, description: 'Quem usa o CRM e o que cada um vê.',
    items: [
      { href: '/users', label: 'Usuários', description: 'Cadastro, papel, perfil e departamento', keywords: 'usuário pessoa equipe convidar senha' },
      { href: '/settings/perfis-acesso', label: 'Perfis de acesso', description: 'Abas de cada perfil (Gestor, Hunter, Farmer…)', keywords: 'permissão aba menu hunter farmer gestor' },
      { href: '/settings/price-users', label: 'Usuários do Price', description: 'Aprovadores e precificadores da precificação' },
      { href: '/minha-conta', label: 'Minha conta', description: 'Seus dados, Gmail e assinatura de e-mail' },
    ],
  },
  {
    title: 'Funis e oportunidades', icon: KanbanSquare, description: 'Como as oportunidades andam no funil.',
    items: [
      { href: '/pipelines', label: 'Funis e etapas', description: 'Funis e etapas do processo', keywords: 'funil etapa kanban ganho perdido renovado' },
      { href: '/settings/campos-oportunidade', label: 'Campos por funil', description: 'Obrigatórios e opcionais em cada funil' },
      { href: '/custom-fields', label: 'Campos customizados', description: 'Campos extras das oportunidades' },
      { href: '/settings/layout-abas', label: 'Layout das abas', description: 'Ordem e visibilidade das abas por funil', keywords: 'ocultar esconder aba plano de ação proposta atendimento' },
      { href: '/settings/plano-de-acao', label: 'Plano de ação', description: 'PDCA e ferramentas da qualidade (5W2H, 5 Porquês, Ishikawa, GUT)', keywords: 'qualidade tratativa pdca 5w2h porques ishikawa gut eficácia iso 9001 detrator reclamação não conformidade' },
      { href: '/settings/motivos-perda', label: 'Motivos de perda', description: 'Lista exigida ao marcar perda', keywords: 'perdido rescisão' },
      { href: '/settings/numeracao', label: 'Numeração de oportunidades', description: 'Prefixo e sequência automática' },
      { href: '/tags', label: 'Tags', description: 'Etiquetas para classificar' },
      { href: '/automations', label: 'Automações', description: 'Regras por gatilho ou tempo', keywords: 'gatilho regra automático' },
    ],
  },
  {
    title: 'Leads', icon: Target, description: 'Como os leads são priorizados e distribuídos.',
    items: [
      { href: '/settings/lead-scoring', label: 'Pontuação de leads', description: 'Critérios e pontos', keywords: 'pontuação lead quente frio' },
      { href: '/settings/lead-routing', label: 'Roteamento de leads', description: 'Regras de funil e responsável' },
    ],
  },
  {
    title: 'Contratos e carteira', icon: Briefcase, description: 'Gestão dos contratos depois do ganho.',
    items: [
      { href: '/settings/carteira', label: 'Gestão da carteira', description: 'Campos da aba de dados da carteira', keywords: 'contrato carteira cliente' },
      { href: '/settings/curva-abc', label: 'Curva ABC', description: 'Faixas A, B e C por natureza' },
      { href: '/settings/regua-renovacao', label: 'Régua de renovação', description: 'Passos internos, prazos e e-mails às áreas', keywords: 'renovação renovar vencimento aviso prazo áreas e-mail interno aditivo' },
      { href: '/settings/implementation-templates', label: 'Modelos de implantação', description: 'Cronogramas padrão de implantação', keywords: 'implantação cronograma' },
    ],
  },
  {
    title: 'Propostas', icon: FileText, description: 'Modelos e itens das propostas comerciais.',
    items: [
      { href: '/proposals/templates', label: 'Modelos de proposta', description: 'Templates de proposta comercial', keywords: 'proposta modelo' },
      { href: '/proposals/catalog', label: 'Catálogo de produtos', description: 'Produtos e serviços das propostas' },
    ],
  },
  {
    title: 'Assinatura digital', icon: PenLine, description: 'Contratos e aditivos pela ZapSign.',
    items: [
      { href: '/settings/zapsign', label: 'ZapSign', description: 'Avisos de assinatura, token e ambiente', keywords: 'assinatura contrato aditivo' },
      { href: '/zapsign', label: 'Modelos ZapSign', description: 'Modelos de contrato e aditivo', keywords: 'assinatura contrato aditivo renovação' },
    ],
  },
  {
    title: 'E-mail', icon: Mail, description: 'Modelos e respostas dos clientes.',
    items: [
      { href: '/email-templates', label: 'Modelos de e-mail', description: 'Textos prontos de e-mail e WhatsApp', keywords: 'e-mail whatsapp texto pronto' },
      { href: '/settings/email', label: 'Recebimento de e-mail', description: 'Respostas do cliente caindo na oportunidade', keywords: 'resposta caixa de entrada inbound' },
    ],
  },
  {
    title: 'WhatsApp', icon: MessageCircle, description: 'Números da empresa e atendimento automático.',
    items: [
      { href: '/settings/whatsapp-conexoes', label: 'Conexões', description: 'Números conectados (QR Code) e apelidos', keywords: 'whatsapp número qr code instância evolution' },
      { href: '/settings/whatsapp-bot', label: 'Bot e automações', description: 'Boas-vindas e status online/offline', keywords: 'whatsapp triagem boas-vindas menu' },
    ],
  },
  {
    title: 'Inteligência artificial', icon: BrainCircuit, description: 'Agentes Farmer e Hunter, o assistente e o SDR de IA.',
    items: [
      { href: '/settings/copiloto', label: 'Agentes IA (Farmer e Hunter)', description: 'Chave da IA, gestor e avisos de renovação', keywords: 'renovação renovar aviso ao cliente vencimento 60 30 15 dias farmer hunter chave anthropic briefing gestor e-mail interno ganho renovado implantação' },
      { href: '/settings/assistente', label: 'Assistente Théo', description: 'Limite de gasto mensal', keywords: 'théo ia gasto custo' },
      { href: '/settings/sdr', label: 'SDR de IA', description: 'Assistente no WhatsApp que qualifica e passa leads', keywords: 'sdr ia whatsapp lead qualificação pré-vendas agenda' },
    ],
  },
  {
    title: 'Integrações', icon: Plug, description: 'Escolha e configure as ferramentas que conversam com o CRM.',
    items: [
      { href: '/settings/integracoes', label: 'Integrações', description: 'Faturamento (Sankhya, TOTVS…), anúncios, RD Station, Mailchimp, site', keywords: 'integração sankhya totvs faturamento rd station mailchimp anúncios site api', anyOf: ['pipeline', 'leads', 'marketing', 'financeiro'] },
    ],
  },
  {
    title: 'Pesquisas', icon: ClipboardList, description: 'Satisfação e NPS dos clientes.',
    items: [
      { href: '/settings/forms', label: 'Formulários', description: 'NPS, escala, texto e sim/não', keywords: 'pesquisa nps satisfação formulário' },
    ],
  },
  {
    title: 'Sistema', icon: Settings2, description: 'Documentação e manutenção.',
    items: [
      { href: '/settings/documentacao', label: 'Documentação do sistema', description: 'Produto, técnico, fluxos, banco e plano', keywords: 'documentação manual ajuda' },
      { href: '/settings/resetar', label: 'Zona de risco', description: 'Resetar o CRM da empresa', keywords: 'resetar apagar excluir exportar backup' },
    ],
  },
]

// minúsculas e sem acento, para "renovacao" achar "renovação"
const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

function matches(item: Item, box: Box, terms: string[]): boolean {
  const hay = norm(`${item.label} ${item.description} ${item.keywords ?? ''} ${box.title}`)
  return terms.every(t => hay.includes(t))
}

// Só o que a empresa usa: item cuja aba não está no plano (ou no perfil) não aparece
function visibleBoxes(features: string[]): Box[] {
  const ok = (it: Item) => it.anyOf ? it.anyOf.some(f => features.includes(f)) : (() => { const k = featureForPath(it.href); return !k || features.includes(k) })()
  return BOXES.map(b => ({ ...b, items: b.items.filter(ok) })).filter(b => b.items.length > 0)
}

export function SettingsBoxes({ features }: { features: string[] }) {
  const boxes = useMemo(() => visibleBoxes(features), [features])
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')
  const terms = useMemo(() => norm(q).split(/\s+/).filter(Boolean), [q])
  const searching = terms.length > 0
  const hits = useMemo(() => {
    const set = new Set<string>()
    if (searching) for (const b of boxes) for (const it of b.items) if (matches(it, b, terms)) set.add(it.href)
    return set
  }, [terms, searching, boxes])
  const boxHits = boxes.filter(b => b.items.some(it => hits.has(it.href))).length
  const first = boxes.flatMap(b => b.items).find(it => hits.has(it.href))

  return (
    <div className="space-y-4">
      <div className="max-w-xl">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') setQ('')
              if (e.key === 'Enter' && first) router.push(first.href)
            }}
            placeholder="Pesquisar nas configurações (ex.: renovação, WhatsApp, metas)"
            aria-label="Pesquisar nas configurações"
            className="w-full rounded-xl border border-gray-300 bg-white py-2.5 pl-9 pr-9 text-sm focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
          {q && (
            <button type="button" onClick={() => { setQ(''); inputRef.current?.focus() }} aria-label="Limpar pesquisa"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-700">
              <X size={14} />
            </button>
          )}
        </div>
        {searching && (
          <p className="mt-1.5 text-xs text-gray-500">
            {hits.size
              ? `${hits.size} ${hits.size === 1 ? 'item' : 'itens'} em ${boxHits} ${boxHits === 1 ? 'quadro' : 'quadros'}. Enter abre o primeiro.`
              : 'Nada encontrado. Tente outra palavra.'}
          </p>
        )}
      </div>

      <div className="gap-4 md:columns-2 xl:columns-3">
      {boxes.map(box => {
        const Icon = box.icon
        const boxHit = box.items.some(it => hits.has(it.href))
        const dim = searching && !boxHit
        return (
          <section key={box.title} className={`mb-4 flex break-inside-avoid flex-col rounded-2xl border bg-white p-4 transition ${
            boxHit ? 'border-warn-600 ring-2 ring-warn-600/30' : 'border-gray-200'} ${dim ? 'opacity-40' : ''}`}>
            <div className="flex items-start gap-3">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${boxHit ? 'bg-warn-600 text-white' : 'bg-brand-100 text-brand-700'}`}><Icon size={18} strokeWidth={1.75} /></span>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">{box.title}</h2>
                <p className="text-xs text-gray-500">{box.description}</p>
              </div>
            </div>
            <ul className="mt-3 divide-y divide-gray-100">
              {box.items.map(item => {
                const hit = hits.has(item.href)
                return (
                  <li key={item.href}>
                    <Link href={item.href} className={`group flex items-center justify-between gap-3 rounded-lg px-2 py-2 ${
                      hit ? 'bg-accent-cream/70 hover:bg-accent-cream' : 'hover:bg-gray-50'}`}>
                      <span className="min-w-0">
                        <span className={`block text-sm group-hover:text-brand-700 ${hit ? 'font-semibold text-gray-900' : 'text-gray-800'}`}>{item.label}</span>
                        <span className="block truncate text-[11px] text-gray-500">{item.description}</span>
                      </span>
                      <span aria-hidden="true" className={hit ? 'text-warn-700' : 'text-gray-300 group-hover:text-brand-700'}>›</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
      </div>
    </div>
  )
}
