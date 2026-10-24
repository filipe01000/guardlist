# Verificação em duas etapas (MFA) — design

Data: 24/10/2026
Estado: aguardando revisão deste documento antes do plano de implementação.

## 1. Objetivo

Depois da senha, pedir um código de 6 dígitos de um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy etc.). O administrador liga ou desliga a exigência na tela de Administração.

### Decidido

- **Liga e desliga em Administração.** Com o MFA ligado, **todos os usuários** precisam do código para entrar. Quem ainda não cadastrou é levado ao cadastro no próximo login, como já acontece com a troca obrigatória de senha. Com o MFA desligado, o login volta a ser só usuário e senha (os cadastros feitos ficam guardados para quando religar).
- **Código de aplicativo (TOTP)**, padrão RFC 6238: 6 dígitos, 30 segundos, SHA-1, tolerância de um período para cada lado. Um mesmo código não vale duas vezes.
- **10 códigos de recuperação** por usuário, de uso único, para quem perder o celular.
- **Tela do código** como no protótipo aprovado: os dígitos orbitam até o cadeado; código certo tranca o cadeado e sela o perímetro; código errado faz o cadeado tremer e os anéis piscarem em vermelho.

### Fora desta etapa

- Chave de acesso (passkey, Windows Hello, chave física).
- Código por e-mail ou SMS.
- Exigir MFA só para alguns perfis (por exemplo, só administradores).

## 2. Dados

`users` ganha:

| Coluna | Tipo | Observação |
|---|---|---|
| `mfa_secret` | TEXT | chave do autenticador, criptografada (AES-256-GCM, formato `v1:iv:tag:dados`); nula se não cadastrado |
| `mfa_enabled_at` | TIMESTAMPTZ | quando o cadastro foi confirmado; nula = sem MFA |
| `mfa_last_step` | BIGINT | último período de 30 s aceito, para recusar o mesmo código de novo |
| `mfa_recovery` | JSONB | hashes SHA-256 dos códigos de recuperação ainda não usados |

Configuração do app (`settings.app_settings`) ganha `mfaRequired: boolean` (padrão `false`).

Chave: `MFA_SECRET_KEY` (32 bytes em base64) nas variáveis de ambiente. Sem ela, o botão de ligar o MFA fica desabilitado em Administração, com a explicação. O código de criptografia é o mesmo módulo já usado na sincronização, parametrizado pelo nome da variável.

## 3. Fluxo de login

1. `POST /api/auth/login` com usuário e senha, como hoje (mesmo limite e mesmo bloqueio por tentativas).
2. Senha certa e MFA desligado: abre a sessão, como hoje.
3. Senha certa e MFA ligado: **não abre a sessão**. Responde `{ step: 'mfa' }` (usuário com cadastro) ou `{ step: 'mfa-setup' }` (usuário sem cadastro) e grava um cookie de etapa pendente (`gl_mfa`, HttpOnly, assinado, válido por 5 minutos, ligado ao usuário e à versão de sessão dele).
4. `POST /api/auth/mfa` com `{ code }` ou `{ recoveryCode }`: confere o código; certo abre a sessão e apaga o cookie de etapa; errado conta no mesmo bloqueio de tentativas da senha (5 erros bloqueiam a conta pelo tempo atual).
5. Cadastro durante o login:
   - `GET /api/auth/mfa/setup` gera uma chave nova, guarda criptografada como pendente e devolve o QR code (SVG) e a chave em texto para digitar no aplicativo.
   - `POST /api/auth/mfa/enable` com `{ code }` confirma, liga o MFA do usuário, gera os 10 códigos de recuperação (mostrados **uma única vez**) e abre a sessão.
6. Troca obrigatória de senha continua existindo; ela acontece depois do MFA.

Todas as respostas de erro são genéricas ("Código incorreto."), sem dizer se o usuário tem cadastro.

## 4. Minha conta

- **Cadastrar ou recadastrar** o autenticador (mesmo fluxo de QR code e confirmação).
- **Gerar novos códigos de recuperação** (invalida os anteriores), pedindo um código do aplicativo.
- **Desligar o próprio MFA** só quando a exigência estiver desligada, pedindo um código do aplicativo.

## 5. Administração

- **Interruptor "Exigir verificação em duas etapas"**, com a contagem de usuários já cadastrados ("3 de 5 já cadastraram"). Ligar mostra um aviso: quem não tem cadastro vai cadastrar no próximo login. O administrador que liga precisa ter o próprio cadastro feito antes, para não se trancar fora.
- **Zerar o MFA de um usuário** (perdeu o celular e os códigos): ele cadastra de novo no próximo login. As sessões abertas dele são encerradas.
- Tudo vai para o registro de auditoria: `mfa.required.on`, `mfa.required.off`, `mfa.enable`, `mfa.disable`, `mfa.reset`, `mfa.recovery.regenerate`, `mfa.recovery.used`, `mfa.failed`.

## 6. Tela

- O passo do código aparece no mesmo painel de vidro do login, no lugar do formulário de senha; o perímetro e a borda de luz continuam.
- Seis caixas com colar, apagar, setas, `inputmode="numeric"` e `autocomplete="one-time-code"`, envio automático ao completar e barra dos 30 segundos.
- Animação aprovada no protótipo: dígitos em espiral até o cadeado; certo → cadeado fecha, anéis selam, "Perímetro selado", app abre; errado → dígitos voltam, cadeado treme, anéis em vermelho, mensagem e foco no primeiro dígito.
- Link "Usar um código de recuperação" troca as seis caixas por um campo de texto. Link "Voltar" volta para usuário e senha.
- Cadastro: QR code, a chave em grupos de 4 caracteres com botão de copiar, e as seis caixas para confirmar. Depois, a tela dos 10 códigos de recuperação com "Copiar" e "Baixar .txt" e a caixa "Guardei os códigos" antes de continuar.
- Com `prefers-reduced-motion`, sem espiral: o cadeado só troca de estado.

## 7. Dependência nova

`qrcode` (MIT, sem dependências nativas) no servidor, para gerar o QR code em SVG. O cálculo do TOTP usa só `node:crypto`.

## 8. Testes

- TOTP: vetores oficiais da RFC 6238 (SHA-1), tolerância de ±1 período, recusa de código repetido.
- Códigos de recuperação: uso único, hash guardado, regenerar invalida os antigos.
- Login: MFA desligado igual a hoje; ligado com cadastro pede código; sem cadastro pede cadastro; cookie de etapa expira e não vale para outro usuário; erros contam no bloqueio.
- Administração: só administrador liga e desliga; não liga sem `MFA_SECRET_KEY` nem sem o próprio cadastro; zerar encerra as sessões do usuário.
- Os testes atuais continuam passando.
