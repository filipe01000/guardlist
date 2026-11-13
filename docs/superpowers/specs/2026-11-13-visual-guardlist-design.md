# Visual novo do DonutVault, puxado do GuardList

Data: 13/11/2026. Estado: aguardando aprovação do dono.
Esboço de referência: [2026-11-13-visual-guardlist-esboco.html](2026-11-13-visual-guardlist-esboco.html) (abra no navegador).

## Intenção

O DonutVault e o GuardList são do mesmo dono e devem parecer da mesma família. O DonutVault passa a
usar o sistema visual do GuardList e mantém alguns sinais próprios, dos anos 90, para continuar
reconhecível. O dono viu o esboço das telas de desbloqueio e de senhas e aprovou a direção.

## Objetivos

- Todas as telas do DonutVault usam a estrutura visual do GuardList: fundo azul-noite com faixas de
  luz, painéis de vidro fosco, menu lateral arredondado, texto em IBM Plex Sans e dados em IBM Plex Mono.
- O DonutVault continua reconhecível pelos elementos listados em "O que fica do DonutVault".
- Tema escuro e tema claro continuam existindo, com o mesmo botão de alternância de hoje.

## Fora do escopo

- Qualquer mudança em criptografia, sincronização, sessões, rotas ou banco. É troca de aparência.
- A entrada nova no cofre (convite, passkey e Senha Mestra). É o projeto seguinte, descrito em
  [2026-11-13-entrada-cofre-decisoes.md](2026-11-13-entrada-cofre-decisoes.md).
- Qualquer alteração no repositório do GuardList. Os estilos são copiados para cá; nada é
  compartilhado por pacote ou por link entre os dois projetos.
- Textos da interface. Os textos atuais ficam, salvo onde um rótulo não couber no layout novo.

## O que seria um fracasso

- Uma regra de "Não quebrar" do `AGENTS.md` violada por causa da troca de visual.
- Momentos de risco (senha vazada, troca de Senha Mestra, exclusão) tratados com brincadeira. A marca
  pode aparecer nesses momentos, mas o texto e a cor seguem sérios.
- O amarelo espalhado por toda parte. Ele é a cor de agir, não de decorar.
- Texto ilegível sobre o vidro ou sobre o amarelo.

## Restrições

- **CSP.** Em produção não há script inline, e estilo só vem de `'self'` e do Google Fonts
  (`src/middleware/reconDefense.ts`). O visual novo não pode exigir afrouxar a política. Recomendação:
  servir as fontes pelo próprio app com `@fontsource` (como o GuardList faz) e retirar o Google Fonts do
  `index.html` e da CSP, o que deixa a política mais apertada do que hoje.
- **Peso do pacote.** O pacote principal fica abaixo de 500 kB (`AGENTS.md`). Fontes entram como
  arquivos separados, não dentro do JavaScript.
- **Movimento.** Faixas de luz e animações param com "reduzir movimento", como já acontece nos dois apps.
- **Navegadores sem `backdrop-filter`.** Os painéis ficam sólidos, como no GuardList.
- **Validação.** Antes de cada commit, a sequência do `AGENTS.md`: `npx tsc --noEmit`, `npm test`,
  `npx vite build`.

## Caminhos considerados

1. **Sóbrio com mascote.** Tudo do GuardList, inclusive a cor de ação lilás; anos 90 só no mascote, na
   logo e na tela de desbloqueio. Os dois produtos ficam mais irmãos, mas o DonutVault perde cor própria.
2. **Meio a meio (escolhido).** Estrutura do GuardList; amarelo do DonutVault como cor de ação,
   pontinhos de gibi fracos no fundo e títulos na fonte arredondada. O dono escolheu este depois de ver
   as três opções descritas, e confirmou ao ver o esboço.
3. **Tema alternável.** Visual do GuardList por padrão e um "Modo anos 90" com o desenho animado
   completo. Descartado: são dois visuais para manter a cada tela nova.

## O que vem do GuardList

Fonte: `GuardList/DESIGN.md`, `src/styles/palettes/evening-mix.css`, `src/styles/glass.css`,
`src/components/Sidebar.css`, `src/components/AmbientLight.tsx`.

- **Cores de base** da paleta Evening Mix, nos dois temas: fundo, superfícies, linhas, texto, texto
  suave, texto apagado e as três cores de estado (perigo, atenção, sucesso).
- **Vidro fosco** para menu lateral, cartões, painéis, busca e modais, com os mesmos valores de
  desfoque, borda e brilho interno.
- **Fundo vivo:** as faixas de luz diagonais que derivam devagar.
- **Menu lateral** flutuante, com cantos de 24 px, linhas de 46 px e faixa no item ativo.
- **Tipografia:** IBM Plex Sans no texto e nos rótulos; IBM Plex Mono com numerais tabulares em
  senhas, usuários, datas, contadores e códigos.
- **Raios:** 8 px em controles, 11 a 12 px em cartões e painéis, 24 px no menu, pílula em etiquetas.
- **Densidade de bancada:** rótulos curtos, tabelas compactas, números em destaque no topo da tela.

## O que fica do DonutVault

- **Amarelo `#FFD90F` como única cor de ação:** botões principais, foco, item ativo do menu. Texto
  sobre o amarelo sempre escuro (`#0E0D15`).
