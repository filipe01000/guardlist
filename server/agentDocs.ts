import { Router, type Request, type RequestHandler, type Response } from 'express';

// Conteúdo legível por agentes e robôs de busca: home sem JavaScript, Markdown por negociação (Accept: text/markdown),
// /docs, /llms.txt, /openapi.json, /robots.txt, /sitemap.xml e 404 de verdade. O app em si exige login: aqui só entra o
// que pode ser público, e a especificação cobre o acesso, não as operações internas nem as de administração.

interface Section {
  title: string;
  paragraphs?: string[];
  items?: string[];
}

interface Page {
  title: string;
  intro: string;
  sections: Section[];
}

const LINKS_NOTE = 'Para agentes: [documentação](/docs), [llms.txt](/llms.txt) e [especificação OpenAPI](/openapi.json). Sobre o serviço: [sobre](/about), [contato](/contact) e [privacidade](/privacy).';

// Data da última revisão destes textos, usada no sitemap. Atualize ao mudar o conteúdo.
const CONTENT_UPDATED = '2026-10-30';

export const HOME: Page = {
  title: 'GuardList: gestão de blocklists de firewall por cliente',
  intro:
    'O GuardList é uma ferramenta interna para equipes de segurança que mantêm as blocklists de firewall de vários clientes. Cada cliente tem a própria lista, separada das demais, e a equipe trabalha numa base compartilhada, com registro de quem fez cada alteração.',
  sections: [
    {
      title: 'O que a equipe faz no GuardList',
      items: [
        'Importa os bloqueios do dia e vê, antes de gravar, o que é novo, repetido, arriscado ou exceção do cliente.',
        'Consulta a reputação de IPs e redes CIDR no AbuseIPDB, no GreyNoise e no OTX.',
        'Exporta a lista de cada cliente para o firewall e gera o texto do caso para o cliente.',
        'Acompanha prazos de revisão, histórico de importações, relatórios e IPs presentes em mais de um cliente.'
      ]
    },
    {
      title: 'Acesso',
      paragraphs: [
        'O acesso é restrito à equipe autorizada: não há cadastro público nem dados públicos. Depois do login, com verificação em duas etapas quando exigida, o app abre neste mesmo endereço.',
        LINKS_NOTE
      ]
    }
  ]
};

export const DOCS: Page = {
  title: 'Documentação do GuardList para agentes e integrações',
  intro: 'Como um agente ou integração deve interpretar o GuardList e o que está disponível sem login.',
  sections: [
    {
      title: 'O que está disponível sem login',
      items: [
        '[Página inicial](/): descrição do produto em HTML e, com `Accept: text/markdown`, em Markdown.',
        '[llms.txt](/llms.txt): índice para modelos de linguagem.',
        '[openapi.json](/openapi.json): especificação OpenAPI 3.1 do acesso à API.',
        '[sitemap.xml](/sitemap.xml) e [robots.txt](/robots.txt).',
        '`GET /healthz`: situação do serviço.'
      ]
    },
    {
      title: 'Quando usar o GuardList',
      items: [
        'Para saber o que é o produto, como entrar e como a API se autentica.',
        'Para trabalhar nas blocklists de um cliente, quando a pessoa que você ajuda já tem conta e fez login.',
        'Não use como serviço público de reputação de IP: as consultas exigem login. Para isso, procure diretamente o AbuseIPDB, o GreyNoise ou o OTX.',
        'Nunca peça a senha ou o código de verificação de alguém para agir em nome dessa pessoa: o login é sempre feito por ela.'
      ]
    },
    {
      title: 'Autenticação',
      paragraphs: [
        'A API usa sessão por cookie, para pessoas da equipe. Não há chave de API, OAuth nem cadastro público; contas são criadas por um administrador.',
        'O login é feito em `POST /api/auth/login`. Se a verificação em duas etapas estiver exigida, a resposta traz `step` e o código vai em `POST /api/auth/mfa`. A sessão fica no cookie `gl_session`, encerra depois de um período sem uso e tem validade máxima.'
      ]
    },
    {
      title: 'Exemplos',
      paragraphs: [
        'Situação do serviço: `curl https://guardlist.onrender.com/healthz`',
        'Sessão atual: `curl https://guardlist.onrender.com/api/auth/me`',
        'Esta página em Markdown: `curl -H "Accept: text/markdown" https://guardlist.onrender.com/docs`'
      ]
    },
    {
      title: 'Limites de requisições',
      paragraphs: [
        'As rotas com limite respondem com os cabeçalhos `RateLimit-Limit` (máximo da janela), `RateLimit-Remaining` (o que resta) e `RateLimit-Reset` (segundos até a janela recomeçar). Ao passar do limite, a resposta é `429` com `Retry-After` em segundos: espere esse tempo antes de tentar de novo. O login aceita 20 tentativas a cada 15 minutos por IP.'
      ]
    },
    {
      title: 'Respostas e erros',
      items: [
        'Erros da API vêm em JSON, no formato `{ "error": "mensagem" }`.',
        '`401`: sem sessão válida. `403`: sem permissão. `423`: conta bloqueada por tentativas erradas. `429`: limite de requisições.',
        'Caminhos que não existem respondem `404`, em Markdown para quem pede `Accept: text/markdown`.'
      ]
    }
  ]
};

