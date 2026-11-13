import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import { createSyncApiRouter } from './src/server/syncRoutes.ts';
import {
  extractClientIp,
  sanitizedApiErrorMiddleware,
  securityHeadersAndAntiFingerprintMiddleware,
} from './src/middleware/reconDefense.ts';
import { scannerDetector } from './src/services/ScannerDetectionService.ts';
import { recordAuthAuditEvent } from './src/db/repository.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * embedded: montado dentro do GuardList em /cofre. Serve sempre o build pronto (cofre/dist, gerado com
 * `npm run build:embedded`) e não abre um servidor Vite próprio.
 */
export async function createDonutVaultApp(options?: { skipVite?: boolean; embedded?: boolean }) {
  const app = express();
  app.disable('x-powered-by');

  // 1. Cabeçalhos de endurecimento HTTP e remoção de fingerprinting em toda a aplicação
  app.use(securityHeadersAndAntiFingerprintMiddleware);

  // Querying Neon here would prevent the free database from scaling to zero.
  app.get('/healthz', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ status: 'ok' });
  });

  // 2. Bloqueio de varreduras automatizadas e arquivos sensíveis na raiz (/.env, /.git, /wp-admin, /admin, /phpmyadmin, /actuator)
  app.use((req, res, next) => {
    const trap = scannerDetector.isSensitiveOrAdminTrapPath(
      req.originalUrl || req.url
    );
    if (trap.trapped) {
      const clientIp = extractClientIp(req);
      const { shouldThrottle429 } =
        scannerDetector.recordAdminOrSensitivePathProbe({
          clientIp,
          method: req.method,
          path: req.originalUrl || req.url,
          matchedPattern: trap.matchedPattern || 'root-trap',
        });
      void recordAuthAuditEvent({
        userUid: 'anonymous',
        deviceId: 'root-recon-trap',
        eventType: 'ADMIN_OR_SENSITIVE_ENDPOINT_PROBE',
        clientIp,
        metadata: {
          path: (req.originalUrl || req.url).slice(0, 80),
          method: req.method,
        },
      });
      if (shouldThrottle429) {
        res.setHeader('Retry-After', '60');
        res.status(429).json({
          error: 'Muitas tentativas de acesso a recursos inexistentes (429).',
        });
        return;
      }
      res.status(404).json({ error: 'Recurso não encontrado (404).' });
      return;
    }
    next();
  });

  // 3. Limite rigoroso de payload JSON (512 KB) + Tratador de JSON malformado/oversized sem stack trace
  app.use(express.json({ limit: '512kb' }));
  app.use(sanitizedApiErrorMiddleware);

  // 4. Monta API REST Versionada Zero-Knowledge (/api/v1/*)
  app.use('/api/v1', createSyncApiRouter());

  if (options?.embedded) {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath, { index: false }));
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else if (!options?.skipVite) {
    if (process.env.NODE_ENV !== 'production') {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(__dirname, 'dist');
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  return app;
}

// Inicia o servidor HTTP na porta 3000 quando executado diretamente
const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectRun) {
  const PORT = Number(process.env.PORT || 3000);
  createDonutVaultApp()
    .then((app) => {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(
          `[DonutVault Zero-Knowledge Server] Listening on http://0.0.0.0:${PORT}`
        );
      });
    })
    .catch((err) => {
      console.error('Failed to start DonutVault server:', err);
      process.exit(1);
    });
}
