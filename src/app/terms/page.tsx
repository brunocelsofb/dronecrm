export const metadata = {
  title: 'Termos de Uso — Comercial Drone',
  description: 'Termos de Uso do CRM Comercial Drone, desenvolvido pela 2B Soluções Comerciais.',
}

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-white py-16 px-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Termos de Uso</h1>
        <p className="text-sm text-gray-500 mb-10">Última atualização: 29 de outubro de 2026</p>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">1. Aceitação dos Termos</h2>
          <p className="text-gray-600 leading-relaxed">
            Ao acessar ou utilizar o <strong>Comercial Drone CRM</strong>, operado pela
            <strong> 2B Soluções Comerciais Ltda</strong> (CNPJ 43.038.578/0001-40), você concorda com estes Termos de Uso.
            Caso não concorde com qualquer disposição aqui prevista, não utilize o sistema.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">2. Descrição do Serviço</h2>
          <p className="text-gray-600 leading-relaxed">
            O Comercial Drone CRM é um sistema de gestão comercial (CRM) vendido por licença a empresas,
            acessado em <strong>https://app.comercialdrone.com.br</strong>. Inclui funil comercial, leads,
            marketing, contratos, propostas, loja (varejo), WhatsApp, e-mail e integrações com ferramentas de
            terceiros (como Meta, Google e LinkedIn) que cada empresa escolhe ligar.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">3. Uso Autorizado</h2>
          <p className="text-gray-600 leading-relaxed mb-3">O sistema destina-se exclusivamente ao uso por:</p>
          <ul className="list-disc pl-6 text-gray-600 space-y-2">
            <li>Usuários internos da 2B Soluções Comerciais devidamente cadastrados;</li>
            <li>Parceiros e colaboradores autorizados pelo administrador do sistema.</li>
          </ul>
          <p className="text-gray-600 leading-relaxed mt-3">
            É vedado o uso do sistema para fins ilícitos, compartilhamento de credenciais de acesso,
            ou qualquer ação que comprometa a segurança ou integridade da plataforma.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">4. Autenticação e Segurança</h2>
          <p className="text-gray-600 leading-relaxed">
            O acesso ao sistema é realizado via Google OAuth 2.0. O usuário é responsável pela
            segurança de sua conta Google e deve notificar imediatamente a 2B Soluções Comerciais
            em caso de uso não autorizado. A 2B Soluções Comerciais não se responsabiliza por
            danos decorrentes do uso indevido de credenciais pelo próprio usuário.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">5. Propriedade Intelectual</h2>
          <p className="text-gray-600 leading-relaxed">
            Todo o conteúdo, código-fonte, design e funcionalidades do Comercial Drone CRM são
            propriedade da <strong>2B Soluções Comerciais</strong>. É proibida a reprodução,
            distribuição ou modificação sem autorização prévia e expressa.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">6. Disponibilidade do Serviço</h2>
          <p className="text-gray-600 leading-relaxed">
            A 2B Soluções Comerciais envida seus melhores esforços para manter o sistema disponível,
            mas não garante disponibilidade ininterrupta. Manutenções programadas ou emergenciais
            poderão ocorrer sem aviso prévio. Não nos responsabilizamos por perdas decorrentes de
            indisponibilidade temporária.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">7. Limitação de Responsabilidade</h2>
          <p className="text-gray-600 leading-relaxed">
            A 2B Soluções Comerciais não se responsabiliza por danos indiretos, incidentais ou
            consequentes decorrentes do uso ou impossibilidade de uso do sistema, incluindo perda
            de dados, lucros cessantes ou interrupção de negócios.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">7-A. Integrações com terceiros (Meta, Google e outras)</h2>
          <p className="text-gray-600 leading-relaxed">
            Ao conectar uma conta de terceiros (por exemplo, &quot;Continuar com o Facebook&quot;), o usuário declara ter
            autorização da empresa para isso e para as permissões concedidas. O uso dessas integrações também segue os
            termos e políticas do terceiro (como os Termos da Plataforma do Meta). A empresa pode desconectar a qualquer
            momento no sistema; os dados recebidos são tratados conforme a <a href="/privacy" className="underline">Política de Privacidade</a> e
            podem ser excluídos como descrito em <a href="/exclusao-de-dados" className="underline">Exclusão de dados</a>.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">8. Privacidade</h2>
          <p className="text-gray-600 leading-relaxed">
            O tratamento de dados pessoais é regido pela nossa{' '}
            <a href="/privacy" className="text-blue-600 underline">
              Política de Privacidade
            </a>
            , que faz parte integrante destes Termos de Uso.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">9. Alterações nos Termos</h2>
          <p className="text-gray-600 leading-relaxed">
            Estes Termos de Uso podem ser atualizados a qualquer momento. A data da última revisão
            está indicada no topo deste documento. O uso continuado do sistema após alterações
            implica aceitação da versão vigente.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">10. Foro e Lei Aplicável</h2>
          <p className="text-gray-600 leading-relaxed">
            Estes Termos são regidos pelas leis brasileiras. Fica eleito o foro da comarca da
            sede da 2B Soluções Comerciais para dirimir quaisquer controvérsias decorrentes
            deste instrumento.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-3">11. Contato</h2>
          <p className="text-gray-600 leading-relaxed">
            Dúvidas sobre estes Termos de Uso podem ser enviadas para:<br />
            <strong>E-mail:</strong>{' '}
            <a href="mailto:contato@comercialdrone.com.br" className="text-blue-600 underline">
              contato@comercialdrone.com.br
            </a>
          </p>
        </section>

        <hr className="border-gray-200 mt-12 mb-6" />
        <p className="text-xs text-gray-400 text-center">
          2B Soluções Comerciais · Comercial Drone CRM · app.comercialdrone.com.br
        </p>
      </div>
    </main>
  )
}