export const ABOUT: Page = {
  title: 'Sobre o GuardList',
  intro:
    'O GuardList é uma ferramenta interna de operação para analistas e administradores de segurança que mantêm blocklists separadas por cliente. Ele não é um serviço público nem um produto à venda neste endereço: o uso é restrito à equipe autorizada.',
  sections: [
    {
      title: 'Por que existe',
      paragraphs: [
        'Manter a blocklist de firewall de vários clientes é uma rotina recorrente: conferir prazos, importar o lote do dia, revisar o que já está bloqueado, investigar IPs e exportar a lista certa para o firewall certo. O GuardList reúne esse trabalho num só lugar e trata cada cliente como um perímetro separado, para que uma lista nunca se misture com outra.'
      ]
    },
    {
      title: 'Como funciona',
      items: [
        'A equipe usa uma base compartilhada, e cada alteração registra quem a fez.',
        'Antes de gravar, a importação mostra o que é novo, repetido, arriscado ou exceção do cliente.',
        'Analistas operam as listas. Administradores cuidam de usuários, aprovações, auditoria e backups.',
        'O acesso usa senha e pode exigir verificação em duas etapas com aplicativo autenticador.'
      ]
    }
  ]
};

export const CONTACT: Page = {
  title: 'Contato e suporte do GuardList',
  intro:
    'O GuardList é usado por uma equipe interna e não tem atendimento público. O suporte é feito pelo administrador da sua equipe, que tem as ferramentas para resolver a maioria dos problemas de acesso.',
  sections: [
    {
      title: 'Problemas de acesso',
      items: [
        'Esqueceu a senha: peça ao administrador para redefinir. Você recebe uma senha provisória e troca no primeiro acesso.',
        'Conta bloqueada por tentativas erradas: espere alguns minutos ou peça ao administrador para liberar.',
        'Perdeu o celular do autenticador: entre com um código de recuperação. Sem os códigos, o administrador zera a sua verificação em duas etapas.',
        'Viu um acesso que não reconhece: use o botão Não fui eu no aviso do app, troque a senha e avise o administrador.'
      ]
    },
    {
      title: 'Quero uma conta',
      paragraphs: ['Não há cadastro público. Contas são criadas por um administrador, só para quem faz parte da equipe.']
    }
  ]
};

export const PRIVACY: Page = {
  title: 'Privacidade no GuardList',
  intro:
    'Esta página descreve como o GuardList trata dados, de acordo com o funcionamento do sistema. Só a equipe autorizada acessa o conteúdo do app.',
  sections: [
    {
      title: 'Dados que o sistema guarda',
      items: [
        'Conta: usuário, nome, papel, senha em forma de hash, chave do autenticador criptografada e data do último acesso.',
        'Sessões: IP, navegador e horários de cada acesso. Ficam guardados por até 90 dias depois de encerrados e servem para o aviso de acesso novo.',
        'Auditoria: quem fez cada ação no sistema.',
        'Listas dos clientes: IPs, redes, domínios, tickets e observações registrados pela equipe.'
      ]
    },
    {
      title: 'Cookies e armazenamento no navegador',
      paragraphs: [
        'O GuardList usa um cookie de sessão (`gl_session`) e um cookie temporário durante a verificação em duas etapas (`gl_mfa`). Preferências como o tema ficam no próprio navegador. Não há cookies de publicidade nem scripts de análise de terceiros.'
      ]
    },
    {
      title: 'Serviços externos',
      items: [
        'Os IPs consultados pela equipe são enviados ao AbuseIPDB, ao GreyNoise e ao OTX para verificar a reputação.',
        'Se o assistente de IA estiver ligado, as perguntas e os dados necessários para respondê-las vão para o modelo configurado no servidor.',
        'Se o e-mail estiver configurado, relatórios e backups são enviados aos destinatários definidos pelos administradores.',
        'O sistema é hospedado no Render, e o banco de dados fica no Neon.'
      ]
    },
    {
      title: 'Dúvidas e pedidos',
      paragraphs: ['Para consultar, corrigir ou remover os seus dados, fale com o administrador da sua equipe.']
    }
  ]
};

