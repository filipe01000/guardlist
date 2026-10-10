// Gera uma entrada para APP_USERS: npm run user:add -- <usuario>
import { createInterface } from 'node:readline';
import { hashPassword } from '../auth.ts';

const username = (process.argv[2] || '').trim().toLowerCase();
if (!/^[a-z0-9._-]{2,64}$/.test(username)) {
  console.error('Uso: npm run user:add -- <usuario>  (letras minúsculas, números, ponto, hífen ou sublinhado)');
  process.exit(1);
}

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { _writeToOutput: (text: string) => void; output: NodeJS.WriteStream };
    let muted = false;
    output._writeToOutput = (text: string) => {
      if (!muted || text.includes('\n')) output.output.write(muted ? '\n' : text);
    };
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

const password = await askHidden(`Senha para ${username}: `);
const confirmation = await askHidden('Confirme a senha: ');
if (password !== confirmation) {
  console.error('As senhas não conferem.');
  process.exit(1);
}
if (password.length < 10) {
  console.error('Use uma senha com pelo menos 10 caracteres.');
  process.exit(1);
}

console.log('\nAdicione esta entrada em APP_USERS (separe vários usuários por vírgula):\n');
console.log(`${username}:${hashPassword(password)}`);
