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

const LINKS_NOTE = 'Para agentes: [documentação](/docs), [llms.txt](/llms.txt) e [especificação OpenAPI](/openapi.json).';

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
      title: 'Autenticação',
      paragraphs: [
        'A API usa sessão por cookie, para pessoas da equipe. Não há chave de API, OAuth nem cadastro público; contas são criadas por um administrador.',
        'O login é feito em `POST /api/auth/login`. Se a verificação em duas etapas estiver exigida, a resposta traz `step` e o código vai em `POST /api/auth/mfa`. A sessão fica no cookie `gl_session`, encerra depois de um período sem uso e tem validade máxima.'
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

const shell = (title: string, body: string) => `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" type="image/png" href="/brand/guardlist-mark.png">
<style>
:root { color-scheme: dark; }
body { margin: 0; background: #050d1f; color: #c0cee4; font: 16px/1.6 "Segoe UI", system-ui, sans-serif; }
main { box-sizing: border-box; max-width: 760px; margin: 0 auto; padding: 40px 20px; }
h1, h2 { color: #f1f6fd; line-height: 1.25; }
a { color: #5bb9ff; }
code { font-family: Consolas, monospace; font-size: .9em; color: #f1f6fd; }
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

function sendPage(req: Request, res: Response, status: number, title: string, markdown: string, html: string) {
  res.vary('Accept').setHeader('Cache-Control', 'no-cache');
  res.status(status);
  if (wantsMarkdown(req)) return res.type('text/markdown; charset=utf-8').send(markdown);
  return res.type('html').send(shell(title, html));
}

export const notFound: RequestHandler = (req, res) => {
  sendPage(req, res, 404, NOT_FOUND.title, NOT_FOUND.markdown, NOT_FOUND.html);
};

function llmsTxt(origin: string): string {
  return `# GuardList

> Ferramenta interna para equipes de segurança manterem as blocklists de firewall de cada cliente. O acesso exige login: não há cadastro nem dados públicos.

## Documentação

- [Documentação do GuardList](${origin}/docs): o que está disponível sem login, autenticação e erros
- [Documentação em Markdown](${origin}/docs.md): o mesmo conteúdo em Markdown
- [Especificação OpenAPI do GuardList](${origin}/openapi.json): acesso à API

## Optional

- [Sobre o GuardList](${origin}/index.md): descrição do produto em Markdown
`;
}

function openApi(origin: string) {
  const json = (schema: object) => ({ 'application/json': { schema } });
  const error = (description: string) => ({ description, content: json({ $ref: '#/components/schemas/Error' }) });
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
          tags: ['Serviço'],
          responses: { 200: { description: 'Serviço no ar', content: json({ type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } }) } }
        }
      },
      '/api/auth/me': {
        get: {
          operationId: 'getCurrentUser',
          summary: 'Usuário da sessão atual',
          tags: ['Autenticação'],
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
          tags: ['Autenticação'],
          requestBody: { required: true, content: json({ type: 'object', required: ['username', 'password'], properties: credentials }) },
          responses: {
            200: {
              description: 'Sessão aberta (`user`) ou próxima etapa da verificação em duas etapas (`step`)',
              content: json({
                type: 'object',
                properties: { user: { $ref: '#/components/schemas/User' }, step: { type: 'string', enum: ['mfa', 'mfa-setup'] } }
              })
            },
            400: error('Faltam usuário ou senha'),
            401: error('Usuário ou senha incorretos'),
            423: error('Conta bloqueada por tentativas erradas'),
            429: error('Limite de tentativas'),
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
            200: { description: 'Sessão aberta', content: json({ type: 'object', required: ['user'], properties: { user: { $ref: '#/components/schemas/User' } } }) },
            401: error('Código incorreto ou etapa expirada'),
            423: error('Conta bloqueada por tentativas erradas'),
            429: error('Limite de tentativas')
          }
        }
      },
      '/api/auth/logout': {
        post: {
          operationId: 'logout',
          summary: 'Encerrar a sessão atual',
          tags: ['Autenticação'],
          security: [{ sessionCookie: [] }],
          responses: { 200: { description: 'Sessão encerrada', content: json({ type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } }) } }
        }
      }
    },
    components: {
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'gl_session', description: 'Cookie de sessão criado pelo login' },
        mfaStepCookie: { type: 'apiKey', in: 'cookie', name: 'gl_mfa', description: 'Cookie temporário entre a senha e o código' }
      },
      schemas: {
        Error: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } },
        User: {
          type: 'object',
          required: ['username', 'displayName', 'role'],
          properties: {
            username: { type: 'string' },
            displayName: { type: 'string' },
            role: { type: 'string', enum: ['admin', 'analyst'] }
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
  router.get('/docs', (req, res) => sendPage(req, res, 200, DOCS.title, pageMarkdown(DOCS), pageHtml(DOCS)));
  router.get('/docs.md', (_req, res) => res.type('text/markdown; charset=utf-8').send(pageMarkdown(DOCS)));
  router.get('/llms.txt', (req, res) => res.type('text/plain; charset=utf-8').send(llmsTxt(originFor(req))));
  router.get('/openapi.json', (req, res) => res.json(openApi(originFor(req))));
  router.get('/robots.txt', (req, res) =>
    res.type('text/plain; charset=utf-8').send(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${originFor(req)}/sitemap.xml\n`)
  );
  router.get('/sitemap.xml', (req, res) => {
    const origin = esc(originFor(req));
    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${origin}/</loc></url>\n  <url><loc>${origin}/docs</loc></url>\n</urlset>\n`
    );
  });
  return router;
}
