---
name: GuardList
description: Cofre operacional para manutenção e investigação de blocklists isoladas por cliente.
colors:
  vault-blue: "#5791ff"
  vault-blue-day: "#2f6fdf"
  vault-action: "#2f6fdf"
  vault-action-hover: "#285fc5"
  vault-blue-soft: "rgba(87, 145, 255, 0.12)"
  vault-blue-deep: "#1d3f8f"
  vault-steel: "#0a0c10"
  vault-steel-console: "#101319"
  vault-steel-surface: "#131820"
  vault-steel-raised: "#181e27"
  vault-steel-recess: "#0f1319"
  vault-steel-seam: "#29313d"
  vault-steel-seam-strong: "#3a4554"
  bank-paper: "#f3f5f8"
  bank-paper-sheet: "#ffffff"
  bank-paper-recess: "#edf1f5"
  bank-paper-seam: "#d9e0e8"
  ink-night: "#f2f5f8"
  ink-night-soft: "#c3cbd5"
  ink-night-muted: "#8e9aaa"
  ink-day: "#17202b"
  ink-day-soft: "#344154"
  ink-day-muted: "#5f6d80"
  danger: "#f56a77"
  warning: "#e7ab4e"
  success: "#4ec995"
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
    backgroundColor: "{colors.vault-action}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.vault-steel-surface}"
    textColor: "{colors.ink-night}"
    rounded: "{rounded.surface}"
    padding: "18px 20px"
  input:
    backgroundColor: "{colors.vault-steel-recess}"
    textColor: "{colors.ink-night}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  sidebar-console:
    backgroundColor: "{colors.vault-steel-console}"
    textColor: "{colors.ink-night-muted}"
    rounded: "{rounded.console}"
    width: "280px"
  sidebar-console-collapsed:
    backgroundColor: "{colors.vault-steel-console}"
    rounded: "{rounded.console}"
    width: "70px"
  nav-row:
    textColor: "{colors.ink-night-muted}"
    height: "46px"
    padding: "0 24px"
  nav-row-active:
    backgroundColor: "{colors.vault-blue-soft}"
    textColor: "{colors.vault-blue}"
    height: "46px"
  login-door:
    backgroundColor: "{colors.vault-steel-surface}"
    rounded: "{rounded.console}"
    width: "660px"
    height: "520px"
  login-submit:
    backgroundColor: "{colors.vault-action}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    height: "44px"
---

# Design System: GuardList

## Overview

**Creative North Star: "The Perimeter Vault"**

O GuardList é um cofre de perímetros. Cada cliente é um compartimento isolado, e a interface existe para guardar essa separação com calma: nada vaza de um cofre para outro, nada grita, tudo tem lugar e estado. O tom é sóbrio e firme. A interface guarda, não assusta.

O trabalho acontece sobre aço escuro (ou papel bancário no tema claro), em superfícies planas separadas por tom e por costuras de 1px. Acima delas flutua um único console, a sidebar, que acompanha o operador por todas as salas do cofre. A entrada é uma porta: a tela de login, o único lugar onde a marca ganha um painel próprio, com a porta do cofre em aço azulado em movimento lento. Dentro, a densidade é de bancada técnica: rótulos curtos, números tabulares e um só azul para agir.

**Key Characteristics:**

- Um console flutuante (sidebar) acima de uma bancada plana.
- Isolamento visível: cada cliente em sua própria superfície, sem misturar estados.
- Um único azul de ação; verde, amarelo e vermelho apenas para estado.
- Profundidade em camadas suaves: o conteúdo é plano, o que flutua tem sombra ambiente.
- Dois turnos com o mesmo sistema: aço (escuro) e papel bancário (claro).
- Dados técnicos sempre em monoespaçado com numerais tabulares.

## Colors

Aço quase preto ou papel bancário frio, um azul de cofre para tudo o que se aciona e três cores semânticas guardadas para estado.

### Primary

- **Vault Blue** (escuro) e **Vault Blue Day** (claro): seleção, foco e item ativo da navegação. **Vault Action** é o fundo dos botões com texto branco nos dois temas, com hover mais escuro, para manter contraste de leitura.
- **Vault Blue Soft:** faixa do item ativo na sidebar, anel de foco de campos e fundos de seleção.
- **Vault Blue Deep:** só no painel de marca do login, como fim do degradê, e no avatar do perfil.

### Neutral

- **Vault Steel:** fundo contínuo da aplicação no tema escuro.
- **Vault Steel Console:** a chapa da sidebar flutuante.
- **Vault Steel Surface / Raised / Recess:** cards e tabelas, áreas elevadas por tom e campos rebaixados.
- **Vault Steel Seam / Seam Strong:** costuras de 1px que separam compartimentos e marcam bordas de controle.
- **Bank Paper / Sheet / Recess / Seam:** os mesmos papéis no tema claro, com fundo cinza frio, folhas brancas, recessos e costuras claras.
- **Ink Night / Ink Day** (com Soft e Muted): três níveis de leitura por tema, sem recorrer a opacidade.

### Semantic

