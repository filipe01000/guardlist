# Visual novo do DonutVault (puxado do GuardList) — Plano de construção

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** trocar a aparência de todas as telas do DonutVault pelo sistema visual do GuardList, no "meio a meio" aprovado, sem alterar comportamento.

**Arquitetura:** o app já estiliza por tokens do Tailwind (`bg-main`, `border-border`, `bg-secondary-background`…) definidos em `src/index.css`, e por seis componentes-base em `src/components/ui/`. O plano troca os valores dos tokens, acrescenta os tokens de vidro e de estado, reescreve os componentes-base e depois varre cada tela retirando as classes do estilo antigo. Nenhum arquivo de `src/services`, `src/server`, `src/middleware` (exceto a linha da CSP), `src/db` ou `src/utils` de lógica muda.

**Tecnologias:** React 19, Tailwind 4 (`@theme inline`), Vite 8, `@fontsource`, testes com `tsx --test`.

**Desenho:** [../specs/2026-11-13-visual-guardlist-design.md](../specs/2026-11-13-visual-guardlist-design.md). Esboço aprovado: [../specs/2026-11-13-visual-guardlist-esboco.html](../specs/2026-11-13-visual-guardlist-esboco.html). Quem executar lê os dois; o esboço é a referência de aparência para as telas de desbloqueio e de senhas.

## Restrições globais

- Só aparência. Nenhuma mudança em criptografia, sincronização, sessões, rotas ou banco.
- Todas as regras de "Não quebrar" do `AGENTS.md` valem. Em especial: sem script inline, sem `'unsafe-inline'` em `script-src`, sem CSP no `index.html`.
- Não alterar nada em `C:\Users\Usuario\Documents\GuardList`. Os estilos são lidos de lá e copiados para cá.
- Amarelo `#FFD90F` é a única cor de ação. Texto sobre amarelo sempre `#0E0D15`.
- Rosa `#FF5CA8` e azul-céu `#38BDF8` só dentro da marca e nos ícones coloridos de serviço.
- Textos da interface não mudam, salvo rótulo que não couber. Português, claro e calmo.
- Pacote principal abaixo de 500 kB. Fontes como arquivos separados.
- Animações param com `prefers-reduced-motion`. Sem `backdrop-filter`, painéis sólidos.
- Antes de cada commit: `npx tsc --noEmit` e `npx vite build`. Os testes com banco (`npm test`) seguem o roteiro do `AGENTS.md`, sempre no banco de teste, nunca no Neon.
- Commits no estilo do histórico: assunto em inglês no imperativo, corpo em tópicos com o quê e o porquê. Sem push e sem deploy.

## Pontos de atenção na revisão

1. **Cofre que já tem `theme: 'light'` salvo.** A pessoa abre e vê o tema claro. Ele precisa estar tão acabado quanto o escuro (Tarefa 2 testa o contraste; Tarefa 9 confere tela a tela).
2. **Nomes longos na tabela de senhas** (serviço, usuário, URL). A linha trunca com reticências e a tabela rola na horizontal; a página não ganha rolagem lateral (Tarefa 8).
3. **Celular de 360 px.** Desbloqueio empilha palco e painel; o app usa o menu inferior; nada estoura a largura (Tarefas 6, 7 e 9).
4. **Navegador sem `backdrop-filter`.** Os painéis ficam sólidos e legíveis (Tarefa 3).
5. **Avisos e toasts sobre o vidro.** Texto de erro e de sucesso continua legível sobre fundo translúcido, nos dois temas (Tarefa 5).

---

### Task 1: Fontes servidas pelo app e CSP sem Google Fonts

**Arquivos:**
- Modificar: `package.json`, `package-lock.json`, `src/main.tsx`, `index.html`, `src/middleware/reconDefense.ts:24-43`
- Teste: `src/utils/csp-fonts.test.ts` (novo)

