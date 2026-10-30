---
name: GuardList
description: Perímetro operacional para manutenção e investigação de blocklists isoladas por cliente.
colors:
  night-bg: "#0E0D15"
  night-sidebar: "#11121E"
  night-surface: "#182346"
  night-surface-raised: "#1F2D58"
  night-surface-subtle: "#131A35"
  night-line: "#2C3C68"
  night-line-strong: "#3D5387"
  night-text: "#F3F0F6"
  night-text-soft: "#D5CCD8"
  night-muted: "#9EA4C8"
  night-action: "#BFA9BA"
  night-action-hover: "#D3C2CF"
  night-action-text: "#0E0D15"
  night-accent-soft: "rgba(191, 169, 186, 0.14)"
  day-bg: "#F1EEF3"
  day-surface: "#ffffff"
  day-surface-raised: "#F6F3F7"
  day-line: "#DAD4E0"
  day-text: "#182346"
  day-muted: "#5D6389"
  day-action: "#3D5387"
  day-action-hover: "#182346"
  glass-night: "rgba(24, 35, 70, 0.52)"
  glass-day: "rgba(255, 255, 255, 0.62)"
  glass-line-night: "rgba(191, 169, 186, 0.13)"
  cyan-hot: "#D9CCD6"
  danger: "#ff6b7a"
  warning: "#f2b04f"
  success: "#3fd69b"
typography:
  headline:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, Segoe UI, sans-serif"
    fontSize: "1.45rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, Segoe UI, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, Segoe UI, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 620
    lineHeight: 1.3
  data:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "1.45rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.03em"
rounded:
  control: "8px"
  surface: "11px"
  panel: "12px"
  console-key: "13px"
  inset: "18px"
  console: "24px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "14px"
  lg: "20px"
  gutter: "24px"
  xl: "30px"
components:
  button-primary:
    backgroundColor: "{colors.night-action}"
    textColor: "{colors.night-action-text}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.glass-night}"
    textColor: "{colors.night-text}"
    rounded: "{rounded.surface}"
    padding: "18px 20px"
  input:
    backgroundColor: "{colors.night-surface-subtle}"
    textColor: "{colors.night-text}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  sidebar-console:
    backgroundColor: "{colors.glass-night}"
    textColor: "{colors.night-muted}"
    rounded: "{rounded.console}"
    width: "280px"
  sidebar-console-collapsed:
    backgroundColor: "{colors.glass-night}"
    rounded: "{rounded.console}"
    width: "70px"
  nav-row:
    textColor: "{colors.night-muted}"
    height: "46px"
    padding: "0 24px"
  nav-row-active:
    backgroundColor: "{colors.night-accent-soft}"
    textColor: "{colors.night-action}"
    height: "46px"
  login-panel:
    backgroundColor: "rgba(10, 18, 36, 0.58)"
    width: "48%"
  login-submit:
    backgroundColor: "{colors.night-action}"
    textColor: "{colors.night-action-text}"
    rounded: "10px"
    height: "50px"
---

# Design System: GuardList

> **Paletas:** as cores ficam em `src/styles/palettes/`. A ativa é a Evening Mix (`evening-mix.css`); a anterior, Azul-noite, está guardada em `azul-noite.css`. Para trocar, mude o `@import` no topo de `src/index.css`. Os valores do cabeçalho acima são os da paleta ativa; menções a azul ou ciano no texto abaixo descrevem a Azul-noite. Vermelho, âmbar e verde ficam fora da paleta de marca: são alertas.

## Overview

**Creative North Star: "The Perimeter"**

O GuardList guarda o perímetro de cada cliente. Cada cliente é um compartimento isolado, e a interface existe para manter essa separação com calma: nada vaza de uma lista para outra, nada grita, tudo tem lugar e estado. O tom é sóbrio e firme. A interface guarda, não assusta.

O trabalho acontece sobre azul-noite (ou papel frio no tema claro). Ao fundo passam faixas de luz diagonais em movimento lento e a logo do GuardList, grande e translúcida. Por cima, painéis de vidro fosco: o console (a sidebar), a barra de busca, os cards e os modais. A entrada é a tela de login, o único lugar onde a marca ganha um palco próprio: o perímetro animado, com anéis que barram ameaças. Dentro do app, a densidade é de bancada técnica: rótulos curtos, números tabulares e um só azul para agir.

