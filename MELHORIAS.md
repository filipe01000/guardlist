# Revisão do GuardList — 11/10/2026

Esta versão reúne a revisão inicial e as melhorias solicitadas depois: design, paginação no servidor, testes de integração e documentação atualizada. A identidade visual e os fluxos existentes foram preservados.

## Alterações aplicadas

- **Autenticação:** hashes scrypt malformados são recusados. Tentativas simultâneas da mesma conta são serializadas em transação, preservando o bloqueio por excesso de tentativas.
- **Importação:** máscaras CIDR inválidas não são convertidas silenciosamente em IPs válidos; IPv6 exige máscara inteira nos limites corretos.
- **CSV:** planilhas com cabeçalho importam somente a coluna de indicadores. Observações e tickets não viram bloqueios; registros marcados como removidos são ignorados. Aspas, delimitadores e campos com várias linhas são respeitados.
- **Permissões:** um erro 403 de permissão não desmonta o app nem perde o formulário. Somente sessão expirada e troca obrigatória de senha reavaliam a autenticação.
- **Conexão:** carregamento visível e botão Tentar novamente. Falhas iniciais não mostram totais zerados como se fossem dados reais; falhas posteriores mantêm os últimos dados e avisam que não foram atualizados.
- **Concorrência no navegador:** respostas antigas não sobrescrevem uma atualização mais recente. Se um cliente desaparece, a seleção passa para um cliente disponível.
- **Exportação:** falhas mostram aviso na interface, além do registro no console.
- **Desempenho:** nove telas são carregadas sob demanda. O pacote JavaScript inicial caiu de 496,72 kB para aproximadamente 313 kB (cerca de 37%; comprimido de 143,13 kB para aproximadamente 98 kB). O código continua disponível em módulos separados.
- **Acessibilidade:** link para ir direto ao conteúdo, título acessível dos modais, proteção contra abrir a consulta global por atalho sobre outro modal, campos maiores no celular e tema resistente a indisponibilidade de localStorage.
- **Recuperação das páginas:** se um módulo ou uma página falhar, há uma mensagem com ação para recarregar, preservando a navegação lateral.
- **Design:** controles e rótulos mais legíveis, nomes de clientes em IBM Plex Sans e datas em formato brasileiro. Botões principais usam azul com contraste adequado para texto branco, inclusive no hover; estados de atraso/risco seguem as cores semânticas de cada tema. Há um único acesso ao backup, com indicação de pendência.
- **Celular:** alvos principais de 44 px, ações de seleção/edição/exclusão nos cartões, menu rolável com foco contido, fechamento por Escape, retorno de foco ao botão e conteúdo de fundo inerte enquanto o menu está aberto. O menu fechado não entra na sequência do teclado.
- **Paginação:** listas e correlação filtradas, ordenadas e paginadas em SQL. O painel recebe agregados e os quatro indicadores mais recorrentes; abrir o app não baixa todos os indicadores. Comentários são contados apenas para a página. Busca, seleção entre páginas e exportação completa continuam funcionando.
- **Dossiê:** ocorrências completas carregadas sob demanda, com carregamento/erro/retry. Reimportações não aumentam artificialmente o número de clientes, e a linha do tempo preserva os registros anteriores.
- **Integridade adicional:** importações não podem reutilizar IDs de outro cliente. Backups inválidos são recusados antes de limpar a base. Desfazer valida o cliente do histórico e restaura tudo na mesma transação.
- **Documentação:** PRODUCT.md agora descreve PostgreSQL compartilhado, PGlite para desenvolvimento/testes e IndexedDB apenas para migração do legado. DESIGN.md acompanha os ajustes de leitura e cor.
- **Testes:** `npm test` reúne autenticação, concorrência, API, validação/importação/exportação, paginação SQL, dossiê e dez cenários de integração em banco em memória.

## Validação

Os 77 testes de `npm test`, `npm run lint` e `npm run build` passaram. A prévia isolada usou sete clientes e 315 registros fictícios para verificar temas, desktop/celular, foco do menu, busca além da primeira página, seleção entre páginas, exportação NANO completa apesar dos filtros e correlação paginada. Não houve uso do banco ou de credenciais de produção nessa prévia. Integrações CTI externas não foram exercitadas com chaves reais.

## Sugestões anteriores concluídas

1. Paginação e agregação no servidor para listas, correlação e painel.
2. Testes de integração para importação, aprovação, desfazer e backup em banco isolado, incluindo rollback e dados inválidos.
3. Atualização da documentação de produto para refletir a arquitetura atual.

## Usar esta versão

Extraia o projeto, mantenha suas variáveis de ambiente fora do pacote e execute `npm ci`, `npm test`, `npm run lint` e `npm run build`. Para desenvolver, use `npm run dev`. Para produção, siga as instruções de deploy do README.

O ZIP contém código-fonte, testes e recursos de marca. Dependências instaladas, dados locais de teste, credenciais e a prévia descartável ficam fora dele.