**Interfaces:**
- Produz: `export const APP_CSP_PRODUCTION: string` em `src/middleware/reconDefense.ts` (hoje é `const` sem `export`). Famílias disponíveis no CSS: `'IBM Plex Sans'`, `'IBM Plex Mono'`, `'Bricolage Grotesque Variable'`.

- [ ] **Passo 1: Escrever o teste que falha**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_CSP_PRODUCTION } from '../middleware/reconDefense.ts';

test('CSP de produção não libera Google Fonts', () => {
  assert.ok(!APP_CSP_PRODUCTION.includes('googleapis'));
  assert.ok(!APP_CSP_PRODUCTION.includes('gstatic'));
  assert.ok(APP_CSP_PRODUCTION.includes("style-src 'self'"));
  assert.ok(APP_CSP_PRODUCTION.includes("font-src 'self' data:"));
  assert.ok(APP_CSP_PRODUCTION.includes("script-src 'self'"));
  assert.ok(!APP_CSP_PRODUCTION.includes("'unsafe-inline'"));
});

test('index.html não carrega nada de fora', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.ok(!/https?:\/\/fonts\./.test(html));
});
```

- [ ] **Passo 2: Rodar e ver falhar.** `npx tsx --test src/utils/csp-fonts.test.ts` → falha (export inexistente).
- [ ] **Passo 3: Instalar as fontes.** `npm install @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono @fontsource-variable/bricolage-grotesque`
- [ ] **Passo 4: Importar em `src/main.tsx`**, antes de `./index.css`: IBM Plex Sans nos pesos 400, 500, 600 e 700; IBM Plex Mono nos pesos 500 e 600; Bricolage Grotesque variável (um import). Só o subconjunto latino quando o pacote oferecer.
- [ ] **Passo 5: `index.html`.** Remover os três `<link>` do Google Fonts. Trocar as classes do `<body>` por `antialiased` (as cores passam a vir do `index.css`). Trocar "em estilo cartoon anos 90" por "com um toque dos anos 90" nas duas descrições.
- [ ] **Passo 6: CSP.** Exportar `APP_CSP_PRODUCTION`; `style-src 'self'`; `font-src 'self' data:`. A versão de desenvolvimento continua derivada por `replace`.
- [ ] **Passo 7: Rodar o teste** → passa. `npx tsc --noEmit` e `npx vite build` → sem erro; o build lista arquivos `.woff2` em `dist/assets`.
- [ ] **Passo 8: Commit.** `Serve fonts from the app and drop Google Fonts from the CSP`

### Task 2: Tokens de cor, tipografia e raio

**Arquivos:**
- Modificar: `src/index.css:1-110`
- Teste: `src/utils/theme-tokens.test.ts` (novo)

**Interfaces:**
- Produz: os tokens abaixo, com os mesmos nomes nos dois temas (`:root` é o claro, `.dark` é o escuro, como hoje), e as classes Tailwind correspondentes via `@theme inline` (`bg-surface-subtle`, `text-muted`, `border-line`, `text-accent`, `bg-accent-soft`, `text-success`, `text-warning`, `text-danger`, `rounded-surface`, `rounded-console`).

| Token | Escuro (`.dark`) | Claro (`:root`) |
| --- | --- | --- |
| `--background` | `#0E0D15` | `#F1EEF3` |
| `--secondary-background` | `#182346` | `#FFFFFF` |
| `--surface-raised` | `#1F2D58` | `#F6F3F7` |
| `--surface-subtle` | `#131A35` | `#EBE7EE` |
| `--foreground` | `#F3F0F6` | `#182346` |
| `--text-soft` | `#D5CCD8` | `#2F3C66` |
| `--muted` | `#9EA4C8` | `#5D6389` |
| `--border`, `--input`, `--line` | `#2C3C68` | `#DAD4E0` |
| `--line-strong` | `#3D5387` | `#BFA9BA` |
| `--main` | `#FFD90F` | `#FFD90F` |
| `--main-hover` | `#FFE553` | `#F2CC00` |
| `--main-foreground` | `#0E0D15` | `#0E0D15` |
| `--accent` (item ativo, links) | `#FFD90F` | `#3D5387` |
| `--accent-soft` | `rgba(255,217,15,.12)` | `rgba(61,83,135,.10)` |
| `--ring` | `#FFD90F` | `#3D5387` |
| `--destructive` / `--danger` | `#ff6b7a` | `#b4233c` |
| `--destructive-foreground` | `#0E0D15` | `#FFFFFF` |
| `--warning` | `#f2b04f` | `#9a5b08` |
| `--success` | `#3fd69b` | `#167653` |
| `--glass` | `rgba(24,35,70,.52)` | `rgba(255,255,255,.62)` |
| `--glass-strong` | `rgba(24,35,70,.86)` | `rgba(255,255,255,.92)` |
| `--glass-line` | `rgba(191,169,186,.16)` | `rgba(24,35,70,.09)` |
| `--glass-hi` | `rgba(255,255,255,.055)` | `rgba(255,255,255,.7)` |
| `--ambient-streak` | `61, 83, 135` | `124, 131, 173` |
| `--ambient-hot` | `217, 204, 214` | `191, 169, 186` |
| `--ambient-strength` | `0.75` | `0.55` |
| `--ambient-mark` | `0.10` | `0.07` |
| `--halftone` | `rgba(255,255,255,.05)` | `rgba(24,35,70,.06)` |

