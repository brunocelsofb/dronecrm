// Aba "Como funciona" da tela Marketing: o passo a passo na prática e as
// ferramentas de tráfego pago que conversam com o CRM, com o que já funciona
// e o que ainda não. Texto neutro (vale para qualquer empresa).

type Status = 'pronto' | 'ponte' | 'manual' | 'futuro'
const BADGE: Record<Status, { label: string; cls: string }> = {
  pronto: { label: 'Funciona hoje', cls: 'bg-positive-100 text-positive-700' },
  ponte: { label: 'Via Zapier/Make', cls: 'bg-brand-100 text-brand-800' },
  manual: { label: 'Lançamento manual', cls: 'bg-warn-600/15 text-warn-700' },
  futuro: { label: 'Ainda não', cls: 'bg-gray-100 text-gray-600' },
}

const STEPS: { title: string; text: string; where: string }[] = [
  { title: 'Cadastre a campanha', text: 'Nome, canal (Meta, Google, LinkedIn…), público (novos clientes ou carteira), período, verba e objetivo. O CRM cria um código para o link.', where: 'Marketing → Campanhas → + Nova campanha' },
  { title: 'Pegue o link da campanha', text: 'Escolha a campanha e copie o link. Se o anúncio levar para uma página do site, cole o endereço da página e copie a versão com a origem.', where: 'Marketing → Links e formulário' },
  { title: 'Cole o link no anúncio', text: 'No gerenciador de anúncios (Meta, Google, LinkedIn), no e-mail, no post ou no QR Code do evento, use o link copiado como destino.', where: 'Fora do CRM — na plataforma do anúncio' },
  { title: 'O lead entra sozinho (inbound)', text: 'Quem preenche vira lead já ligado à campanha, com canal e página de onde veio. Ele chega para o marketing qualificar.', where: 'Marketing → Leads inbound' },
  { title: 'Marketing passa ao comercial', text: 'Lead qualificado: "Passar para o comercial", escolhendo o Hunter. Ele aparece na aba Leads do comercial, que converte em oportunidade; a campanha vai junto.', where: 'Marketing → Leads inbound → Passar · Leads → Converter' },
  { title: 'Lance o investimento do mês', text: 'Todo mês, informe quanto foi gasto em cada campanha (o valor da fatura da plataforma de anúncios).', where: 'Marketing → Campanhas → Investimento por mês' },
  { title: 'Acompanhe até o faturado', text: 'Veja leads, oportunidades, ganhos e o faturado de cada campanha, com custo por lead, CAC e retorno (ROAS). Pause o que não dá retorno, reforce o que dá.', where: 'Marketing → Resultados' },
]

