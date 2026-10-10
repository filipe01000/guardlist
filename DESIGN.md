---
name: GuardList
description: Bancada operacional para manutenção e investigação de blocklists isoladas por cliente.
colors:
  action-blue: "#5791ff"
  action-blue-soft: "rgba(87, 145, 255, 0.12)"
  canvas-charcoal: "#0a0c10"
  sidebar-charcoal: "#101319"
  surface-graphite: "#131820"
  surface-raised: "#181e27"
  surface-subtle: "#0f1319"
  divider: "#29313d"
  divider-strong: "#3a4554"
  text-primary: "#f2f5f8"
  text-secondary: "#c3cbd5"
  text-muted: "#8e9aaa"
  danger: "#f56a77"
  warning: "#e7ab4e"
  success: "#4ec995"
typography:
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1.55rem"
    fontWeight: 720
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.68rem"
    fontWeight: 620
    lineHeight: 1.3
  data:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "1.45rem"
    fontWeight: 650
    lineHeight: 1.2
rounded:
  control: "8px"
  surface: "11px"
  panel: "12px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "14px"
  lg: "20px"
  xl: "30px"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.surface-graphite}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.surface}"
    padding: "18px 20px"
  input:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
---

# Design System: GuardList

## Overview

**Creative North Star: "Laboratory Chain-of-Custody Worksheet"**

O GuardList é uma bancada operacional digital: sóbria, precisa e orientada a evidências. A interface deve parecer uma ferramenta usada continuamente por analistas de segurança, com alta densidade informacional, hierarquia curta e ações inequívocas.

Superfícies carvão, divisórias finas e numerais tabulares dão ritmo de registro técnico sem simular papel ou terminal. O sistema rejeita composição de campanha, slogans, métricas gigantes, brilhos e qualquer decoração que concorra com estado, urgência ou procedência dos dados.

**Key Characteristics:**

- Navegação persistente e compacta.
- Um único azul para ações; cores semânticas apenas para estado.
- Superfícies planas separadas por tom e linha, não por sombra ornamental.
- Dados numéricos alinhados e legíveis em varredura rápida.
- Mesma linguagem visual em painel, importação, listas, histórico, clientes e ajustes.

## Colors

A paleta combina carvão quase preto com um azul de ação frio e três cores semânticas reservadas.

### Primary

- **Action Blue:** usado em seleção, foco e ações primárias; deve permanecer raro o bastante para indicar intenção.

### Neutral

- **Canvas Charcoal:** fundo contínuo da aplicação.
- **Sidebar Charcoal:** plano estrutural da navegação.
- **Surface Graphite:** cards, tabelas e painéis de trabalho.
- **Divider / Divider Strong:** estrutura, agrupamento e estados de foco discreto.
- **Primary, Secondary e Muted Text:** três níveis de leitura sem recorrer a opacidade excessiva.

### Named Rules

**The One Action Voice Rule.** Azul representa interação; roxo e ciano não formam famílias paralelas de ação.

**The Semantic Reserve Rule.** Verde, amarelo e vermelho só comunicam sucesso, atenção e risco.

## Typography

**Display Font:** System UI sans-serif
**Body Font:** System UI sans-serif
**Label/Mono Font:** SFMono-compatible monospace

**Character:** compacta, neutra e confiável. O sans organiza instruções e controles; o monoespaçado diferencia IPs, CIDRs, datas e contagens.

### Hierarchy

- **Headline:** forte e curto, usado uma vez por página.
- **Title:** identifica seções e clientes sem competir com o título da página.
- **Body:** texto operacional direto, preferencialmente abaixo de 70 caracteres por linha.
- **Label:** pequeno e firme, usado para metadados e cabeçalhos.
- **Data:** monoespaçado com numerais tabulares para comparação rápida.

### Named Rules

**The Evidence Type Rule.** Valores técnicos e identificadores usam monoespaçado; explicações e comandos usam sans-serif.

## Layout

No desktop, uma barra lateral fixa de 252px mantém contexto e libera o restante da largura para trabalho. O conteúdo usa padding fluido entre 22px e 42px, resumos em quatro colunas e tabelas com rolagem apenas quando a densidade exige.

Abaixo de 1024px, a navegação vira uma faixa horizontal aderente ao topo. Em telas estreitas, resumos ficam em grade 2×2 e o conteúdo recebe margens de 14px. A ordem responsiva preserva título, estado, ação principal e dados antes de opções secundárias.

## Elevation & Depth

O sistema é plano por padrão. Profundidade vem da diferença entre canvas, sidebar e superfícies, reforçada por bordas de 1px. Sombras não são linguagem estrutural e devem ser removidas de controles comuns.

**The Flat-by-Default Rule.** Uma superfície precisa justificar seu nível por função e agrupamento, não por brilho ou elevação decorativa.

## Shapes

Controles usam cantos contidos de 8px; cards e painéis usam 11–12px. Pills ficam restritas a estados breves e filtros compactos. Bordas são finas, contínuas e nunca luminosas.

## Components

### Buttons

- **Shape:** cantos de controle, altura compacta e área de toque preservada.
- **Primary:** azul de ação com texto claro.
- **Hover / Focus:** mudança tonal discreta e contorno visível; sem deslocamento ou glow.
- **Secondary / Ghost:** grafite, borda neutra e texto secundário.

### Chips

- **Style:** fundo tonal baixo, borda semântica e texto curto.
- **State:** azul para seleção; verde, amarelo e vermelho apenas para condição operacional.

### Cards / Containers

- **Corner Style:** superfície suavemente curva.
- **Background:** grafite sobre canvas carvão.
- **Shadow Strategy:** nenhuma sombra em repouso.
- **Border:** divisor neutro de 1px.
- **Internal Padding:** 14–20px conforme densidade.

### Inputs / Fields

- **Style:** fundo sutil, borda neutra e raio de controle.
- **Focus:** borda azul e outline visível.
- **Error / Disabled:** cor semântica ou grafite desaturado, sempre com contraste de texto suficiente.

### Navigation

A navegação usa texto compacto, ícone linear e estado ativo com fundo azul suave e marcador de 2px. No mobile, mantém a mesma ordem em uma faixa horizontal rolável sem scrollbar decorativa.

### Operational Summary

Quatro células compartilham uma única superfície. Cada célula contém rótulo, valor tabular e contexto curto; apenas células acionáveis respondem ao hover.

### Dialogs

Diálogos têm nome acessível, foco inicial, contenção de Tab, fechamento por Escape e restauração de foco. O overlay escurece o contexto sem efeitos visuais promocionais.

## Do's and Don'ts

### Do:

- **Do** priorize o próximo trabalho operacional e o estado do dado.
- **Do** use azul para ações e foco em todas as páginas.
- **Do** mantenha numerais, IPs, CIDRs e datas alinhados com fonte monoespaçada.
- **Do** rebaixe diagnóstico e manutenção para seções recolhíveis.

### Don't:

- **Don't** use slogans, heróis, métricas gigantes ou composição de landing page.
- **Don't** crie famílias roxa, ciano ou verde para ações comuns.
- **Don't** use glow, gradientes decorativos ou sombras para simular importância.
- **Don't** esconda diferenças de risco usando apenas cor; mantenha texto e ícone de estado.