Valores iguais nos dois temas: `--font-display: 'Bricolage Grotesque Variable', system-ui, sans-serif`; `--font-sans: 'IBM Plex Sans', system-ui, 'Segoe UI', sans-serif`; `--font-mono: 'IBM Plex Mono', ui-monospace, Consolas, monospace`; `--radius: 8px`; `--radius-surface: 12px`; `--radius-console: 24px`; `--base-font-weight: 400`; `--heading-font-weight: 800`; `--glass-blur: blur(18px) saturate(135%)`.

Saem: `--sky`, `--pink` e seus `-foreground` (viram cores fixas dentro da marca), `--box-shadow-x/y`, `--reverse-box-shadow-*`, `--shadow`, `--shadow-brutal-*`, `--shadow-press`, `--spacing-press*`, `--spacing-boxShadow*`. A Tarefa 5 e a Tarefa 8 retiram os usos; até lá o build pode avisar sobre classes sem efeito, mas não quebra.

- [ ] **Passo 1: Escrever o teste que falha.** O teste lê `src/index.css`, extrai as declarações `--nome: valor` do bloco `:root` e do bloco `.dark`, e afirma:

```ts
test('os dois temas definem os mesmos tokens', () => {
  assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort());
});

for (const [nome, tema] of [['claro', light], ['escuro', dark]] as const) {
  test(`contraste AA no tema ${nome}`, () => {
    assert.ok(contrast(tema['--foreground'], tema['--background']) >= 4.5);
    assert.ok(contrast(tema['--foreground'], tema['--secondary-background']) >= 4.5);
    assert.ok(contrast(tema['--muted'], tema['--background']) >= 4.5);
    assert.ok(contrast(tema['--main-foreground'], tema['--main']) >= 4.5);
    assert.ok(contrast(tema['--destructive-foreground'], tema['--destructive']) >= 4.5);
    assert.ok(contrast(tema['--accent'], tema['--background']) >= 4.5);
    for (const estado of ['--success', '--warning', '--danger'])
      assert.ok(contrast(tema[estado], tema['--secondary-background']) >= 4.5);
  });
}

test('amarelo é a cor de ação nos dois temas', () => {
  assert.equal(light['--main'].toUpperCase(), '#FFD90F');
  assert.equal(dark['--main'].toUpperCase(), '#FFD90F');
});
```

`contrast(a, b)` é a razão de contraste da WCAG 2.1 para duas cores em hexadecimal, escrita no próprio arquivo de teste.