const TOOLS: { name: string; what: string; status: Status; how: string }[] = [
  { name: 'Meta Ads (Facebook e Instagram)', what: 'Anúncios no feed, stories e reels.', status: 'pronto', how: 'Use o link da campanha como destino do anúncio. O CRM guarda a origem e o clique do Meta (fbclid).' },
  { name: 'Meta Lead Ads (formulário dentro do anúncio)', what: 'A pessoa preenche sem sair do Facebook/Instagram.', status: 'ponte', how: 'Configurações → Integrações → Anúncios → Facebook / Instagram Lead Ads: endereço próprio + passo a passo no Zapier/Make. Ligação direta depende de aprovação do Meta.' },
  { name: 'Google Ads (Pesquisa, Display, YouTube)', what: 'Anúncios no Google, em sites parceiros e no YouTube.', status: 'pronto', how: 'Use o link da campanha. Com a marcação automática do Google ligada, o CRM guarda também o clique do Google (gclid).' },
  { name: 'Formulário de lead do Google Ads', what: 'Formulário dentro do anúncio do Google.', status: 'pronto', how: 'Configurações → Integrações → Anúncios: o Google Ads manda direto para o endereço do CRM (webhook). Teste com "Enviar dados de teste".' },
  { name: 'LinkedIn Ads', what: 'Anúncios para decisores por cargo, setor e empresa — forte no B2B.', status: 'pronto', how: 'Use o link da campanha (sai marcado como LinkedIn).' },
  { name: 'LinkedIn Lead Gen Forms', what: 'Formulário dentro do anúncio do LinkedIn.', status: 'ponte', how: 'Configurações → Integrações → Anúncios → LinkedIn Lead Gen Forms (via Zapier/Make). Ligação direta depende de aprovação do LinkedIn.' },
  { name: 'RD Station Marketing', what: 'E-mail, landing pages e automação.', status: 'pronto', how: 'Receber: o webhook do RD manda cada conversão para o CRM, sem duplicar o lead. Enviar: conecte a chave de API em Configurações → Integrações → RD Station e envie as listas em Marketing → Listas e e-mail.' },
  { name: 'Mailchimp', what: 'E-mail marketing.', status: 'pronto', how: 'Receber: novos inscritos viram leads e descadastros entram na lista de descadastrados. Enviar: conecte a chave de API em Configurações → Integrações → Mailchimp e envie as listas em Marketing → Listas e e-mail.' },
  { name: 'Site, WordPress e Google Forms', what: 'Formulários do site e do Google.', status: 'pronto', how: 'Configurações → Integrações → Site e formulários: endereço, passo a passo e código pronto para cada um.' },
  { name: 'Botão de WhatsApp no site', what: 'Botão flutuante: a pessoa deixa os dados e abre o WhatsApp.', status: 'pronto', how: 'Configurações → Integrações → Site e formulários → Botão de WhatsApp: informe o número e cole o código no site.' },
  { name: 'Anúncio que abre o WhatsApp direto', what: 'Clique no anúncio inicia conversa no WhatsApp da empresa.', status: 'manual', how: 'A conversa chega no WhatsApp do CRM; ao virar lead, escolha a campanha no lead. Identificação automática da campanha: ainda não.' },
  { name: 'Zapier / Make', what: 'Ligam ao CRM ferramentas que não estão na lista.', status: 'pronto', how: 'Configurações → Integrações → Zapier / Make: endereço próprio, envio em JSON.' },
  { name: 'Investimento das plataformas', what: 'Quanto foi gasto em cada campanha.', status: 'manual', how: 'Lançado mês a mês na campanha. Meta: com a conta conectada (aba Anúncios (Meta)), o gasto de cada mês entra sozinho. Google e LinkedIn: ainda manual.' },
  { name: 'Devolver vendas às plataformas', what: 'Avisar Meta/Google/LinkedIn quais leads viraram cliente, para os anúncios mirarem em quem compra.', status: 'futuro', how: 'Próxima etapa. O CRM já guarda os cliques (gclid/fbclid) necessários.' },
  { name: 'E-mail marketing em massa', what: 'Disparos para listas, respeitando descadastros.', status: 'pronto', how: 'Monte a lista em Marketing → Listas e e-mail e envie ao Mailchimp ou ao RD Station; o e-mail é escrito e disparado lá. Aberturas e cliques ficam no relatório da ferramenta (trazer para o CRM: próxima etapa).' },
]

const TERMS: [string, string][] = [
  ['UTM', 'Etiquetas no final do link (utm_source, utm_campaign…) que dizem de onde a pessoa veio. O CRM gera para você.'],
  ['gclid / fbclid', 'Código do clique que o Google e o Meta colocam no link. Serve para provar qual anúncio trouxe o cliente.'],
  ['Custo por lead', 'Investimento ÷ leads.'],
  ['CAC', 'Custo para conquistar um cliente: investimento ÷ clientes ganhos.'],
  ['ROAS', 'Retorno: faturado ÷ investimento. 3,0x = cada R$ 1,00 investido voltou R$ 3,00 faturados.'],
]

export function MarketingGuide() {
  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">Na prática: da campanha ao faturado</h2>
        <p className="mt-1 text-sm text-gray-500">O caminho completo de um anúncio até o dinheiro no caixa, e onde cada passo acontece no CRM.</p>
        <ol className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-xl bg-gray-50 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-700 text-xs text-white">{i + 1}</span>
                {s.title}
              </p>
              <p className="mt-1.5 text-xs text-gray-600">{s.text}</p>
              <p className="mt-2 text-[11px] font-medium text-brand-700">{s.where}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="px-5 pt-5">
          <h2 className="text-base font-semibold text-gray-900">Ferramentas de tráfego pago e o CRM</h2>
          <p className="mt-1 text-sm text-gray-500">O que já conversa com o CRM, o que passa por Zapier/Make e o que ainda vem.</p>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Ferramenta</th>
                <th className="px-4 py-2 text-left font-medium">Situação</th>
                <th className="px-4 py-2 text-left font-medium">Como usar com o CRM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {TOOLS.map(t => (
                <tr key={t.name} className="align-top">
                  <td className="min-w-52 px-4 py-2.5">
                    <p className="font-medium text-gray-900">{t.name}</p>
                    <p className="text-xs text-gray-500">{t.what}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[11px] ${BADGE[t.status].cls}`}>{BADGE[t.status].label}</span></td>
                  <td className="min-w-64 px-4 py-2.5 text-xs text-gray-700">{t.how}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">Termos usados nesta tela</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TERMS.map(([k, v]) => (
            <div key={k}>
              <dt className="text-sm font-medium text-gray-900">{k}</dt>
              <dd className="text-xs text-gray-600">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
