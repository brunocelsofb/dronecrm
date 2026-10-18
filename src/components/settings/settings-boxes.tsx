// Configurações: cada assunto no seu quadro (usado pela página /settings).
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { Building2, Users, KanbanSquare, Target, Briefcase, FileText, PenLine, Mail, MessageCircle, BrainCircuit, ClipboardList, Plug, Settings2 } from 'lucide-react'

type Item = { href: string; label: string; description: string }
type Box = { title: string; description: string; icon: LucideIcon; items: Item[] }

const BOXES: Box[] = [
  {
    title: 'Empresa', icon: Building2, description: 'Quem é a empresa no CRM e as metas.',
    items: [
      { href: '/settings/empresa', label: 'Dados da empresa', description: 'Logo, nome, CNPJ e visual das propostas' },
      { href: '/settings/metas', label: 'Metas de receita', description: 'Meta mês a mês e prazo do relatório de medição' },
      { href: '/settings/protocolos', label: 'Numeração de chamados e propostas', description: 'Prefixo e próximo número' },
      { href: '/settings/wallpapers', label: 'Papéis de parede', description: 'Fundo do login e das páginas públicas' },
    ],
  },
  {
    title: 'Equipe e acesso', icon: Users, description: 'Quem usa o CRM e o que cada um vê.',
    items: [
      { href: '/users', label: 'Usuários', description: 'Cadastro, papel, perfil e departamento' },
      { href: '/settings/perfis-acesso', label: 'Perfis de acesso', description: 'Abas de cada perfil (Gestor, Hunter, Farmer…)' },
      { href: '/settings/price-users', label: 'Usuários do Price', description: 'Aprovadores e precificadores da precificação' },
      { href: '/minha-conta', label: 'Minha conta', description: 'Seus dados, Gmail e assinatura de e-mail' },
    ],
  },
  {
    title: 'Funis e oportunidades', icon: KanbanSquare, description: 'Como as oportunidades andam no funil.',
    items: [
      { href: '/pipelines', label: 'Funis e etapas', description: 'Funis e etapas do processo' },
      { href: '/settings/campos-oportunidade', label: 'Campos por funil', description: 'Obrigatórios e opcionais em cada funil' },
      { href: '/custom-fields', label: 'Campos customizados', description: 'Campos extras das oportunidades' },
      { href: '/settings/layout-abas', label: 'Layout das abas', description: 'Ordem e visibilidade das abas por funil' },
      { href: '/settings/motivos-perda', label: 'Motivos de perda', description: 'Lista exigida ao marcar perda' },
      { href: '/settings/numeracao', label: 'Numeração de oportunidades', description: 'Prefixo e sequência automática' },
      { href: '/tags', label: 'Tags', description: 'Etiquetas para classificar' },
      { href: '/automations', label: 'Automações', description: 'Regras por gatilho ou tempo' },
    ],
  },
  {
    title: 'Leads', icon: Target, description: 'Como os leads são priorizados e distribuídos.',
    items: [
      { href: '/settings/lead-scoring', label: 'Pontuação de leads', description: 'Critérios e pontos' },
      { href: '/settings/lead-routing', label: 'Roteamento de leads', description: 'Regras de funil e responsável' },
    ],
  },
  {
    title: 'Contratos e carteira', icon: Briefcase, description: 'Gestão dos contratos depois do ganho.',
    items: [
      { href: '/settings/carteira', label: 'Gestão da carteira', description: 'Campos da aba de dados da carteira' },
      { href: '/settings/curva-abc', label: 'Curva ABC', description: 'Faixas A, B e C por natureza' },
      { href: '/settings/implementation-templates', label: 'Modelos de implantação', description: 'Cronogramas padrão de implantação' },
    ],
  },
  {
    title: 'Propostas', icon: FileText, description: 'Modelos e itens das propostas comerciais.',
    items: [
      { href: '/proposals/templates', label: 'Modelos de proposta', description: 'Templates de proposta comercial' },
      { href: '/proposals/catalog', label: 'Catálogo de produtos', description: 'Produtos e serviços das propostas' },
    ],
  },
  {
    title: 'Assinatura digital', icon: PenLine, description: 'Contratos e aditivos pela ZapSign.',
    items: [
      { href: '/settings/zapsign', label: 'ZapSign', description: 'Avisos de assinatura, token e ambiente' },
      { href: '/zapsign', label: 'Modelos ZapSign', description: 'Modelos de contrato e aditivo' },
    ],
  },
  {
    title: 'E-mail', icon: Mail, description: 'Modelos e respostas dos clientes.',
    items: [
      { href: '/email-templates', label: 'Modelos de e-mail', description: 'Textos prontos de e-mail e WhatsApp' },
      { href: '/settings/email', label: 'Recebimento de e-mail', description: 'Respostas do cliente caindo na oportunidade' },
    ],
  },
  {
    title: 'WhatsApp', icon: MessageCircle, description: 'Números da empresa e atendimento automático.',
    items: [
      { href: '/settings/whatsapp-conexoes', label: 'Conexões', description: 'Números conectados (QR Code) e apelidos' },
      { href: '/settings/whatsapp-bot', label: 'Bot e automações', description: 'Boas-vindas e status online/offline' },
    ],
  },
  {
    title: 'Inteligência artificial', icon: BrainCircuit, description: 'Agentes Farmer e Hunter, o assistente e o SDR de IA.',
    items: [
      { href: '/settings/copiloto', label: 'Agentes IA (Farmer e Hunter)', description: 'Chave da IA, gestor e avisos de renovação' },
      { href: '/settings/assistente', label: 'Assistente Théo', description: 'Limite de gasto mensal' },
      { href: '/settings/sdr', label: 'SDR de IA', description: 'Assistente no WhatsApp que qualifica e passa leads' },
    ],
  },
  {
    title: 'Integrações', icon: Plug, description: 'Escolha e configure as ferramentas que conversam com o CRM.',
    items: [
      { href: '/settings/integracoes', label: 'Integrações', description: 'Faturamento (Sankhya, TOTVS…), anúncios, RD Station, Mailchimp, site' },
    ],
  },
  {
    title: 'Pesquisas', icon: ClipboardList, description: 'Satisfação e NPS dos clientes.',
    items: [
      { href: '/settings/forms', label: 'Formulários', description: 'NPS, escala, texto e sim/não' },
    ],
  },
  {
    title: 'Sistema', icon: Settings2, description: 'Documentação e manutenção.',
    items: [
      { href: '/settings/documentacao', label: 'Documentação do sistema', description: 'Produto, técnico, fluxos, banco e plano' },
      { href: '/settings/resetar', label: 'Zona de risco', description: 'Resetar o CRM da empresa' },
    ],
  },
]

export function SettingsBoxes() {
  return (
    <div className="gap-4 md:columns-2 xl:columns-3">
      {BOXES.map(box => {
        const Icon = box.icon
        return (
          <section key={box.title} className="mb-4 flex break-inside-avoid flex-col rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700"><Icon size={18} strokeWidth={1.75} /></span>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">{box.title}</h2>
                <p className="text-xs text-gray-500">{box.description}</p>
              </div>
            </div>
            <ul className="mt-3 divide-y divide-gray-100">
              {box.items.map(item => (
                <li key={item.href}>
                  <Link href={item.href} className="group flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-gray-50">
                    <span className="min-w-0">
                      <span className="block text-sm text-gray-800 group-hover:text-brand-700">{item.label}</span>
                      <span className="block truncate text-[11px] text-gray-500">{item.description}</span>
                    </span>
                    <span aria-hidden="true" className="text-gray-300 group-hover:text-brand-700">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