- [ ] **Passo 2: Rodar e ver falhar.** `npx tsx --test src/utils/theme-tokens.test.ts`
- [ ] **Passo 3: Reescrever os blocos `:root`, `.dark` e `@theme inline`** com a tabela acima. No `@layer base`, `body` usa `--background`, `--foreground`, `--font-sans` e peso 400. Se algum par da tabela não atingir 4,5:1, ajustar o valor do tema claro em direção ao mais escuro e registrar a mudança no desenho.
- [ ] **Passo 4: Rodar o teste** → passa. `npx tsc --noEmit` e `npx vite build`.
- [ ] **Passo 5: Commit.** `Replace neobrutal tokens with the GuardList-based palette`

### Task 3: Fundo vivo e vidro

**Arquivos:**
- Criar: `src/styles/glass.css`, `src/components/AmbientBackground.tsx`
- Modificar: `src/main.tsx` (importar `./styles/glass.css` depois do `index.css`), `src/index.css:102-178` (remover `.bg-comic-halftone`, `.bg-comic-stripes` e o `.dark` correspondente)
- Referência (só leitura): `GuardList/src/styles/glass.css`, `GuardList/src/components/AmbientLight.tsx`

**Interfaces:**
- Consome: `BrandMark` da Tarefa 4 para a marca translúcida. Para não depender da ordem, esta tarefa aceita a marca por propriedade.
- Produz: `export function AmbientBackground(props: { mark?: React.ReactNode }): JSX.Element`, fixo atrás de tudo, `aria-hidden`. Classes utilitárias: `.glass` (painel), `.glass-strong` (modal, menu suspenso, toast), `.glass-field` (campo e busca).

- [ ] **Passo 1: `glass.css`.** Portar do GuardList o bloco `.ambient` (seis faixas, animação `ambient-drift` de 28 a 46 s, parada com `prefers-reduced-motion`) e os valores do vidro: fundo `var(--glass)`, borda de 1 px `var(--glass-line)`, `backdrop-filter: var(--glass-blur)`, sombra `inset 0 1px 0 var(--glass-hi), 0 18px 40px -28px rgba(0,0,0,.6)`. Acrescentar a camada de pontinhos: `radial-gradient(var(--halftone) 1.4px, transparent 1.5px)` em grade de 14 px, por baixo das faixas. Incluir o `@supports not (backdrop-filter…)` com fundo `var(--secondary-background)`.
- [ ] **Passo 2: `AmbientBackground.tsx`.** Seis `<span>` de faixa, a camada de pontinhos e a marca com opacidade `var(--ambient-mark)`, centrada na área de conteúdo.
- [ ] **Passo 3: Verificar.** `npx tsc --noEmit` e `npx vite build`. A montagem na tela acontece nas Tarefas 6 e 7.
- [ ] **Passo 4: Commit.** `Add the ambient background and glass surfaces`

### Task 4: Marca da rosquinha com fechadura

**Arquivos:**
- Criar: `src/components/BrandMark.tsx`, `public/favicon.svg`
- Modificar: `src/components/CartoonIllustrations.tsx` (remover `DonutVaultLogo`, `BarnabyMascot` e o tipo `MascotMood` se nada mais o usar; manter `CartoonVaultDoor`), `index.html` (`<link rel="icon" href="/favicon.svg" type="image/svg+xml">`), e os usos em `src/App.tsx:56,1194,1230`, `src/components/WelcomeScreen.tsx:16-18,266,415`, `src/components/DashboardView.tsx:19,101`, `src/components/GeneratorView.tsx:17,433`, `src/components/SecurityAuditView.tsx:14,106`

**Interfaces:**
- Produz: `export function BrandMark(props: { size?: number; spinning?: boolean; className?: string }): JSX.Element`, com `role="img"` e `aria-label="DonutVault"`. `size` padrão 56. `spinning` gira a marca inteira com a classe `animate-spin-donut` já existente.