- **Danger:** atraso fora do SLA, risco e ações destrutivas.
- **Warning:** prazos próximos e indicador de backup pendente no único acesso “Backup e ajustes”.
- **Success:** em dia, importação concluída.

### Named Rules

**The One Key Rule.** Só existe uma chave: o azul. Roxo, ciano ou verde nunca formam uma família paralela de ação.

**The Semantic Reserve Rule.** Verde, amarelo e vermelho comunicam estado e mais nada. Sempre acompanhados de texto ou ícone.

**The Two Shifts Rule.** Todo componente novo precisa existir nos dois temas, aço e papel bancário, usando os tokens de tema, nunca hex fixo no componente.

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

No desktop (a partir de 1024px), o console flutua a 24px das bordas superior, esquerda e inferior, com 280px aberto ou 70px recolhido. A escolha fica salva por navegador. O conteúdo reserva o espaço do console mais as duas margens de 24px e desliza junto quando ele recolhe (0.35s). A bancada usa padding fluido (16 a 42px), resumos em quatro colunas e tabelas com rolagem só quando a densidade exige. Toda página começa com o PageHeader (título, uma frase de contexto e ações à direita). Não há rodapé.

O painel geral usa duas colunas a partir de 1280px: a fila de manutenção e uma coluna lateral fixa de 300px com Esta semana (prazos por urgência), Mais recorrentes (indicadores em vários clientes, com barra proporcional) e Últimas importações. Abaixo de 1280px a coluna desce para depois da fila.

Abaixo de 1024px, o console vira gaveta. Uma barra superior fixa traz menu, marca e busca; a gaveta abre sobre um véu escuro e fecha por X, Escape ou toque fora. Em telas estreitas, os resumos ficam em grade 2×2 e o conteúdo usa margens de 14px. A ordem responsiva preserva título, estado, ação principal e dados antes de opções secundárias.

O login centraliza um cartão de 660×520px: formulário à esquerda, painel de marca à direita. Abaixo de 680px, o cartão vira coluna com o painel em faixa de 200px no topo.

## Elevation & Depth

Camadas suaves. A bancada é plana: profundidade vem do tom (aço, superfície, elevado, recesso) e das costuras de 1px. Sombra existe apenas no que flutua acima da bancada (console, modais, toasts, dicas), e sempre ambiente: larga, difusa e de baixa opacidade. Degradê é reservado a painéis de marca. Hoje existe um só, a porta do login.

### Shadow Vocabulary

- **Console float** (`0 0 0 1px seam, 0 12px 40px rgba(0,0,0,0.35)` no escuro; `0 12px 40px rgba(31,26,74,0.08)` no claro): sidebar flutuante.
- **Door float** (`0 0 0 1px seam, 0 12px 80px rgba(41,30,113,0.12)`): cartão de login.
- **Tip lift** (`0 6px 18px rgba(0,0,0,0.2)`): dicas flutuantes e toasts.
- **Avatar lift** (`0 6px 16px rgba(31,26,74,0.16)`): avatar do perfil.

### Named Rules

**The Floating Layer Rule.** Só ganha sombra o que flutua sobre a bancada. Card, tabela, campo e botão ficam planos; botões nunca têm sombra.

**The Brand Panel Rule.** Degradê e imagem de marca só em painel de marca dedicado, como a porta do login. Nunca em botões, cards de dados ou estados.

## Shapes

Precisos e contidos na bancada, generosos no que flutua. Controles usam 8px; cards e painéis, 11–12px. O console e a porta do login usam 24px, com cantos internos de 18px quando há uma chapa interna. Pílulas (999px) ficam para status curtos, o interruptor de tema e o botão de entrar do login. Costuras são finas e contínuas.

**The Float-Is-Round Rule.** Quanto mais um elemento flutua, mais arredondado ele é: bancada com 8–12px, console e porta com 24px.

## Components

### Buttons

- **Shape:** cantos de controle (8px), 34px de altura (30px no tamanho sm), área de toque preservada.
- **Variantes (classe .btn):** neutro (padrão), --primary (Vault Blue), --quiet (sem borda, para ações de ícone) e --danger (texto vermelho, fundo só no hover). Não existem outras cores de botão.
- **Um azul por região:** só a ação principal de cada área é primária. Na fila de manutenção, Importar fica azul apenas nos clientes atrasados ou com prazo próximo.
- **Hover / Focus:** mudança tonal discreta, 1px de afundamento ao clicar e contorno azul visível; sem sombra.
- **Exceção da porta:** no login, o botão Entrar é pílula (44px de altura), com ícone e estado de carregamento.

### Chips

- **Style:** fundo tonal baixo, borda semântica e texto curto.
- **State:** azul para seleção; verde, amarelo e vermelho só para condição operacional (Em dia, Atrasado).

### Cards / Containers

- **Corner Style:** superfície suavemente curva (11–12px).
- **Background:** Vault Steel Surface sobre Vault Steel, ou Sheet sobre Bank Paper.
- **Shadow Strategy:** nenhuma (ver Floating Layer Rule).
- **Border:** costura de 1px.
- **Internal Padding:** 14–20px conforme densidade.

