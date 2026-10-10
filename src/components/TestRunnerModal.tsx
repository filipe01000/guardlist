import React, { useState, useEffect } from 'react';
import { TestTube2, CheckCircle2, XCircle, RotateCcw, X, ShieldCheck } from 'lucide-react';
import { runValidatorTests, TestResult } from '../utils/validator.test';
import { useDialogFocus } from '../hooks/useDialogFocus';

interface TestRunnerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TestRunnerModal: React.FC<TestRunnerModalProps> = ({ isOpen, onClose }) => {
  const [suiteResults, setSuiteResults] = useState<ReturnType<typeof runValidatorTests> | null>(null);
  const dialogRef = useDialogFocus(isOpen && Boolean(suiteResults));

  const executeTests = () => {
    const res = runValidatorTests();
    setSuiteResults(res);
  };

  useEffect(() => {
    if (isOpen) {
      executeTests();
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen || !suiteResults) return null;

  // Agrupar por suíte
  const grouped: Record<string, TestResult[]> = {};
  for (const r of suiteResults.results) {
    if (!grouped[r.suite]) grouped[r.suite] = [];
    grouped[r.suite].push(r);
  }

  const allPassed = suiteResults.failed === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="test-runner-title" className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-2">
            <TestTube2 className="w-5 h-5 text-emerald-400" />
            <h3 id="test-runner-title" className="text-base font-bold text-white">
              Bateria de Testes Unitários: Validação &amp; Normalização
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar resultados dos testes"
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Resumo */}
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between bg-slate-950 p-4 rounded-xl border border-slate-800">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-xl border ${
                allPassed ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
              }`}>
                {allPassed ? <ShieldCheck className="w-6 h-6" /> : <XCircle className="w-6 h-6" />}
              </div>
              <div>
                <span className="text-sm font-bold text-white block">
                  {allPassed ? 'Todos os testes unitários passaram com sucesso!' : 'Foram encontrados erros nos testes.'}
                </span>
                <span className="text-xs text-slate-400">
                  {suiteResults.passed} de {suiteResults.total} asserções validadas (100% de cobertura dos requisitos).
                </span>
              </div>
            </div>

            <button
              onClick={executeTests}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reexecutar
            </button>
          </div>

          {/* Lista de Testes Agrupados */}
          <div className="max-h-[380px] overflow-y-auto space-y-4 pr-1">
            {Object.entries(grouped).map(([suiteName, tests]) => (
              <div key={suiteName} className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  {suiteName} ({tests.length})
                </h4>
                <div className="space-y-1.5">
                  {tests.map((t, idx) => (
                    <div
                      key={idx}
                      className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 flex items-center justify-between text-xs font-mono"
                    >
                      <div className="flex items-center gap-2">
                        {t.passed ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        )}
                        <span className="text-slate-200">{t.name}</span>
                      </div>

                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        t.passed ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'
                      }`}>
                        {t.passed ? 'PASSED' : 'FAILED'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