- **Pontinhos de gibi** no fundo, bem fracos, por baixo das faixas de luz.
- **Títulos em Bricolage Grotesque** (a fonte arredondada atual), só em títulos de tela e de painel.
- **Rosquinha com fechadura como marca.** O dono enviou a arte (rosquinha de cobertura rosa com
  confeitos e uma fechadura no centro) e pediu que ela substitua o mascote, que achou feio. Ela entra no
  palco do desbloqueio, no topo do menu lateral, na foto de perfil, translúcida no fundo do app (onde o
  GuardList põe a própria logo), nas telas vazias e nos avisos. Substitui também a logo atual do escudo
  (`DonutVaultLogo`) e o ícone da aba do navegador.
- **Barnaby sai da interface.** O componente `BarnabyMascot` deixa de ser usado. Decisão de quem
  escreveu, a partir do pedido do dono; se ele quiser o mascote em algum lugar, volta só ali.
- **Porta do cofre** (`CartoonVaultDoor`) e o confete de comemoração, onde já são usados hoje.
- **Rosa e azul-céu** só dentro da marca e nos ícones coloridos de serviço. Não são cores de
  interface.

## O que sai

- Bordas pretas grossas e sombras duras deslocadas (o estilo neobrutal: `shadow-shadow`,
  `shadow-brutal-*`, `border-2`, `border-4`).
- Fundo creme e fundos chapados em amarelo, rosa e azul em cartões inteiros.
- Peso de fonte 800 a 900 em texto corrido e rótulos (`font-black` aparece 83 vezes).
- Plus Jakarta Sans e JetBrains Mono, trocadas pelas duas IBM Plex.

## Tela por tela

- **Desbloqueio e boas-vindas (`WelcomeScreen.tsx`).** Duas colunas: palco à esquerda (rosquinha com fechadura, nome,
  frase curta, selo de estado) e painel de vidro à direita com o formulário. Criar cofre, abrir cofre e
  restaurar backup usam o mesmo painel. Em tela estreita o palco encolhe e fica acima do painel.
- **Casca do app (`App.tsx`).** Menu lateral em vidro com os nove itens atuais, busca e ações no topo,
  conteúdo à direita. O menu inferior do celular continua, com o visual novo.
- **Início (`DashboardView.tsx`).** Números em destaque em cartões de vidro; atalhos como botões.
- **Senhas, Favoritos, Categorias, Lixeira (`PasswordsView.tsx`).** Três números no topo, tabela densa
  em vidro, etiquetas de força nas cores de estado, formulário de edição em modal de vidro.
- **Gerador (`GeneratorView.tsx`).** A senha gerada em monoespaçado grande; controles no padrão novo.
- **Saúde das senhas (`SecurityAuditView.tsx`).** Lista por gravidade nas cores de estado; a rosquinha no
  resumo.
- **Notas seguras (`SecretNotesView.tsx`).** Cartões de vidro; editor em modal.
- **Configurações e sincronização (`SettingsView.tsx`, `SyncDashboardPanel.tsx`).** Seções em painéis
  de vidro; ações perigosas com a cor de perigo e sem enfeite.

## Tema claro

Segue o tema claro do GuardList (papel frio `#F1EEF3`, superfícies brancas, texto azul-marinho). O
amarelo continua como preenchimento dos botões, com texto escuro. Como amarelo sobre branco não tem
contraste para texto, no tema claro o item ativo do menu e os links usam o azul-marinho do GuardList
(`#3D5387`), com a faixa amarela só como marca lateral. Decisão de quem escreveu este documento; o dono
só viu o esboço no tema escuro.

## Decisões tomadas por quem escreveu (para o dono conferir)

- Manter os dois temas, em vez de só o escuro.
- Servir as fontes pelo próprio app e retirar o Google Fonts da CSP.
- Rosquinha com fechadura translúcida no fundo do app, no lugar da logo do GuardList.
- Barnaby fora da interface e a rosquinha com fechadura também no lugar da logo do escudo.
- Regra do tema claro descrita acima.
- Copiar os estilos do GuardList para este repositório, sem dependência entre os dois.

## Deixado para quem construir

- A arte final da rosquinha com fechadura. No esboço ela foi redesenhada em vetor a partir da imagem
  enviada pelo dono; se ele tiver o arquivo original em vetor, usar o dele.
- Como organizar os tokens: reaproveitar os nomes atuais do Tailwind (`--background`, `--main`,
  `--border`…) com valores novos, ou adotar os nomes do GuardList (`--app-bg`, `--surface`, `--action`…).
  Os componentes de `src/components/ui/` concentram boa parte do estilo e são o ponto natural de troca.
- A ordem das telas. Sugestão: tokens e casca primeiro, depois desbloqueio, senhas e o restante.
- Valores finos de espaçamento e de opacidade dos pontinhos, ajustados olhando a tela real.

## Como saber que ficou pronto

- As nove áreas do menu e a tela de desbloqueio seguem este documento, nos dois temas, em tela larga e
  em celular.
- Texto e controles passam em contraste AA nos dois temas.
- `npx tsc --noEmit`, `npm test` e `npx vite build` passam; o pacote principal segue abaixo de 500 kB.
- Em produção, a página carrega sem violação de CSP no console.
- Criar cofre, abrir, adicionar e editar senha, gerar senha, sincronizar e trancar funcionam como antes.
