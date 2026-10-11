import { gzipSync } from 'node:zlib';
import type { Database } from './db.ts';
import type { Store, Actor } from './store.ts';
import { recipients, sendMail, smtpConfigured } from './mailer.ts';
import { reportCsv, reportFileSlug, reportHtml, reportPeriod } from '../src/utils/reportDocs.ts';

// Rotinas automáticas, conferidas a cada 10 minutos (horário de Brasília):
// - backup diário a partir das BACKUP_HOUR (padrão 3h), enviado por e-mail compactado;
// - relatório geral do mês anterior no dia 1º, a partir das REPORT_HOUR (padrão 8h).
// Cada execução fica registrada em job_runs, que a página de status mostra.

const SYSTEM: Actor = { username: 'sistema', displayName: 'GuardList (automático)', role: 'admin' };
const TIME_ZONE = 'America/Sao_Paulo';

export type JobName = 'backup' | 'monthly_report';

export interface JobRun {
  job: JobName;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  detail: Record<string, unknown> | null;
}

// Data e hora atuais em Brasília.
function nowBR() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) };
}

export function createJobs(db: Database, store: Store, publicOrigin: () => string) {
  async function record(job: JobName, ok: boolean, detail: Record<string, unknown>, error?: string) {
    await db.query(
      `INSERT INTO job_runs (job, last_run_at, last_ok_at, last_error, detail) VALUES ($1, now(), CASE WHEN $2 THEN now() END, $3, $4::jsonb)
       ON CONFLICT (job) DO UPDATE SET last_run_at = now(), last_ok_at = CASE WHEN $2 THEN now() ELSE job_runs.last_ok_at END,
         last_error = $3, detail = $4::jsonb`,
      [job, ok, ok ? null : (error || 'Erro desconhecido').slice(0, 500), JSON.stringify(detail)]
    );
    await db.query('INSERT INTO audit_log (username, action, detail) VALUES ($1, $2, $3::jsonb)', [
      SYSTEM.username,
      ok ? `job.${job}` : `job.${job}.failed`,
      JSON.stringify({ ...detail, error: ok ? undefined : error })
    ]);
  }

  async function runs(): Promise<JobRun[]> {
    const rows = await db.query<{ job: JobName; last_run_at: string | null; last_ok_at: string | null; last_error: string | null; detail: Record<string, unknown> | null }>(
      'SELECT * FROM job_runs'
    );
    const byJob = new Map(rows.map((r) => [r.job, r]));
    return (['backup', 'monthly_report'] as JobName[]).map((job) => {
      const r = byJob.get(job);
      return {
        job,
        lastRunAt: r?.last_run_at ? new Date(r.last_run_at).toISOString() : null,
        lastOkAt: r?.last_ok_at ? new Date(r.last_ok_at).toISOString() : null,
        lastError: r?.last_error ?? null,
        detail: r?.detail ?? null
      };
    });
  }

  async function runBackup(actor: Actor = SYSTEM) {
    const to = recipients('BACKUP_EMAILS');
    const today = nowBR().date;
    try {
      const json = await store.exportFullBackupJSON(actor);
      const gz = gzipSync(Buffer.from(json, 'utf8'));
      const data = JSON.parse(json) as { clients: unknown[]; entries: unknown[] };
      const detail = { date: today, clients: data.clients.length, entries: data.entries.length, bytes: gz.length, to };
      await sendMail(
        to,
        `GuardList · backup de ${today.split('-').reverse().join('/')}`,
        `<p>Backup automático do GuardList.</p><p>${data.clients.length} clientes e ${data.entries.length} indicadores.
         Para restaurar, descompacte o arquivo (.json.gz) e use <strong>Backup e ajustes → Restaurar</strong> com uma conta de administrador.</p>`,
        [{ filename: `guardlist-backup-${today}.json.gz`, content: gz, contentType: 'application/gzip' }]
      );
      await record('backup', true, detail);
      return detail;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await record('backup', false, { date: today, to }, message);
      throw error;
    }
  }

  // Relatório geral de um mês (padrão: o mês anterior).
  async function runMonthlyReport(actor: Actor = SYSTEM, year?: number, month?: number) {
    const now = nowBR();
    const ref = year && month ? { year, month } : now.month === 1 ? { year: now.year - 1, month: 12 } : { year: now.year, month: now.month - 1 };
    const pad = (n: number) => String(n).padStart(2, '0');
    const lastDay = new Date(Date.UTC(ref.year, ref.month, 0)).getUTCDate();
    const from = `${ref.year}-${pad(ref.month)}-01`;
    const to = `${ref.year}-${pad(ref.month)}-${pad(lastDay)}`;
    const recipientsList = recipients('REPORT_EMAILS');
    const key = `${ref.year}-${pad(ref.month)}`;
    try {
      // Brasília é UTC-3 (sem horário de verão desde 2019).
      const report = await store.getReport(actor, { from, to, startIso: `${from}T03:00:00.000Z`, endIso: new Date(Date.UTC(ref.year, ref.month - 1, lastDay, 26, 59, 59, 999)).toISOString() });
      const origin = publicOrigin();
      const html = reportHtml(report, { logoUrl: `${origin}/brand/guardlist-mark.png` });
      await sendMail(
        recipientsList,
        `GuardList · relatório de ${reportPeriod(report)}`,
        html,
        [{ filename: `${reportFileSlug(report)}.csv`, content: reportCsv(report), contentType: 'text/csv; charset=utf-8' }]
      );
      const detail = { month: key, to: recipientsList, imports: report.totals.imports, added: report.totals.added };
      await record('monthly_report', true, detail);
      return detail;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await record('monthly_report', false, { month: key, to: recipientsList }, message);
      throw error;
    }
  }

  // Avisa por e-mail quando uma rotina falha (se o próprio e-mail funcionar).
  async function alertFailure(job: JobName, error: unknown) {
    const to = [...new Set([...recipients('BACKUP_EMAILS'), ...recipients('REPORT_EMAILS')])];
    const message = error instanceof Error ? error.message : String(error);
    await sendMail(to, `GuardList · falha na rotina ${job === 'backup' ? 'de backup' : 'do relatório mensal'}`,
      `<p>A rotina automática falhou:</p><pre>${message.replace(/[<>&]/g, '')}</pre><p>Veja Administração → Status do sistema.</p>`).catch(() => undefined);
  }

  async function tick() {
    if (!smtpConfigured()) return;
    const now = nowBR();
    const all = await runs();
    const backup = all.find((r) => r.job === 'backup');
    const monthly = all.find((r) => r.job === 'monthly_report');
    const backupHour = Number(process.env.BACKUP_HOUR ?? 3);
    const reportHour = Number(process.env.REPORT_HOUR ?? 8);

    const backupDoneToday = (backup?.detail as { date?: string } | null)?.date === now.date;
    if (recipients('BACKUP_EMAILS').length && now.hour >= backupHour && !backupDoneToday) {
      await runBackup().catch((error) => alertFailure('backup', error));
    }

    const prev = now.month === 1 ? `${now.year - 1}-12` : `${now.year}-${String(now.month - 1).padStart(2, '0')}`;
    const monthlyDone = (monthly?.detail as { month?: string } | null)?.month === prev;
    if (recipients('REPORT_EMAILS').length && now.hour >= reportHour && !monthlyDone) {
      await runMonthlyReport().catch((error) => alertFailure('monthly_report', error));
    }
  }

  function start() {
    let running = false;
    const safeTick = async () => {
      if (running) return;
      running = true;
      try {
        await tick();
      } catch (error) {
        console.error('Rotinas automáticas:', error);
      } finally {
        running = false;
      }
    };
    setTimeout(safeTick, 60_000).unref();
    setInterval(safeTick, 10 * 60_000).unref();
  }

  return { runs, runBackup, runMonthlyReport, start };
}

export type Jobs = ReturnType<typeof createJobs>;