- [ ] **Passo 1: `BrandMark.tsx`.** O desenho é o `<symbol id="logo">` do esboço aprovado (`viewBox="0 0 200 200"`): anel preto, massa `#E3A857`, anel preto, cobertura `#FF5CA8`, oito confeitos e a fechadura `#0F1220`. Se o dono entregar o vetor original, ele substitui este.
- [ ] **Passo 2: `public/favicon.svg`** com o mesmo desenho.
- [ ] **Passo 3: Trocar os usos.** `DonutVaultLogo` vira `BrandMark` com o mesmo `size` e `spinning`. Cada `BarnabyMascot` vira `BrandMark` com o mesmo `size`; a propriedade `mood` some. Onde o humor escolhia uma cor de fundo ou um texto, o texto fica e a cor passa a ser a de estado (`text-success`, `text-warning`, `text-danger`).
- [ ] **Passo 4: Verificar.** `npx tsc --noEmit` sem erro; `grep -rn "BarnabyMascot\|DonutVaultLogo" src` não retorna nada; `npx vite build`.
- [ ] **Passo 5: Commit.** `Use the donut-and-keyhole mark and retire the mascot`

### Task 5: Componentes-base

**Arquivos:**
- Modificar: `src/components/ui/button-variants.ts`, `src/components/ui/card.tsx`, `src/components/ui/input.tsx`, `src/components/ui/table.tsx`, `src/components/ui/comic.tsx`

**Interfaces:**
- Produz: os mesmos nomes exportados e as mesmas propriedades de hoje. As variantes de botão continuam `default`, `outline`, `neutral`, `destructive`, `ghost`, `noShadow`, e os tamanhos não mudam. As variantes `sky`, `pink` e `emerald` continuam aceitas, para não quebrar chamadas, e passam a ter o estilo de `neutral`.

- [ ] **Passo 1: Botão.** Base: `rounded-base`, peso 700, sem borda grossa, sem sombra deslocada, sem deslocamento ao passar o mouse; foco com `ring-2 ring-ring` e `ring-offset-2`. `default`: fundo `--main`, texto `--main-foreground`, hover `--main-hover`. `outline` e `neutral`: transparente, borda de 1 px `--line-strong`, texto `--text-soft`, hover `--accent-soft`. `destructive`: fundo `--destructive`, texto `--destructive-foreground`. `ghost`: sem borda, hover `--accent-soft`.
- [ ] **Passo 2: Cartão.** `Card` vira `glass rounded-surface`, sem `border-3` e sem `shadow-shadow`. `CardTitle` fica em `font-display` peso 800. `CardDescription` usa `text-muted` nos dois temas.
- [ ] **Passo 3: Campo.** `glass-field`: fundo `--surface-subtle`, borda de 1 px `--line`, `rounded-base`, peso 500, placeholder `text-muted`, foco com contorno de 2 px `--ring` e deslocamento de 2 px.
- [ ] **Passo 4: Tabela.** Cabeçalho com texto `text-muted` de 12,5 px e peso 600 sobre `color-mix(in srgb, var(--background) 35%, transparent)`; linhas separadas por 1 px `--glass-line`; células com `padding` de 12 px por 16 px; a tabela dentro de um contêiner `glass rounded-surface overflow-x-auto`.
- [ ] **Passo 5: Avisos (`comic.tsx`).** `ComicSpeechBubble`, `ComicActionCallout` e `ComicToastOverlay` mantêm nome e propriedades e viram painéis `glass-strong rounded-surface`, sem balão de gibi, sem rotação e sem borda preta. O tipo do aviso aparece em uma faixa lateral de 3 px na cor de estado e no ícone; o texto usa `--foreground`.
- [ ] **Passo 6: Verificar.** `npx tsc --noEmit`, `npx vite build`. `grep -n "border-3\|shadow-shadow\|shadow-press\|translate-x-press" src/components/ui` não retorna nada.
- [ ] **Passo 7: Commit.** `Restyle the base components as glass surfaces`

### Task 6: Casca do app

**Arquivos:**
- Modificar: `src/App.tsx:170,1185-1410` (estado inicial do tema, tela de carregamento, menu lateral, topo, menu inferior do celular), `src/App.tsx:701` (tema de um cofre novo)

**Interfaces:**
- Consome: `AmbientBackground`, `BrandMark`, classes `.glass`.

