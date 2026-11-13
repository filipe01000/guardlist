# Entrada nova no cofre: decisões já tomadas

Data: 13/11/2026. Estado: decisões registradas; o desenho completo ainda não foi escrito.
Este é o projeto seguinte ao [visual novo](2026-11-13-visual-guardlist-design.md).

## O que o dono decidiu

- O DonutVault é uma ferramenta fechada. Hoje só o dono usa; depois, talvez colegas de trabalho
  convidados por ele. Não há cadastro aberto ao público.
- A entrada no cofre exige uma segunda autenticação forte, e ela é a **passkey**.
- Não há usuário e senha de conta. A passkey diz quem é a pessoa e prova que é ela; depois, a
  **Senha Mestra** abre o cofre no navegador. São dois passos.
- Há **códigos de recuperação** para o caso de perda do aparelho.
- O DonutVault não depende do GuardList para entrar. O "Entrar com GuardList" (conta única entre os
  dois) foi considerado e deixado para depois, se os colegas entrarem; a escolha atual não o impede.

## O que não muda

- O servidor continua sem conhecer a Senha Mestra nem as chaves. Nenhum login abre o cofre sozinho.
- Todas as regras de "Não quebrar" do `AGENTS.md`.

## Em aberto, para o desenho completo

- Como o convite funciona: quem convida, por onde o convite chega, por quanto tempo vale.
- O que acontece com a conta e os aparelhos que já existem hoje.
- Se a passkey também participa da chave do cofre (extensão PRF do WebAuthn), de modo que uma cópia
  roubada do cofre não abra sem ela, e o que fazer em navegadores sem suporte.
- De quanto em quanto tempo a passkey é pedida de novo em um aparelho já conhecido.
- Como os códigos de recuperação são gerados, guardados e usados sem enfraquecer o cofre.
- WebAuthn exige domínio definido (`WEBAUTHN_RP_ID`); trocar de domínio depois invalida as passkeys.