### Inputs / Fields

- **Style:** fundo de recesso, costura forte e raio de controle (8px). No login, 42px de altura e raio de 12px.
- **Focus:** borda azul com anel Vault Blue Soft de 3px.
- **Error / Disabled:** mensagem em Danger abaixo do campo com `role="alert"`; desabilitado em tom rebaixado, sempre com contraste suficiente.

### Motion

- **Troca de tela:** cada página entra subindo 8px a partir de quase visível (320ms, ease-out exponencial).
- **Troca de tema:** o novo tema se revela em círculo a partir do botão (View Transitions API); o ícone sol/lua gira ao trocar. Sem a API ou com reduced-motion, a troca é imediata.
- **Diálogos e avisos:** véu em fade e painel subindo com leve escala (360ms); o toast entra de baixo.
- **Dados:** barras de recorrência e de volume semanal crescem uma vez ao aparecer.
- Tudo respeita prefers-reduced-motion.

### Navigation

O console é a navegação. De cima para baixo: marca e botão de recolher (48px, 13px de raio), costura, perfil (avatar de 46px com iniciais e "Acesso autorizado"), Consultar IP com atalho Ctrl K, os sete destinos, costura, linha de backup (amarela quando pendente), interruptor de modo escuro e Sair.

- **Linhas:** 46px de altura, ícone linear de 22px, rótulo de 0.86rem e cor Muted, que vira Ink no hover.
- **Ativo:** faixa Vault Blue Soft com uma pílula azul de 8×16px na borda direita. A faixa desliza até o item com `cubic-bezier(0.34, 1.16, 0.42, 1)` em 0.38s, uma leve "mola" de trinco.
- **Recolhido:** só ícones, com dica flutuante à direita no hover ou foco. Toda linha tem `aria-label`.
- **Mobile:** gaveta com a mesma ordem e um X no lugar do botão de recolher.

### Signature: The Vault Door (Login)

Cartão de 660×520px com moldura interna de 8px. O formulário (usuário, senha com mostrar/ocultar, erro, Entrar) fica à esquerda. À direita, o painel de marca: um loop silencioso de 9s do mecanismo da porta do cofre (`public/brand/login-vault-loop.mp4`, 480×720, ~640 KB, com crossfade de 1s na emenda) sob um véu radial de Vault Blue Deep, mais denso no centro para a marca GuardList continuar legível. O pôster (`login-vault-poster.webp`) é o primeiro quadro do loop e aparece sozinho com `prefers-reduced-motion` ou economia de dados; o degradê azul é o último fallback. Na entrada, o painel desliza 0.65s da esquerda para a direita e o texto surge em fade, como uma porta que se fecha atrás do operador. Respeita `prefers-reduced-motion`. Não existe cadastro: o acesso é concedido pelo administrador.

### Dialogs

Têm nome acessível, foco inicial, contenção de Tab, fechamento por Escape e restauração de foco. O véu escurece o contexto; o diálogo usa a sombra Tip lift ou maior, nunca brilho.

## Do's and Don'ts

### Do:

- **Do** comece toda página com o PageHeader e o mesmo título do item de navegação.
- **Do** mostre no botão de tema o tema de destino ("Modo claro" no escuro, "Modo escuro" no claro).
- **Do** dê a todo estado vazio uma frase do que vai aparecer ali e, quando houver, o botão para chegar lá.

- **Do** mantenha cada cliente em sua própria superfície e seu próprio estado. O isolamento é visível.
- **Do** use Vault Blue para ação, foco e item ativo em todas as telas.
- **Do** dê sombra ambiente apenas ao que flutua: console, modais, toasts e dicas.
- **Do** mantenha IPs, CIDRs, datas e contagens em monoespaçado tabular.
- **Do** construa nos dois temas com os tokens de tema (`--accent`, `--surface`, `--line`…).
- **Do** rebaixe diagnóstico e manutenção para seções recolhíveis.

### Don't:

- **Don't** use slogans, heróis, métricas gigantes ou composição de landing page dentro do app.
- **Don't** crie famílias roxa, ciano ou verde para ações comuns.
- **Don't** coloque degradê em botões, cards de dados ou estados. Degradê é só para painel de marca.
- **Don't** dê sombra a cards, tabelas, campos ou botões da bancada.
- **Don't** comunique risco só por cor; mantenha texto e ícone de estado.
- **Don't** ofereça autocadastro: a porta só abre para usuários concedidos.
- **Don't** use marcas de interface gerada: ícones de brilho ou varinha mágica, emojis, selos decorativos ("100%", "seguro", "regra crítica"), tabelas de arquitetura ou textos de marketing dentro do app.
- **Don't** escreva "com sucesso!" nem use exclamações; confirme o fato ("Backup baixado.").
- **Don't** use Formato De Título ou CAIXA ALTA em títulos, abas e cabeçalhos de tabela; sempre sentence case.
- **Don't** coloque ícone colorido em caixa ao lado do título da página.
