export const metadata = {
  title: 'Política de Privacidade — Comercial Drone',
  description: 'Política de Privacidade do CRM Comercial Drone, desenvolvido pela 2B Soluções Comerciais.',
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white py-16 px-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Política de Privacidade</h1>
        <p className="text-sm text-gray-500 mb-10">Última atualização: outubro de 2026</p>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">1. Identificação do Responsável</h2>
          <p className="text-gray-600 leading-relaxed">
            Esta Política de Privacidade se aplica ao sistema de gestão de contratos <strong>Comercial Drone CRM</strong>,
            operado pela <strong>2B Soluções Comerciais</strong>, empresa inscrita no CNPJ/MF, com sede no Brasil.
            O sistema é acessado em <strong>https://app.comercialdrone.com.br</strong> e
            destina-se ao uso da equipe comercial para gerenciar contratos, clientes e processos comerciais.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">2. Dados Coletados</h2>
          <p className="text-gray-600 leading-relaxed mb-3">
            O sistema coleta e processa as seguintes categorias de dados:
          </p>
          <ul className="list-disc pl-6 text-gray-600 space-y-2">
            <li><strong>Dados de autenticação:</strong> endereço de e-mail e credenciais de acesso dos usuários internos, via Google OAuth 2.0.</li>
            <li><strong>Dados de clientes e empresas:</strong> razão social, CNPJ, endereço, telefone e e-mail de contato, fornecidos manualmente pela equipe.</li>
            <li><strong>Dados contratuais:</strong> número de processo, valores, datas de vigência, documentos vinculados.</li>
            <li><strong>Dados de comunicação:</strong> registros de envios de e-mail e WhatsApp realizados pelo sistema de alertas automáticos.</li>
            <li><strong>Dados de uso:</strong> logs de acesso e atividade no sistema, armazenados para fins de auditoria interna.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">3. Finalidade do Tratamento</h2>
          <p className="text-gray-600 leading-relaxed mb-3">Os dados são utilizados exclusivamente para:</p>
          <ul className="list-disc pl-6 text-gray-600 space-y-2">
            <li>Gerenciar o ciclo de vida dos contratos comerciais;</li>
            <li>Enviar alertas automáticos de vencimento de contratos aos responsáveis internos e clientes;</li>
            <li>Registrar e acompanhar o pipeline comercial e de retenção;</li>
            <li>Autenticar usuários autorizados via Google OAuth 2.0 para acesso ao sistema;</li>
            <li>Enviar e receber e-mails transacionais e notificações via WhatsApp Business.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">4. Uso do Google OAuth 2.0</h2>
          <p className="text-gray-600 leading-relaxed mb-3">
            O sistema utiliza o Google OAuth 2.0 para autenticação de usuários internos e para o envio
            de e-mails transacionais via Gmail API. O acesso solicitado à API do Google é limitado a:
          </p>
          <ul className="list-disc pl-6 text-gray-600 space-y-2">
            <li><strong>gmail.send:</strong> permissão para enviar e-mails em nome do usuário autenticado (ex.: notificações de vencimento de contrato).</li>
          </ul>
          <p className="text-gray-600 leading-relaxed mt-3">
            O sistema <strong>não lê, armazena nem acessa</strong> o conteúdo da caixa de entrada, contatos
            ou qualquer outro dado da conta Google além do necessário para envio de e-mails.
            Os tokens de acesso OAuth são armazenados de forma criptografada no banco de dados e
            utilizados apenas para as finalidades descritas acima.
          </p>
          <p className="text-gray-600 leading-relaxed mt-3">
            O uso das informações recebidas das APIs do Google seguirá a
            <a href="https://developers.google.com/terms/api-services-user-data-policy" className="text-blue-600 underline ml-1" target="_blank" rel="noopener noreferrer">
              Política de Dados do Usuário dos Serviços de API do Google
            </a>, incluindo os requisitos de Uso Limitado.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">5. Compartilhamento de Dados</h2>
          <p className="text-gray-600 leading-relaxed">
            Os dados tratados pelo sistema <strong>não são comercializados, cedidos ou compartilhados</strong> com
            terceiros, salvo nas seguintes situações estritamente necessárias para o funcionamento do sistema:
          </p>
          <ul className="list-disc pl-6 text-gray-600 space-y-2 mt-3">
            <li><strong>Supabase</strong> (banco de dados e autenticação) — infraestrutura de armazenamento seguro;</li>
            <li><strong>Vercel</strong> (hospedagem da aplicação) — provedor de infraestrutura;</li>
            <li><strong>Google APIs</strong> (OAuth e Gmail) — para autenticação e envio de e-mails;</li>
            <li><strong>Evolution API / WhatsApp Business</strong> — para envio de notificações via WhatsApp.</li>
          </ul>
          <p className="text-gray-600 leading-relaxed mt-3">
            Todos esses fornecedores possuem suas próprias políticas de privacidade e adotam medidas
            de segurança adequadas para proteção dos dados.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">6. Retenção dos Dados</h2>
          <p className="text-gray-600 leading-relaxed">
            Os dados são retidos pelo tempo necessário ao cumprimento das finalidades descritas nesta
            política ou conforme exigido por obrigações legais e contratuais. Dados de contratos
            encerrados podem ser mantidos por até 5 (cinco) anos para fins de auditoria e conformidade.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">7. Segurança</h2>
          <p className="text-gray-600 leading-relaxed">
            Adotamos medidas técnicas e organizacionais para proteger os dados contra acesso não
            autorizado, alteração, divulgação ou destruição, incluindo: autenticação OAuth 2.0,
            criptografia em trânsito (HTTPS/TLS), Row-Level Security (RLS) no banco de dados e
            controle de acesso por perfil de usuário.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">8. Direitos dos Titulares</h2>
          <p className="text-gray-600 leading-relaxed">
            Nos termos da Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018), os titulares
            dos dados têm direito a: confirmação de tratamento, acesso, correção, anonimização,
            portabilidade, eliminação e revogação do consentimento. Para exercer esses direitos,
            entre em contato pelo e-mail abaixo.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">9. Contato</h2>
          <p className="text-gray-600 leading-relaxed">
            Dúvidas sobre esta Política de Privacidade podem ser enviadas para:<br />
            <strong>E-mail:</strong>{' '}
            <a href="mailto:contato@comercialdrone.com.br" className="text-blue-600 underline">
              contato@comercialdrone.com.br
            </a>
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">10. Alterações</h2>
          <p className="text-gray-600 leading-relaxed">
            Esta política pode ser atualizada periodicamente. A data da última revisão está indicada
            no topo deste documento. O uso continuado do sistema após alterações implica aceitação
            da versão vigente.
          </p>
        </section>

        <hr className="border-gray-200 mt-12 mb-6" />
        <p className="text-xs text-gray-400 text-center">
          2B Soluções Comerciais · Comercial Drone CRM · app.comercialdrone.com.br ·{' '}
          <a href="/contrato-de-dados" className="underline">Contrato de tratamento de dados</a>
        </p>
      </div>
    </main>
  )
}
