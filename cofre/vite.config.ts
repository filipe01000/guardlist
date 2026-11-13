import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      // O único arquivo acima de 500 kB é o do medidor de força (zxcvbn), que é quase todo
      // dicionário e carrega em segundo plano (src/utils/strengthEngine.ts). O pacote principal
      // fica abaixo de 500 kB.
      chunkSizeWarningLimit: 900,
    },
    server: {
      // DISABLE_HMR=true desliga o recarregamento automático e a observação de arquivos, o que
      // poupa CPU quando muitos arquivos mudam de uma vez.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