- [ ] **Passo 1: Tema padrão escuro.** `useState<'light' | 'dark'>('dark')` e `theme: 'dark'` no cofre novo. Cofre existente continua com o tema que tem salvo; não migrar.
- [ ] **Passo 2: Fundo.** Montar `<AmbientBackground mark={<BrandMark size={640} />} />` uma vez, fora da área rolável.
- [ ] **Passo 3: Menu lateral.** Painel `glass rounded-console`, 280 px de largura, flutuando com 24 px de margem. No topo, `BrandMark` de 40 px, "DonutVault" em `font-display` e o nome do cofre em `text-muted`. Itens com 44 px de altura, texto `text-muted`; o ativo com fundo `--accent-soft`, texto `--accent` e faixa de 3 px `--main` à esquerda. No rodapé, o cartão de perfil com `BrandMark` de 40 px como foto e o estado da sincronização.
- [ ] **Passo 4: Topo.** Busca em `glass-field` com raio de 12 px; ações (trancar, tema, atalhos) como botões `outline`.
- [ ] **Passo 5: Celular.** Abaixo de 1024 px o menu lateral some e o menu inferior atual continua, em `glass-strong`, com o item ativo na cor `--accent`.
- [ ] **Passo 6: Tela de carregamento.** Fundo `--background`, `BrandMark` de 84 px girando.
- [ ] **Passo 7: Verificar no navegador.** `docker compose up -d`, `npm run dev`, abrir `http://localhost:3000`, criar um cofre de teste local e conferir menu, topo e alternância de tema em 1280 px e em 360 px. `npx tsc --noEmit`, `npx vite build`.
- [ ] **Passo 8: Commit.** `Rebuild the app shell on the glass sidebar layout`

### Task 7: Desbloqueio e boas-vindas

**Arquivos:**
- Modificar: `src/components/WelcomeScreen.tsx`

**Interfaces:**
- Consome: `AmbientBackground`, `BrandMark`, `Card`, `Input`, `Button`, `CartoonVaultDoor`.

- [ ] **Passo 1: Estrutura.** Duas colunas (`1.05fr 0.95fr`), altura mínima da tela. À esquerda o palco: `BrandMark` de 210 px sobre um brilho radial `rgba(255,217,15,.16)`, "Donut**Vault**" em `font-display` de 34 px com "Vault" em `--main`, a frase curta em `text-muted` e o selo de estado em pílula. À direita, um painel `glass rounded-console` com 36 px de margem interna, que recebe os formulários atuais (criar cofre, abrir cofre, restaurar backup, trocar de cofre) sem mudança de campos, textos ou validação.
- [ ] **Passo 2: Botão principal** com 50 px de altura e raio de 10 px. Ações secundárias como links sublinhados em `--text-soft`.
- [ ] **Passo 3: Tela estreita.** Abaixo de 900 px, uma coluna: palco com `BrandMark` de 120 px acima do painel.
- [ ] **Passo 4: Porta do cofre.** `CartoonVaultDoor` continua onde está hoje, na animação de abertura.
- [ ] **Passo 5: Verificar no navegador,** em 1280 px e 360 px, nos fluxos de criar cofre, trancar e abrir de novo, e restaurar backup até a tela de escolha do arquivo. `npx tsc --noEmit`, `npx vite build`.
- [ ] **Passo 6: Commit.** `Give the unlock screen a brand stage and a glass panel`

### Task 8: Telas internas

**Arquivos:**
- Modificar: `src/components/DashboardView.tsx`, `src/components/PasswordsView.tsx`, `src/components/GeneratorView.tsx`, `src/components/SecurityAuditView.tsx`, `src/components/SecretNotesView.tsx`, `src/components/SettingsView.tsx`, `src/components/SyncDashboardPanel.tsx`