**Key Characteristics:**

- Fundo vivo e discreto (faixas de luz e logo translúcida); conteúdo em vidro fosco por cima.
- Isolamento visível: cada cliente em sua própria superfície, sem misturar estados.
- Um único azul de ação; verde, amarelo e vermelho apenas para estado.
- Dois turnos com o mesmo sistema: azul-noite (escuro) e papel frio (claro).
- Dados técnicos sempre em monoespaçado com numerais tabulares.

## Colors

Azul-noite profundo ou papel frio, um azul-ciano para tudo o que se aciona e três cores semânticas guardadas para estado. Os tokens ficam em `src/index.css` (`--app-bg`, `--surface`, `--line`, `--text`, `--muted`, `--action`…) e os do vidro em `src/styles/glass.css` (`--glass`, `--glass-line`, `--glass-blur`, `--ambient-*`).

### Primary

- **Action** (`#2ea6ff` no escuro, `#0a6fc2` no claro): botões principais, seleção, foco e item ativo da navegação. No escuro o texto do botão é azul-marinho (`#04132b`); no claro, branco.
- **Accent Soft:** faixa do item ativo na sidebar, anel de foco e fundos de seleção.
- **Cyan Hot** (`#7dd3fc`): brilho de marca. Só no login (perímetro, borda do vidro, "Perímetro selado") e em detalhes da logo.

### Neutral

- **Night BG / Sidebar / Surface / Raised / Subtle:** fundo da aplicação, console e as camadas de cards, áreas elevadas e campos.
- **Line / Line Strong:** costuras de 1px que separam compartimentos e marcam bordas de controle.
- **Glass / Glass Strong / Glass Line:** painéis translúcidos com `backdrop-filter` sobre o fundo de luz.
- **Day BG / Surface / Line / Text / Muted:** os mesmos papéis no tema claro.
- **Text / Text Soft / Muted:** três níveis de leitura por tema, sem recorrer a opacidade.

### Semantic

- **Danger:** atraso fora do prazo, risco, senha recusada e ações destrutivas.
- **Warning:** prazos próximos e backup pendente.
- **Success:** em dia, importação concluída.

### Named Rules

**The One Key Rule.** Só existe uma chave: o azul de ação. Roxo, ciano ou verde nunca formam uma família paralela de ação.

**The Semantic Reserve Rule.** Verde, amarelo e vermelho comunicam estado e mais nada. Sempre acompanhados de texto ou ícone.

**The Two Shifts Rule.** Todo componente novo precisa existir nos dois temas, usando os tokens de tema, nunca hex fixo no componente. Exceção: o palco do login e o perímetro, que são sempre escuros.

## Typography

**Display Font:** IBM Plex Sans (auto-hospedada via @fontsource; pesos 400–700, latin + latin-ext)
**Body Font:** IBM Plex Sans
**Label/Mono Font:** IBM Plex Mono (400–600)

**Character:** técnica, sóbria e institucional, com cara de ferramenta de segurança e não de produto genérico. O sans conduz instruções e controles; o monoespaçado identifica o que é evidência (IPs, CIDRs, datas, contagens). Fontes vêm do próprio bundle, nunca de CDN.

### Hierarchy

- **Headline** (700, 1.45rem, 1.2): título da página no componente PageHeader, uma vez por tela, sempre em sentence case e igual ao rótulo da navegação.
- **Title** (700, 0.9rem, 1.3): nome de cliente, título de seção e nome no perfil da sidebar.
- **Body** (400, 0.78rem, 1.5): texto operacional, até cerca de 70 caracteres por linha.
- **Label** (620, 0.68rem): metadados, cabeçalhos de coluna e rótulos de resumo.
- **Data** (650, 1.45rem, mono, tabular): valores dos resumos operacionais; em tabelas, o mesmo monoespaçado em tamanho de corpo.

### Named Rules

**The Evidence Type Rule.** Valor técnico ou identificador usa monoespaçado; explicação e comando usam sans-serif.

## Layout

No desktop (a partir de 1024px), o console flutua a 24px das bordas superior, esquerda e inferior, com 280px aberto ou 70px recolhido. A escolha fica salva por navegador. O conteúdo reserva o espaço do console mais as duas margens de 24px e desliza junto quando ele recolhe (0.35s). No topo do conteúdo ficam a busca (Ctrl K) e as ações globais (Gerar caso, Assistente IA). Toda página começa com o PageHeader (título, uma frase de contexto e ações à direita). Não há rodapé.