const PAGES: Array<{ path: string; page: Page }> = [
  { path: '/docs', page: DOCS },
  { path: '/about', page: ABOUT },
  { path: '/contact', page: CONTACT },
  { path: '/privacy', page: PRIVACY }
];

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Só o Markdown que estes textos usam: `código` e [texto](/caminho).
const inline = (text: string) =>
  esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((\/[^)]*)\)/g, '<a href="$2">$1</a>');

export function pageMarkdown(page: Page): string {
  const body = page.sections.map((s) =>
    [`## ${s.title}`, ...(s.paragraphs ?? []), ...(s.items ? [s.items.map((i) => `- ${i}`).join('\n')] : [])].join('\n\n')
  );
  return [`# ${page.title}`, page.intro, ...body].join('\n\n') + '\n';
}

export function pageHtml(page: Page): string {
  const body = page.sections.map((s) =>
    [
      `<h2>${esc(s.title)}</h2>`,
      ...(s.paragraphs ?? []).map((p) => `<p>${inline(p)}</p>`),
      ...(s.items ? [`<ul>${s.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`] : [])
    ].join('')
  );
  return `<h1>${esc(page.title)}</h1><p>${inline(page.intro)}</p>${body.join('')}`;
}

// Marcador em index.html, dentro de #root: o React troca esse conteúdo ao montar.
export const STATIC_HOME_MARK = '<!--gl-static-home-->';
export const staticHome = () => `<main class="gl-static">${pageHtml(HOME)}</main>`;

// Marcador no <head> de index.html: URL canônica e dados estruturados, que dependem da origem pública.
export const HEAD_MARK = '<!--gl-head-->';
export function headTags(origin: string): string {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'GuardList',
    description: HOME.intro,
    url: `${origin}/`,
    applicationCategory: 'SecurityApplication',
    operatingSystem: 'Web',
    inLanguage: 'pt-BR'
  };
  // "<" escapado: o JSON não pode fechar a tag script.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<link rel="canonical" href="${esc(origin)}/" />\n    <script type="application/ld+json">${json}</script>`;
}

const shell = (title: string, body: string, canonical?: string) => `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>${canonical ? `\n<link rel="canonical" href="${esc(canonical)}">` : ''}
<link rel="icon" type="image/png" href="/brand/guardlist-mark.png">
<style>
:root { color-scheme: dark; }
body { margin: 0; background: #0E0D15; color: #D5CCD8; font: 16px/1.6 "Segoe UI", system-ui, sans-serif; }
main { box-sizing: border-box; max-width: 760px; margin: 0 auto; padding: 40px 20px; }
h1, h2 { color: #F3F0F6; line-height: 1.25; }
a { color: #BFA9BA; }
code { font-family: Consolas, monospace; font-size: .9em; color: #F3F0F6; }
</style>
</head>
<body><main>${body}</main></body>
</html>
`;

const NOT_FOUND = {
  title: 'Página não encontrada no GuardList',
  markdown: `# Página não encontrada no GuardList

Este endereço não existe. Veja a [documentação](/docs), o [llms.txt](/llms.txt) ou o [sitemap](/sitemap.xml), ou volte à [página inicial](/).
`,
  html: '<h1>Página não encontrada no GuardList</h1><p>Este endereço não existe. Veja a <a href="/docs">documentação</a>, o <a href="/llms.txt">llms.txt</a> ou o <a href="/sitemap.xml">sitemap</a>, ou volte à <a href="/">página inicial</a>.</p>'
};

const wantsMarkdown = (req: Request) => req.accepts(['text/html', 'text/markdown']) === 'text/markdown';

function sendPage(req: Request, res: Response, status: number, title: string, markdown: string, html: string, canonical?: string) {
  res.vary('Accept').setHeader('Cache-Control', 'no-cache');
  res.status(status);
  if (wantsMarkdown(req)) return res.type('text/markdown; charset=utf-8').send(markdown);
  return res.type('html').send(shell(title, html, canonical));
}

export const notFound: RequestHandler = (req, res) => {
  sendPage(req, res, 404, NOT_FOUND.title, NOT_FOUND.markdown, NOT_FOUND.html);
};

