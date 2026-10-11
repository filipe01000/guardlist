# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Analistas e administradores de segurança que mantêm blocklists separadas por cliente numa base compartilhada pela equipe, durante uma rotina recorrente de revisão, importação, investigação e exportação para firewalls.

## Product Purpose

O GuardList organiza listas de IPs e redes CIDR por cliente, identifica atrasos e anomalias de importação, permite correlação entre listas e consulta fontes CTI. Sucesso significa executar a manutenção semanal com clareza, sem misturar dados entre clientes e com exportações prontas para o firewall correto.

## Positioning

Cada cliente é um perímetro de dados isolado. O produto combina essa separação estrita com uma fila operacional por urgência e investigação CTI de indicadores, sem depender de uma aparência de produto promocional.

## Operating Context

Uso recorrente em desktop por uma equipe autenticada operando várias listas: conferir prazos, importar arquivos, revisar IPs e CIDRs, investigar ocorrências, exportar TXT/NANO, consultar histórico e manter backups. O produto também deve continuar utilizável em telas pequenas.

## Capabilities and Constraints

- PostgreSQL compartilhado pela equipe em produção; os operadores consultam e alteram a mesma base pelo backend. Sem `DATABASE_URL`, o desenvolvimento usa PGlite local em `.data/pglite`; os testes de integração usam PGlite em memória.
- IndexedDB é um armazenamento legado, lido apenas para migrar dados de versões anteriores para a base da equipe.
- Autenticação, sessões e permissões são verificadas no backend. Administradores gerenciam usuários, aprovações e restauração de backups; analistas operam as listas. Por padrão, substituições e lotes acima de 500 itens enviados por analistas aguardam aprovação, conforme as regras configuradas.
- Listas de clientes permanecem independentes.
- Integrações CTI com AbuseIPDB, GreyNoise e AlienVault OTX dependem de chaves válidas, limites e disponibilidade das APIs.
- Credenciais devem permanecer fora do cliente, dos pacotes distribuídos e da interface.
- Funcionalidade, conteúdo operacional e fluxos existentes devem ser preservados durante o redesenho.

## Brand Commitments

- Nome: GuardList.
- Usar a marca existente em `public/brand/guardlist-mark.png` e os materiais de login presentes em `public/brand/`.
- A interface deve parecer uma ferramenta operacional bem desenhada, não uma landing page, campanha ou propaganda.
- O mesmo sistema visual deve cobrir todas as páginas, tabelas, formulários, estados e modais.

## Evidence on Hand

- Aplicação React funcional em `src/` e backend em `server.ts` e `server/`.
- Fixtures de testes em memória para validar importações, permissões, paginação e restauração de backups.
- Marca e materiais de login existentes em `public/brand/`.
- Não foi fornecido um guia comercial adicional; não inventar clientes, métricas de desempenho ou alegações.

## Product Principles

1. Operação antes de ornamentação.
2. Estado e prioridade devem ser reconhecidos em poucos segundos.
3. Isolamento entre clientes é uma regra visível e estrutural.
4. Dados densos devem continuar legíveis e acionáveis.
5. A interface inteira usa um vocabulário consistente de navegação, controles e feedback.