O painel geral usa duas colunas: a fila de clientes em cards (com logo, prazo e contagem de IPs e CIDRs) ou em tabela, e uma coluna lateral com Próximos prazos e Mais recorrentes. Em telas menores a coluna desce para depois da fila.

Abaixo de 1024px, o console vira gaveta. Uma barra superior fixa traz menu, marca e busca; a gaveta abre sobre um véu escuro e fecha por X, Escape ou toque fora. Em telas estreitas, os resumos ficam em grade 2×2. A ordem responsiva preserva título, estado, ação principal e dados antes de opções secundárias.

O login ocupa a tela inteira em duas colunas (52/48): o palco do perímetro à esquerda e o formulário à direita, num painel de vidro sobre a mesma animação. Abaixo de 900px, vira coluna: o perímetro numa faixa de 340px no topo e o formulário embaixo.

## Elevation & Depth

Camadas de vidro sobre luz. O fundo (faixas de luz e logo) fica sempre atrás; o conteúdo usa painéis translúcidos com desfoque (`--glass-blur`) e costuras de 1px. Sombra existe só no que flutua acima do conteúdo (console, modais, toasts, dicas), sempre ambiente: larga, difusa e de baixa opacidade.

### Named Rules

**The Floating Layer Rule.** Só ganha sombra o que flutua sobre o conteúdo. Card, tabela, campo e botão comum ficam sem sombra; o botão principal tem um brilho azul discreto.

**The Brand Stage Rule.** Degradê, brilho ciano e animação de marca só no fundo do app e no palco do login. Nunca em cards de dados, estados ou botões secundários.

## Shapes

Precisos e contidos no conteúdo, generosos no que flutua. Controles usam 8–10px; cards e painéis, 11–12px; o console, 24px. Pílulas (999px) ficam para status curtos e chips. Costuras são finas e contínuas.

**The Float-Is-Round Rule.** Quanto mais um elemento flutua, mais arredondado ele é: conteúdo com 8–12px, console com 24px.

## Components

### Buttons

- **Shape:** cantos de controle (8px), 34px de altura (30px no tamanho sm), área de toque preservada (44px no celular).
- **Variantes (classe .btn):** neutro (padrão), --primary (azul de ação), --quiet (sem borda, para ações de ícone) e --danger (texto vermelho, fundo só no hover). Não existem outras cores de botão.
- **Um azul por região:** só a ação principal de cada área é primária.
- **Hover / Focus:** mudança tonal discreta, 1px de afundamento ao clicar e contorno azul visível.
- **Login:** o botão Entrar tem 50px de altura, texto à esquerda e seta à direita, e um reflexo que atravessa o botão de tempos em tempos.

### Chips

- **Style:** fundo tonal baixo, borda semântica e texto curto.
- **State:** azul para seleção; verde, amarelo e vermelho só para condição operacional (Em dia, Atrasado).

### Cards / Containers

- **Corner Style:** superfície suavemente curva (11–12px).
- **Background:** vidro (`--glass`) sobre o fundo de luz.
- **Border:** costura de 1px (`--glass-line`, mais forte no hover).
- **Internal Padding:** 14–20px conforme densidade.

### Inputs / Fields

- **Style:** fundo rebaixado, costura e raio de controle (8px). No login, 48px de altura, raio de 10px e ícone à esquerda.
- **Focus:** borda azul com anel Accent Soft de 3–4px.
- **Error / Disabled:** mensagem em Danger abaixo do campo com `role="alert"`; desabilitado em tom rebaixado, sempre com contraste suficiente.

### Motion

- **Troca de tela:** cada página entra subindo 8px a partir de quase visível (320ms, ease-out exponencial).
- **Troca de tema:** o novo tema se revela em círculo a partir do botão (View Transitions API). Sem a API ou com reduced-motion, a troca é imediata.
- **Fundo:** as faixas de luz derivam devagar (28–46s por ciclo).
- **Diálogos e avisos:** véu em fade e painel subindo com leve escala (360ms); o toast entra de baixo.
- **Dados:** barras de recorrência e de volume crescem uma vez ao aparecer.
- Tudo respeita prefers-reduced-motion: o fundo fica parado e o perímetro do login vira uma imagem estática.