function llmsTxt(origin: string): string {
  return `# GuardList

> Ferramenta interna para equipes de segurança manterem as blocklists de firewall de cada cliente. O acesso exige login: não há cadastro nem dados públicos.

## Quando usar

- Use para saber o que é o GuardList, como entrar e como a API se autentica.
- Use para trabalhar nas blocklists de um cliente quando a pessoa que você ajuda já tem conta e fez login.
- Não use como serviço público de reputação de IP: as consultas exigem login.
- Não peça a senha nem o código de verificação de ninguém: o login é sempre feito pela própria pessoa.

## Documentação

- [Documentação do GuardList](${origin}/docs): o que está disponível sem login, autenticação, exemplos, limites e erros
- [Documentação em Markdown](${origin}/docs.md): o mesmo conteúdo em Markdown
- [Especificação OpenAPI do GuardList](${origin}/openapi.json): acesso à API

## Optional

- [Sobre o GuardList](${origin}/about): o que é e como funciona
- [Contato e suporte](${origin}/contact): como resolver problemas de acesso
- [Privacidade](${origin}/privacy): dados guardados e serviços externos
- [Descrição em Markdown](${origin}/index.md): a página inicial em Markdown
`;
}

function openApi(origin: string) {
  const json = (schema: object) => ({ 'application/json': { schema } });
  const error = (description: string) => ({ description, content: json({ $ref: '#/components/schemas/Error' }) });
  const limitHeaders = {
    'RateLimit-Limit': { $ref: '#/components/headers/RateLimitLimit' },
    'RateLimit-Remaining': { $ref: '#/components/headers/RateLimitRemaining' },
    'RateLimit-Reset': { $ref: '#/components/headers/RateLimitReset' }
  };
  const tooMany = {
    description: 'Limite de tentativas; espere o tempo de Retry-After',
    headers: { ...limitHeaders, 'Retry-After': { $ref: '#/components/headers/RetryAfter' } },
    content: json({ $ref: '#/components/schemas/Error' })
  };
  const credentials = { username: { type: 'string', maxLength: 64 }, password: { type: 'string', maxLength: 256, format: 'password' } };
  return {
    openapi: '3.1.0',
    info: {
      title: 'GuardList API',
      version: '1.0.0',
      description:
        'Acesso à API do GuardList, ferramenta interna de blocklists de firewall por cliente. A API usa sessão por cookie e é restrita à equipe: não há chave de API nem cadastro público. Esta especificação cobre só o acesso; as operações internas não são publicadas.'
    },
    servers: [{ url: origin || '/' }],
    externalDocs: { description: 'Documentação do GuardList', url: `${origin}/docs` },
    tags: [{ name: 'Serviço' }, { name: 'Autenticação' }],
    paths: {
      '/healthz': {
        get: {
          operationId: 'getHealth',
          summary: 'Situação do serviço',
          description: 'Informa se o servidor está no ar. Não exige login.',
          tags: ['Serviço'],
          security: [],
          responses: { 200: { description: 'Serviço no ar', content: json({ type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } }) } }
        }
      },
      '/api/auth/me': {
        get: {
          operationId: 'getCurrentUser',
          summary: 'Usuário da sessão atual',
          description: 'Mostra quem está na sessão. Sem sessão válida responde 200 com `user` nulo; serve para descobrir se é preciso entrar.',
          tags: ['Autenticação'],
          security: [{}, { sessionCookie: [] }],
          responses: {
            200: {
              description: 'Situação da sessão; `user` é nulo sem sessão válida',
              content: json({
                type: 'object',
                required: ['authEnabled', 'user'],
                properties: {
                  authEnabled: { type: 'boolean' },
                  user: { oneOf: [{ $ref: '#/components/schemas/User' }, { type: 'null' }] },
                  idleTimeoutMs: { type: 'integer', description: 'Tempo sem uso até a sessão encerrar' }
                }
              })
            }
          }
        }
      },
      '/api/auth/login': {
        post: {
          operationId: 'login',
          summary: 'Entrar com usuário e senha',
          description: 'Abre a sessão no cookie `gl_session`. Com a verificação em duas etapas exigida, devolve `step` e cria o cookie `gl_mfa`; continue em `verifyMfa`.',
          tags: ['Autenticação'],
          security: [],
          requestBody: { required: true, content: json({ type: 'object', required: ['username', 'password'], properties: credentials }) },
          responses: {
            200: {
              description: 'Sessão aberta (`user`) ou próxima etapa da verificação em duas etapas (`step`)',
              headers: limitHeaders,
              content: json({
                type: 'object',
                properties: { user: { $ref: '#/components/schemas/User' }, step: { type: 'string', enum: ['mfa', 'mfa-setup'] } }
              })
            },
            400: error('Faltam usuário ou senha'),
            401: error('Usuário ou senha incorretos'),
            423: error('Conta bloqueada por tentativas erradas'),
            429: tooMany,
            503: error('Verificação em duas etapas indisponível no servidor')
          }
        }
      },
      '/api/auth/mfa': {
        post: {
          operationId: 'verifyMfa',
          summary: 'Confirmar o código da verificação em duas etapas',
          description: 'Usa o cookie `gl_mfa`, criado pelo login. Envie `code` ou `recoveryCode`.',
          tags: ['Autenticação'],
          security: [{ mfaStepCookie: [] }],
          requestBody: {
            required: true,
            content: json({ type: 'object', properties: { code: { type: 'string', maxLength: 20 }, recoveryCode: { type: 'string', maxLength: 40 } } })
          },
          responses: {
            200: { description: 'Sessão aberta', headers: limitHeaders, content: json({ type: 'object', required: ['user'], properties: { user: { $ref: '#/components/schemas/User' } } }) },
            401: error('Código incorreto ou etapa expirada'),
            423: error('Conta bloqueada por tentativas erradas'),
            429: tooMany
          }
        }
      },
      '/api/auth/logout': {
        post: {
          operationId: 'logout',
          summary: 'Encerrar a sessão atual',
          description: 'Invalida a sessão no servidor e apaga o cookie.',
          tags: ['Autenticação'],
          security: [{ sessionCookie: [] }],
          responses: { 200: { description: 'Sessão encerrada', content: json({ type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } }) } }
        }
      }
    },
    components: {
      headers: {
        RateLimitLimit: { description: 'Máximo de requisições na janela', schema: { type: 'integer' } },
        RateLimitRemaining: { description: 'Requisições restantes na janela', schema: { type: 'integer' } },
        RateLimitReset: { description: 'Segundos até a janela recomeçar', schema: { type: 'integer' } },
        RetryAfter: { description: 'Segundos para esperar antes de tentar de novo', schema: { type: 'integer' } }
      },
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'gl_session', description: 'Cookie de sessão criado pelo login' },
        mfaStepCookie: { type: 'apiKey', in: 'cookie', name: 'gl_mfa', description: 'Cookie temporário entre a senha e o código' }
      },
      schemas: {
        Error: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } },
        User: {
          type: 'object',
          required: ['id', 'username', 'displayName', 'role', 'active', 'mustChangePassword', 'mfaEnabled'],
          properties: {
            id: { type: 'integer' },
            username: { type: 'string' },
            displayName: { type: 'string' },
            role: { type: 'string', enum: ['admin', 'analyst'] },
            active: { type: 'boolean' },
            mustChangePassword: { type: 'boolean', description: 'A pessoa precisa trocar a senha antes de continuar' },
            createdAt: { type: 'string', format: 'date-time' },
            lastLoginAt: { type: ['string', 'null'], format: 'date-time' },
            lockedUntil: { type: ['string', 'null'], format: 'date-time' },
            mfaEnabled: { type: 'boolean' }
          }
        }
      }
    }
  };
}

