import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeImportBatch } from './importer.ts';
import { buildImportReport, reportSections } from './importReport.ts';

test('relatório da importação: cada item na seção certa, sem contar repetido duas vezes', () => {
  const raw = ['45.95.147.10', '45.95.147.10', '91.92.240.0/24', '91.92.240.77', '185.220.101.77', '194.26.29.112', '10.0.0.5', 'lixo', '45.95.147.11'].join('\n');
  const existing = new Set(['194.26.29.112', '185.220.100.0/22']);
  const preview = analyzeImportBatch(raw, existing, [], 'append', []);
  const saved = new Set(preview.items.filter((i) => i.category === 'new').map((i) => i.indicator));
  const r = buildImportReport(preview, { mode: 'append', saved, legitSkipped: [] });

  assert.deepEqual(r.saved.sort(), ['45.95.147.10', '45.95.147.11', '91.92.240.0/24']);
  assert.deepEqual(r.duplicates, ['45.95.147.10']);
  assert.deepEqual(r.alreadyExists, ['194.26.29.112']);
  assert.deepEqual(r.coveredByCidr.map((c) => `${c.indicator}>${c.by}`).sort(), ['185.220.101.77>185.220.100.0/22', '91.92.240.77>91.92.240.0/24']);
  assert.equal(r.reserved[0].indicator, '10.0.0.5');
  assert.equal(r.reserved[0].saved, false);
  assert.equal(r.invalid[0].original, 'lixo');
  assert.equal(r.kept.length, 0);
  assert.deepEqual(reportSections(r).map((s) => s.id), ['saved', 'alreadyExists', 'duplicates', 'coveredByCidr', 'reserved', 'invalid']);
});

test('modo substituir: os que já estavam aparecem como mantidos', () => {
  const preview = analyzeImportBatch('194.26.29.112\n45.95.147.10', new Set(['194.26.29.112', '8.8.4.4']), [], 'replace', []);
  const saved = new Set(preview.items.filter((i) => i.category === 'new' || i.category === 'already_exists').map((i) => i.indicator));
  const r = buildImportReport(preview, { mode: 'replace', saved, legitSkipped: [] });
  assert.deepEqual(r.kept, ['194.26.29.112']);
  assert.deepEqual(r.saved, ['45.95.147.10']);
  assert.deepEqual(r.alreadyExists, []);
});