### Navigation

O console é a navegação. De cima para baixo: marca e botão de recolher, perfil (avatar com iniciais, nome e papel), Painel geral, os grupos Bloqueios, Análise e Gestão (recolhíveis), interruptor de tema e Sair.

- **Linhas:** 46px de altura, ícone linear de 22px, rótulo em Muted, que vira Text no hover.
- **Ativo:** faixa Accent Soft com uma marca azul na borda esquerda.
- **Recolhido:** só ícones, com dica flutuante à direita no hover ou foco. Toda linha tem `aria-label`.
- **Mobile:** gaveta com a mesma ordem e um X no lugar do botão de recolher.

### Signature: The Perimeter (Login)

Arquivos: `src/components/Login.tsx`, `Login.css` e `PerimeterCanvas.tsx`.

- **Palco (esquerda):** a frase "Cada cliente tem seu perímetro." entra palavra por palavra, com brilho correndo em "perímetro". Atrás, um canvas desenha a logo no centro, três anéis segmentados girando em velocidades diferentes, uma régua de marcações e um feixe de radar. Pontos de luz vêm de fora: os bloqueados batem no anel externo com clarão e faíscas; os liberados chegam ao núcleo. A lista "Perímetro em ação" mostra esses eventos com o selo SIMULAÇÃO e só usa IPs reservados para documentação (RFC 5737).
- **Formulário (direita):** painel de vidro fosco sobre a mesma animação, que continua desfocada atrás dele. A borda é um fio ciano com brilho, e um pulso de luz desce por ela de tempos em tempos.
- **Senha errada:** os anéis ficam vermelhos por um instante, o cadeado treme e a mensagem aparece abaixo da senha.
- **Senha certa:** o cadeado fecha, os anéis se juntam num círculo completo e o feixe acelera; a tela escurece com "Perímetro selado" e o app abre (cerca de 2s).
- As telas de verificação de sessão e de troca de senha no primeiro acesso usam a mesma moldura. Não existe cadastro: o acesso é concedido pelo administrador.

### Dialogs

Têm nome acessível, foco inicial, contenção de Tab, fechamento por Escape e restauração de foco. O véu escurece o contexto; o diálogo usa vidro mais opaco (`--glass-strong`) e sombra ambiente.

## Do's and Don'ts

### Do:

- **Do** comece toda página com o PageHeader e o mesmo título do item de navegação.
- **Do** mostre no botão de tema o tema de destino ("Modo claro" no escuro, "Modo escuro" no claro).
- **Do** dê a todo estado vazio uma frase do que vai aparecer ali e, quando houver, o botão para chegar lá.
- **Do** mostre "Carregando…" enquanto os dados não chegam, em vez do estado vazio.
- **Do** mantenha cada cliente em sua própria superfície e seu próprio estado. O isolamento é visível.
- **Do** use o azul de ação para ação, foco e item ativo em todas as telas.
- **Do** mantenha IPs, CIDRs, datas e contagens em monoespaçado tabular.
- **Do** construa nos dois temas com os tokens de tema (`--action`, `--surface`, `--line`, `--glass`…).
- **Do** rebaixe diagnóstico e manutenção para seções recolhíveis.

### Don't:

- **Don't** use slogans, heróis, métricas gigantes ou composição de landing page dentro do app. O palco do login é a única exceção.
- **Don't** mostre números ou eventos inventados como se fossem dados reais; simulação leva o selo SIMULAÇÃO.
- **Don't** crie famílias roxa, ciano ou verde para ações comuns.
- **Don't** coloque degradê em cards de dados, estados ou botões secundários.
- **Don't** comunique risco só por cor; mantenha texto e ícone de estado.
- **Don't** ofereça autocadastro: o acesso só abre para usuários concedidos.
- **Don't** use marcas de interface gerada: emojis, selos decorativos ("100%", "seguro", "regra crítica"), tabelas de arquitetura ou textos de marketing dentro do app.
- **Don't** escreva "com sucesso!" nem use exclamações; confirme o fato ("Backup baixado.").
- **Don't** use Formato De Título ou CAIXA ALTA em títulos, abas e cabeçalhos de tabela; sempre sentence case.
- **Don't** coloque ícone colorido em caixa ao lado do título da página.
