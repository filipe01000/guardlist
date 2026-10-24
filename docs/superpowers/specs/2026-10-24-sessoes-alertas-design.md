# Aviso de acesso novo e sessão por inatividade

**Data:** 2026-10-24 · **Branch:** `sessoes-alertas`

## Objetivo

1. Avisar o dono da conta, dentro do app, quando alguém entra de um navegador ou de uma rede diferente do habitual.
2. Encerrar sessões paradas há 1 hora, além do limite de 12 horas que já existe.

Decidido com o usuário: aviso só dentro do app (sem e-mail por enquanto); dispara com navegador novo **ou** rede nova;
inatividade de 1 hora. Fica de fora "pedir MFA de novo a cada N dias": a sessão já expira em 12 horas e, com o MFA
exigido, todo login pede o código.

## Aviso de acesso novo

- **Quando:** ao abrir uma sessão (depois da senha e, se exigido, do código), compara com as sessões da mesma conta
  nos últimos 90 dias:
  - *dispositivo* = navegador + sistema (ex.: "Chrome · Windows"), pela mesma regra de `describeAgent`;
  - *rede* = IPv4 no mesmo /24 ou IPv6 no mesmo /48.
  Se o dispositivo **ou** a rede não aparecem no histórico, grava um aviso. A primeira sessão da conta não gera aviso.
- **Histórico:** as sessões passam a ser guardadas por 90 dias depois de expirar ou ser encerrada (hoje são 30).
- **Dados:** tabela `login_alerts` (`id`, `user_id`, `session_id`, `created_at`, `ip`, `user_agent`, `new_device`,
  `new_network`, `dismissed_at`). Auditoria `login.new_access`.
- **Onde aparece:** faixa no topo do app em qualquer outra sessão da pessoa (não na própria sessão que gerou o aviso),
  por 30 dias ou até ser dispensada:
  "Novo acesso à sua conta: Chrome · Windows, IP 200.10.5.7, 24/10 14:32." Botões **Fui eu** (dispensa) e
  **Não fui eu** (encerra todas as outras sessões, dispensa o aviso e abre Minha conta para trocar a senha).
- **API:** `GET /api/alerts`, `POST /api/alerts/:id/dismiss`, `POST /api/sessions/revoke-others`.

## Sessão por inatividade

- **Regra no servidor:** a sessão vale se `last_seen_at` for mais recente que `SESSION_IDLE_MINUTES` (padrão 60).
  `last_seen_at` deixa de ser atualizado por qualquer requisição (a atualização automática do app a cada minuto
  manteria a sessão viva para sempre) e passa a ser atualizado só por `POST /api/activity`.
- **No navegador:** mouse, teclado, toque e rolagem marcam atividade; com atividade, envia `POST /api/activity` no
  máximo a cada 60 s. A última atividade é compartilhada entre abas (`localStorage`), para uma aba esquecida não
  derrubar a sessão de outra em uso.
- **Aviso:** 60 s antes do limite, janela "Sua sessão vai encerrar por inatividade" com contagem regressiva e
  **Continuar conectado**. No limite, sai e a tela de login mostra "Sessão encerrada por inatividade."
- `/api/auth/me` informa `idleTimeoutMs` ao navegador.

## Testes

- Funções puras: dispositivo e rede (IPv4, IPv6, IPv4 mapeado em IPv6, vazio).
- Serviço (PGlite): primeira sessão sem aviso; mesmo dispositivo e rede sem aviso; navegador novo e rede nova geram
  aviso; aviso não aparece na sessão que o gerou; dispensar; encerrar as outras sessões mantém a atual;
  sessão parada além do limite deixa de valer; `touch` renova.
- Demonstração: faixa do aviso e janela de inatividade (com limite curto via variável), com capturas.