// originFor devolve a origem pública sem barra no fim. Rotas que precisam de URL absoluta (sitemap, llms.txt) dependem dela.
export function agentRouter(originFor: (req: Request) => string): Router {
  const router = Router();

  router.get('/', (req, res, next) => {
    res.vary('Accept');
    if (!wantsMarkdown(req)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    return res.type('text/markdown; charset=utf-8').send(pageMarkdown(HOME));
  });
  router.get('/index.md', (_req, res) => res.type('text/markdown; charset=utf-8').send(pageMarkdown(HOME)));
  for (const { path, page } of PAGES) {
    router.get(path, (req, res) => sendPage(req, res, 200, page.title, pageMarkdown(page), pageHtml(page), `${originFor(req)}${path}`));
  }
  router.get('/docs.md', (_req, res) => res.type('text/markdown; charset=utf-8').send(pageMarkdown(DOCS)));
  router.get('/llms.txt', (req, res) => res.type('text/plain; charset=utf-8').send(llmsTxt(originFor(req))));
  router.get('/openapi.json', (req, res) => res.json(openApi(originFor(req))));
  router.get('/robots.txt', (req, res) =>
    res.type('text/plain; charset=utf-8').send(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${originFor(req)}/sitemap.xml\n`)
  );
  router.get('/sitemap.xml', (req, res) => {
    const origin = esc(originFor(req));
    const urls = ['/', ...PAGES.map((p) => p.path)].map((p) => `  <url><loc>${origin}${p}</loc><lastmod>${CONTENT_UPDATED}</lastmod></url>`);
    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
    );
  });
  return router;
}