**Regras para todas:**
- Retirar `border-2`, `border-3`, `border-4`, `shadow-shadow`, `shadow-brutal-*`, `shadow-press`, `font-black`, `bg-comic-halftone`, `bg-comic-stripes`, `bg-sky`, `bg-pink`, `bg-main` em superfícies que não são botão, e cores fixas como `text-stone-*`, `bg-[#…]`, `dark:bg-slate-*`.
- Título de tela: `font-display`, 27 px, peso 800. Subtítulo em `text-muted`.
- Dados (senha, usuário, e-mail, URL, data, contador, código) em `font-mono` com numerais tabulares.
- Estado sempre pelas três cores: `text-success`, `text-warning`, `text-danger`, em etiqueta de pílula com borda de 1 px na mesma cor.
- Ação perigosa: botão `destructive`, sem `BrandMark` ao lado.

- [ ] **Passo 1: Senhas** (inclui Favoritos, Categorias e Lixeira). Três números no topo em cartões `glass` (fortes, repetidas, fracas) em `font-mono` de 26 px; tabela densa; nome de serviço, usuário e URL com `truncate` e `title` com o valor inteiro; formulário de edição em modal `glass-strong`. Conferir com o esboço.
- [ ] **Passo 2: Início.** Números em cartões `glass`; atalhos como botões; a `BrandMark` no resumo.
- [ ] **Passo 3: Gerador.** Senha gerada em `font-mono` de 22 px ou mais, com quebra em qualquer caractere; controles no padrão novo.
- [ ] **Passo 4: Saúde das senhas.** Lista por gravidade com as cores de estado.
- [ ] **Passo 5: Notas seguras.** Cartões `glass`; editor em modal.
- [ ] **Passo 6: Configurações e sincronização.** Seções em painéis `glass`.
- [ ] **Passo 7: Verificar.** Este comando não retorna nada:

```bash
grep -rnE "shadow-(shadow|brutal|press)|border-[234]\b|font-black|bg-comic|bg-(sky|pink)\b" src/components src/App.tsx
```

`npx tsc --noEmit`, `npx vite build`. No navegador, com um item de nome de serviço de 80 caracteres e usuário de 120: a linha trunca e a página não ganha rolagem lateral em 360 px.
- [ ] **Passo 8: Commits.** Um por tela, no formato `Restyle the <screen> screen`.

### Task 9: Conferência final e documentação

**Arquivos:**
- Modificar: `README.md:3` ("com cara de desenho animado dos anos 90" → "com a cara do GuardList e um toque dos anos 90"), `AGENTS.md` (na regra de textos, "O visual é de desenho animado, mas" → "O visual segue o do GuardList, com toques dos anos 90, e"), `docs/superpowers/specs/2026-11-13-visual-guardlist-design.md` (estado → "construído", com qualquer valor ajustado na Tarefa 2)

- [ ] **Passo 1: Validação completa do `AGENTS.md`,** no banco de teste: `docker compose up -d`, exportar as variáveis `SQL_*` de teste, `npm run db:migrate`, `npx tsc --noEmit`, `npm test`, `npx vite build`. Tudo passa.
- [ ] **Passo 2: Tamanho.** Na saída do build, o pacote principal fica abaixo de 500 kB.
- [ ] **Passo 3: CSP em produção.** `NODE_ENV=production npm start` contra o banco local de desenvolvimento; abrir a página e conferir o console sem nenhuma violação de CSP e a aba de rede sem pedido a outro domínio.
- [ ] **Passo 4: Tela a tela,** nos dois temas, em 1280 px e 360 px: desbloqueio e as nove áreas do menu. Conferir os cinco pontos de atenção do início deste plano.
- [ ] **Passo 5: Sem vidro.** Com `backdrop-filter` desligado nas ferramentas do navegador, os painéis ficam sólidos e legíveis.
- [ ] **Passo 6: Movimento reduzido.** Com a opção ligada, as faixas e a marca ficam paradas.
- [ ] **Passo 7: Fluxos.** Criar cofre, abrir, adicionar e editar senha, gerar senha, sincronizar e trancar funcionam como antes.
- [ ] **Passo 8: Commit.** `Update the docs for the GuardList-based look`
