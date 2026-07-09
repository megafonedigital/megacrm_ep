import { createFileRoute, Link } from "@tanstack/react-router";

const CANONICAL = "https://megacrm.megafone.digital/privacidade";
const UPDATED_AT = "21 de maio de 2026";

export const Route = createFileRoute("/privacidade")({
  component: PrivacyPolicyPage,
  head: () => ({
    meta: [
      { title: "Política de Privacidade — MegaCRM" },
      {
        name: "description",
        content:
          "Política de Privacidade do MegaCRM (Megafone Negócios Digitais Ltda.) em conformidade com a LGPD e as políticas da Meta para o WhatsApp Business Cloud API.",
      },
      { property: "og:title", content: "Política de Privacidade — MegaCRM" },
      {
        property: "og:description",
        content:
          "Como o MegaCRM coleta, usa, compartilha e protege dados pessoais de Clientes e Usuários Finais.",
      },
      { property: "og:url", content: CANONICAL },
      { property: "og:type", content: "article" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
});

const sections = [
  { id: "introducao", label: "1. Introdução" },
  { id: "definicoes", label: "2. Definições" },
  { id: "papeis", label: "3. Papéis no tratamento de dados" },
  { id: "dados", label: "4. Dados que coletamos" },
  { id: "finalidades", label: "5. Finalidades e bases legais" },
  { id: "whatsapp", label: "6. WhatsApp Business Platform" },
  { id: "compartilhamento", label: "7. Compartilhamento com terceiros" },
  { id: "transferencia", label: "8. Transferência internacional" },
  { id: "seguranca", label: "9. Segurança da informação" },
  { id: "retencao", label: "10. Retenção de dados" },
  { id: "direitos", label: "11. Direitos do titular" },
  { id: "criancas", label: "12. Crianças e adolescentes" },
  { id: "cookies", label: "13. Cookies" },
  { id: "alteracoes", label: "14. Alterações desta Política" },
  { id: "contato", label: "15. Encarregado e contato" },
  { id: "links", label: "16. Referências" },
];

function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-lg font-bold tracking-tight">
            MegaCRM
          </Link>
          <Link
            to="/login"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Voltar
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Política de Privacidade
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Última atualização: {UPDATED_AT}
        </p>

        <nav
          aria-label="Índice"
          className="mt-8 rounded-lg border border-border bg-muted/30 p-5"
        >
          <p className="mb-3 text-sm font-semibold">Índice</p>
          <ol className="grid gap-1 text-sm sm:grid-cols-2">
            {sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="text-muted-foreground hover:text-foreground hover:underline"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="prose-content mt-10 space-y-10 text-[15px] leading-relaxed">
          <Section id="introducao" title="1. Introdução">
            <p>
              Esta Política de Privacidade descreve como a{" "}
              <strong>MEGAFONE NEGÓCIOS DIGITAIS LTDA.</strong>, inscrita no
              CNPJ sob o nº <strong>21.854.438/0001-07</strong>, com sede na
              Al. Rio Negro, 500, Andar 5, Sala 501 a 508, Torre B, Alphaville
              Centro Industrial e Empresarial, Barueri/SP, CEP 06.454-000
              ("Megafone", "nós"), coleta, utiliza, armazena, compartilha e
              protege dados pessoais no âmbito do <strong>MegaCRM</strong> — uma
              plataforma de CRM omnichannel que integra o WhatsApp Business
              através da Cloud API oficial da Meta, além de outros canais de
              atendimento e automação.
            </p>
            <p>
              Esta Política aplica-se a todos os Clientes (empresas que
              contratam o MegaCRM), aos seus colaboradores que utilizam a
              plataforma (administradores, supervisores, atendentes e
              desenvolvedores) e aos Usuários Finais (pessoas que se comunicam
              com o Cliente por meio dos canais integrados ao MegaCRM). Foi
              elaborada em conformidade com a Lei nº 13.709/2018 (LGPD), com a
              Política da Plataforma do WhatsApp Business, com os Termos do
              WhatsApp Business Solution e com os requisitos aplicáveis a Tech
              Providers da Meta.
            </p>
          </Section>

          <Section id="definicoes" title="2. Definições">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Plataforma:</strong> o software MegaCRM, disponibilizado
                em modelo SaaS pela Megafone.
              </li>
              <li>
                <strong>Cliente:</strong> pessoa jurídica que contrata o
                MegaCRM e administra um ou mais workspaces.
              </li>
              <li>
                <strong>Usuário da Plataforma:</strong> pessoa física vinculada
                a um Cliente que acessa o MegaCRM (administrador, supervisor,
                atendente, desenvolvedor).
              </li>
              <li>
                <strong>Usuário Final:</strong> pessoa que se comunica com o
                Cliente por meio dos canais integrados (por exemplo, um
                contato de WhatsApp).
              </li>
              <li>
                <strong>Dados Pessoais:</strong> qualquer informação
                relacionada a pessoa natural identificada ou identificável.
              </li>
              <li>
                <strong>Tratamento:</strong> toda operação realizada com dados
                pessoais, conforme art. 5º, X da LGPD.
              </li>
              <li>
                <strong>Controlador e Operador:</strong> conforme definidos nos
                incisos VI e VII do art. 5º da LGPD.
              </li>
            </ul>
          </Section>

          <Section id="papeis" title="3. Papéis no tratamento de dados">
            <p>
              A Megafone atua em papéis distintos conforme o tipo de dado
              tratado:
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Operadora</strong> em relação aos Dados Pessoais dos
                Usuários Finais e ao conteúdo das mensagens trocadas via canais
                integrados. Nesses casos, a Megafone trata os dados em nome e
                conforme instruções do Cliente, que figura como Controlador.
              </li>
              <li>
                <strong>Controladora</strong> em relação aos dados cadastrais
                dos Clientes (dados de contratação, faturamento e cobrança) e
                aos dados dos Usuários da Plataforma (cadastro, autenticação,
                logs de acesso e uso da Plataforma).
              </li>
            </ul>
          </Section>

          <Section id="dados" title="4. Dados que coletamos">
            <p>Os dados tratados pelo MegaCRM incluem, conforme aplicável:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Conta de Usuário da Plataforma:</strong> nome, e-mail,
                telefone, avatar, papel/permissões, status de presença,
                preferências e logs de acesso.
              </li>
              <li>
                <strong>Workspaces e canais:</strong> nome, identificador,
                configurações, <em>phone_number_id</em>, <em>waba_id</em>,{" "}
                <em>business_id</em>, tokens de acesso à Cloud API (armazenados
                como segredos cifrados) e tokens de verificação de webhook.
              </li>
              <li>
                <strong>Conversas e mensagens:</strong> conteúdo textual,
                arquivos de mídia, status de entrega/leitura, timestamps,{" "}
                <em>wa_id</em>, <em>wa_message_id</em> e metadados associados.
              </li>
              <li>
                <strong>Contatos (Usuários Finais):</strong> nome, telefone,
                <em> wa_id</em>, tags, campos personalizados, histórico de
                atendimento e demais metadados fornecidos pelo Cliente.
              </li>
              <li>
                <strong>Dados de uso e técnicos:</strong> endereço IP,
                user-agent, identificadores de dispositivo, logs de API e
                eventos de webhook.
              </li>
              <li>
                <strong>Cookies:</strong> utilizamos apenas cookies essenciais
                para autenticação e manutenção de sessão. Não empregamos
                cookies de rastreamento publicitário de terceiros.
              </li>
            </ul>
          </Section>

          <Section id="finalidades" title="5. Finalidades e bases legais">
            <p>
              Tratamos dados pessoais apenas para finalidades legítimas,
              específicas e informadas, com fundamento nas bases legais
              previstas no art. 7º da LGPD, em especial:
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Execução de contrato</strong> (art. 7º, V) — para
                disponibilizar e operar a Plataforma e seus canais de
                comunicação.
              </li>
              <li>
                <strong>Cumprimento de obrigação legal ou regulatória</strong>{" "}
                (art. 7º, II) — incluindo guarda de registros previstos no
                Marco Civil da Internet.
              </li>
              <li>
                <strong>Legítimo interesse</strong> (art. 7º, IX) — para
                segurança, prevenção a fraudes, melhoria do produto e suporte.
              </li>
              <li>
                <strong>Consentimento</strong> (art. 7º, I) — quando aplicável,
                em especial para comunicações de marketing iniciadas pelo
                Cliente ao Usuário Final.
              </li>
            </ul>
          </Section>

          <Section id="whatsapp" title="6. WhatsApp Business Platform">
            <p>
              O MegaCRM integra-se ao WhatsApp por meio da{" "}
              <strong>Cloud API oficial</strong> disponibilizada pela Meta
              Platforms, Inc. e suas afiliadas (incluindo Meta Platforms
              Ireland Ltd.). As mensagens enviadas e recebidas trafegam pela
              infraestrutura da Meta e estão sujeitas, adicionalmente, às
              políticas de privacidade e aos termos do WhatsApp.
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                O Cliente é o responsável por obter, manter e comprovar o{" "}
                <strong>opt-in</strong> dos Usuários Finais para receber
                mensagens iniciadas por empresa, conforme exigido pelas
                políticas da Meta.
              </li>
              <li>
                O Cliente é responsável pelo conteúdo das mensagens, pelo uso
                adequado de modelos de mensagem (templates HSM) e pelo
                cumprimento das regras de qualidade e categorização da Meta.
              </li>
              <li>
                A Megafone <strong>não vende</strong> conteúdo de mensagens e{" "}
                <strong>não utiliza</strong> esse conteúdo para treinar
                modelos próprios de inteligência artificial sem instrução
                expressa do Cliente.
              </li>
              <li>
                Recursos de IA disponibilizados na Plataforma operam por
                instrução do Cliente e apenas processam dados estritamente
                necessários para executar a tarefa solicitada.
              </li>
              <li>
                As mensagens são armazenadas enquanto o canal estiver ativo,
                respeitando os prazos definidos pelo Cliente ou até solicitação
                de exclusão.
              </li>
            </ul>
          </Section>

          <Section id="compartilhamento" title="7. Compartilhamento com terceiros">
            <p>
              A Megafone compartilha dados pessoais apenas quando necessário e
              com base legal apropriada, especialmente com:
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Meta Platforms Ireland Ltd. e afiliadas</strong> —
                operação do WhatsApp Business Cloud API.
              </li>
              <li>
                <strong>Provedores de infraestrutura em nuvem</strong> —
                hospedagem de banco de dados, autenticação e armazenamento de
                arquivos, sob obrigações contratuais de confidencialidade e
                segurança.
              </li>
              <li>
                <strong>Provedores de IA</strong> — quando funcionalidades de
                inteligência artificial forem habilitadas pelo Cliente.
              </li>
              <li>
                <strong>Autoridades públicas</strong> — mediante ordem judicial
                ou requisição legal válida.
              </li>
            </ul>
            <p>
              A Megafone <strong>não vende</strong> dados pessoais a terceiros.
            </p>
          </Section>

          <Section id="transferencia" title="8. Transferência internacional">
            <p>
              Em razão do uso de provedores globais (como Meta e provedores de
              nuvem), dados pessoais podem ser processados em servidores
              localizados fora do Brasil. Nesses casos, adotamos salvaguardas
              adequadas, incluindo cláusulas contratuais específicas,
              criptografia em trânsito (TLS) e em repouso, e controles de
              acesso estritos, em conformidade com os arts. 33 a 36 da LGPD.
            </p>
          </Section>

          <Section id="seguranca" title="9. Segurança da informação">
            <p>
              Aplicamos medidas técnicas e administrativas apropriadas para
              proteger os dados pessoais, incluindo:
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Conexões criptografadas via TLS;</li>
              <li>
                Segregação lógica por workspace e políticas de Row Level
                Security (RLS) no banco de dados;
              </li>
              <li>Armazenamento de tokens e segredos em cofre cifrado;</li>
              <li>
                Controle de acesso baseado em papéis (RBAC), com permissões
                granulares;
              </li>
              <li>
                Registros de auditoria, monitoramento de eventos e processos de
                resposta a incidentes.
              </li>
            </ul>
            <p>
              Em caso de incidente de segurança envolvendo dados pessoais que
              possa acarretar risco ou dano relevante aos titulares, a Megafone
              comunicará o Cliente e a ANPD nos prazos e condições previstos
              pela legislação aplicável.
            </p>
          </Section>

          <Section id="retencao" title="10. Retenção de dados">
            <p>
              Os dados pessoais são mantidos pelo tempo necessário ao
              cumprimento das finalidades para as quais foram coletados,
              observando-se prazos legais e regulatórios, bem como prazos
              prescricionais para o exercício regular de direitos. Após o
              encerramento do contrato, os dados poderão ser eliminados ou
              anonimizados, salvo nas hipóteses de guarda obrigatória.
            </p>
          </Section>

          <Section id="direitos" title="11. Direitos do titular">
            <p>
              Nos termos do art. 18 da LGPD, o titular pode requerer, a qualquer
              momento:
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Confirmação da existência de tratamento;</li>
              <li>Acesso aos dados;</li>
              <li>Correção de dados incompletos, inexatos ou desatualizados;</li>
              <li>
                Anonimização, bloqueio ou eliminação de dados desnecessários ou
                tratados em desconformidade;
              </li>
              <li>Portabilidade dos dados;</li>
              <li>
                Eliminação dos dados tratados com base em consentimento;
              </li>
              <li>
                Informação sobre entidades com as quais os dados foram
                compartilhados;
              </li>
              <li>
                Revogação do consentimento e oposição a tratamentos realizados
                com fundamento em outras bases legais.
              </li>
            </ul>
            <p>
              Solicitações relativas a dados de Usuários Finais devem ser
              direcionadas, em primeiro lugar, ao Cliente que controla o
              respectivo workspace. A Megafone auxiliará o Cliente no
              atendimento dessas solicitações na qualidade de operadora.
              Solicitações podem também ser enviadas para{" "}
              <a
                href="mailto:contato@megafone.digital"
                className="text-primary underline"
              >
                contato@megafone.digital
              </a>
              .
            </p>
          </Section>

          <Section id="criancas" title="12. Crianças e adolescentes">
            <p>
              O MegaCRM é destinado ao uso profissional por empresas e seus
              colaboradores. Não direcionamos o serviço a menores de 13 anos e
              não coletamos intencionalmente dados pessoais de crianças. Caso o
              Cliente trate, por meio da Plataforma, dados de crianças ou
              adolescentes, deverá fazê-lo em estrita observância ao art. 14
              da LGPD.
            </p>
          </Section>

          <Section id="cookies" title="13. Cookies">
            <p>
              Utilizamos apenas cookies estritamente necessários ao
              funcionamento da Plataforma, em especial para autenticação e
              manutenção de sessão. Não utilizamos cookies de publicidade
              comportamental nem compartilhamos identificadores com redes de
              terceiros.
            </p>
          </Section>

          <Section id="alteracoes" title="14. Alterações desta Política">
            <p>
              Esta Política pode ser atualizada periodicamente para refletir
              mudanças legais, regulatórias ou operacionais. A versão vigente
              estará sempre disponível nesta página, com indicação da data da
              última atualização. Alterações materiais serão comunicadas aos
              Clientes pelos canais habituais.
            </p>
          </Section>

          <Section id="contato" title="15. Encarregado e contato">
            <p>
              Para exercer direitos, esclarecer dúvidas ou tratar de qualquer
              assunto relativo a esta Política, entre em contato com o
              Encarregado pelo Tratamento de Dados Pessoais (DPO) da Megafone:
            </p>
            <ul className="list-none space-y-1 pl-0">
              <li>
                <strong>MEGAFONE NEGÓCIOS DIGITAIS LTDA.</strong>
              </li>
              <li>CNPJ: 21.854.438/0001-07</li>
              <li>
                Endereço: Al. Rio Negro, 500, Andar 5, Sala 501 a 508, Torre
                B, Alphaville Centro Industrial e Empresarial, Barueri/SP, CEP
                06.454-000
              </li>
              <li>
                E-mail:{" "}
                <a
                  href="mailto:contato@megafone.digital"
                  className="text-primary underline"
                >
                  contato@megafone.digital
                </a>
              </li>
            </ul>
            <p>
              O titular também pode apresentar reclamação à Autoridade Nacional
              de Proteção de Dados (ANPD) por meio de{" "}
              <a
                href="https://www.gov.br/anpd"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                www.gov.br/anpd
              </a>
              .
            </p>
          </Section>

          <Section id="links" title="16. Referências">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <a
                  href="https://www.whatsapp.com/legal/business-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  Política Comercial do WhatsApp
                </a>
              </li>
              <li>
                <a
                  href="https://www.whatsapp.com/legal/business-solution-terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  Termos do WhatsApp Business Solution
                </a>
              </li>
              <li>
                <a
                  href="https://www.whatsapp.com/legal/privacy-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  Política de Privacidade do WhatsApp
                </a>
              </li>
              <li>
                <a
                  href="https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  Lei Geral de Proteção de Dados (Lei nº 13.709/2018)
                </a>
              </li>
            </ul>
          </Section>
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-3xl flex-col items-start justify-between gap-2 px-6 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} Megafone Negócios Digitais Ltda.</span>
          <span>Última atualização: {UPDATED_AT}</span>
        </div>
      </footer>
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-4">
      <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}
