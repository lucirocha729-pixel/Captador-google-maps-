import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Compass,
  Layers,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { HeaderBar } from './components/HeaderBar';
import { ScannerViewport3D } from './components/ScannerViewport3D';
import type { ScannerPhase } from './components/ScannerViewport3D';
import { BlueprintWorkspace } from './components/BlueprintWorkspace';
import type {
  AnalysisErrorPayload,
  AnalysisStageEvent,
  CollectedResearchData,
  ScannerBlueprintResult,
} from './types/blueprint';

const EXAMPLE_LINKS = [
  {
    label: 'Site · MASP',
    url: 'https://masp.org.br/',
  },
  {
    label: 'CNPJ · Consulta Pública',
    url: 'https://cnpj.biz/60664745000187',
  },
  {
    label: 'Instagram · Empresa',
    url: 'https://www.instagram.com/masp/',
  },
  {
    label: 'Google Maps',
    url: 'https://www.google.com/maps/place/Museu+de+Arte+de+S%C3%A3o+Paulo+Assis+Chateaubriand/@-23.561414,-46.6558819,17z',
  },
];

export default function App() {
  const [mapsUrl, setMapsUrl] = useState('');
  const [phase, setPhase] = useState<ScannerPhase>('idle');
  const [stageInfo, setStageInfo] = useState<AnalysisStageEvent | null>(null);
  const [errorState, setErrorState] = useState<AnalysisErrorPayload | null>(null);
  const [preservedData, setPreservedData] = useState<CollectedResearchData | null>(null);
  const [result, setResult] = useState<ScannerBlueprintResult | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const [isGeneratingFallback, setIsGeneratingFallback] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultsAnchorRef = useRef<HTMLDivElement | null>(null);
  const isSubmittingRef = useRef(false);

  const handleFocusScanner = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => inputRef.current?.focus(), 250);
  };

  const handleCopyPrompt = async () => {
    if (!result?.finalBuildPrompt) return;
    try {
      await navigator.clipboard.writeText(result.finalBuildPrompt);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2400);
    } catch {
      setErrorState({
        status: 400,
        code: 'INVALID_INPUT',
        message:
          'Não foi possível copiar automaticamente. Selecione o texto no bloco do Prompt Final.',
      });
    }
  };

  const handleGenerateFromAvailable = async () => {
    if (!preservedData || isGeneratingFallback) return;
    setIsGeneratingFallback(true);
    try {
      const resp = await fetch('/api/blueprint-from-collected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collectedData: preservedData,
          reason: errorState?.message,
        }),
      });
      const data = (await resp.json()) as ScannerBlueprintResult & { error?: string };
      if (!resp.ok || data.error) {
        throw new Error(data.error || 'Falha ao gerar o projeto com os dados disponíveis.');
      }
      setResult(data);
      setPhase('complete');
      setErrorState(null);
      setTimeout(() => {
        resultsAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 140);
    } catch (err) {
      setErrorState({
        status: 500,
        code: 'UPSTREAM_ERROR',
        message: err instanceof Error ? err.message : 'Erro ao montar o projeto com dados disponíveis.',
        collectedData: preservedData,
      });
    } finally {
      setIsGeneratingFallback(false);
    }
  };

  const runAnalysis = async (targetUrl: string) => {
    if (isSubmittingRef.current) return;

    const trimmed = targetUrl.trim();
    if (!trimmed) {
      setErrorState({
        status: 400,
        code: 'INVALID_INPUT',
        message: 'Cole qualquer link público da empresa para iniciar a identificação.',
      });
      inputRef.current?.focus();
      return;
    }

    isSubmittingRef.current = true;
    setErrorState(null);
    setPhase('scanning');
    setStageInfo({
      stage: 'Conectando ao núcleo de pesquisa',
      detail: 'Validando link informado e iniciando identificação em fontes públicas.',
    });

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed, mapsUrl: trimmed }),
      });

      const contentType = response.headers.get('content-type') || '';

      if (!response.ok || contentType.includes('application/json')) {
        const errPayload = (await response.json().catch(() => null)) as { error?: string } | null;
        setErrorState({
          status: response.status,
          code: response.status === 429 ? 'RATE_LIMITED' : 'INVALID_INPUT',
          message: errPayload?.error || 'Falha ao iniciar a análise da empresa.',
        });
        setPhase(result ? 'complete' : 'idle');
        setStageInfo(null);
        return;
      }

      if (!response.body) {
        throw new Error('Resposta sem fluxo de dados do servidor.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let receivedResult: ScannerBlueprintResult | null = null;
      let streamError: AnalysisErrorPayload | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const rawEvent of events) {
          const lines = rawEvent.split('\n');
          let eventType = 'message';
          const dataLines: string[] = [];

          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trim());
            }
          }

          if (dataLines.length === 0) continue;
          const payload = JSON.parse(dataLines.join('\n'));

          if (eventType === 'status') {
            setStageInfo(payload as AnalysisStageEvent);
          } else if (eventType === 'error') {
            streamError = payload as AnalysisErrorPayload;
            if (streamError.collectedData) {
              setPreservedData(streamError.collectedData);
            }
          } else if (eventType === 'result') {
            receivedResult = payload as ScannerBlueprintResult;
          }
        }
      }

      if (streamError) {
        setErrorState(streamError);
        setPhase(result ? 'complete' : 'idle');
        setStageInfo(null);
        return;
      }

      if (!receivedResult) {
        throw new Error('A análise terminou sem retornar o projeto arquitetônico.');
      }

      setResult(receivedResult);
      setPreservedData(null);
      setErrorState(null);
      setPhase('complete');
      setStageInfo(null);

      setTimeout(() => {
        resultsAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 140);
    } catch (err) {
      setPhase(result ? 'complete' : 'idle');
      setStageInfo(null);
      setErrorState({
        status: 500,
        code: 'UPSTREAM_ERROR',
        message: err instanceof Error ? err.message : 'Erro inesperado ao analisar o link.',
        collectedData: preservedData ?? undefined,
      });
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void runAnalysis(mapsUrl);
  };

  return (
    <div className="min-h-screen bg-[#060913] text-slate-100">
      <HeaderBar
        hasResult={Boolean(result)}
        onCopyPrompt={() => void handleCopyPrompt()}
        onFocusScanner={handleFocusScanner}
        promptCopied={promptCopied}
      />

      <main>
        {/* HERO SCANNER SECTION */}
        <section
          id="scanner"
          className="relative overflow-hidden border-b border-slate-800/70 bg-[radial-gradient(ellipse_at_top,rgba(14,116,144,0.16),transparent_60%)]"
        >
          <div className="mx-auto grid max-w-7xl items-stretch gap-10 px-6 py-12 lg:grid-cols-12 lg:py-16">
            {/* Left Column: Single Input & Action */}
            <div className="flex flex-col justify-center space-y-7 lg:col-span-7">
              <div className="space-y-4">
                <p className="text-xs font-medium tracking-wider text-cyan-300">
                  Identificação Universal · Arquitetura 3D · Prompt Final de Construção
                </p>
                <h1 className="font-display text-4xl font-extrabold tracking-tight text-white [text-wrap:balance] sm:text-5xl">
                  COLE QUALQUER LINK DA EMPRESA
                </h1>
                <p className="max-w-2xl text-base leading-relaxed text-slate-300">
                  Instagram, Facebook, CNPJ, site, Google Maps ou qualquer outra página pública. O VIRA SCANNER 3D cruza fontes públicas reais, projeta os 11 pilares de UI/UX 3D e gera o prompt único pronto para construção.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <label htmlFor="company-link-input" className="sr-only">
                  Cole qualquer link da empresa
                </label>

                <div className="input-3d-recessed flex flex-col gap-3 rounded-3xl p-2.5 sm:flex-row sm:items-center">
                  <div className="flex flex-1 items-center gap-3 px-3">
                    <Link2 className="h-5 w-5 shrink-0 text-cyan-400" />
                    <input
                      id="company-link-input"
                      ref={inputRef}
                      type="url"
                      value={mapsUrl}
                      onChange={(e) => setMapsUrl(e.target.value)}
                      placeholder="Instagram, Facebook, CNPJ, site, Google Maps ou outra página pública..."
                      disabled={phase === 'scanning'}
                      className="w-full bg-transparent py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none disabled:opacity-60"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={phase === 'scanning'}
                    className="btn-3d-neon inline-flex cursor-pointer items-center justify-center gap-2 rounded-full px-7 py-3.5 text-xs font-extrabold tracking-wider whitespace-nowrap shrink-0 disabled:cursor-not-allowed disabled:opacity-65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                  >
                    {phase === 'scanning' ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>IDENTIFICANDO...</span>
                      </>
                    ) : (
                      <>
                        <span>IDENTIFICAR EMPRESA</span>
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </div>

                {/* Live SSE stage progress during scanning */}
                {phase === 'scanning' && stageInfo && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="surface-3d-subtle flex items-start gap-3 rounded-2xl px-4 py-3 text-xs"
                  >
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-cyan-300" />
                    <div className="space-y-0.5">
                      <p className="font-semibold text-white">{stageInfo.stage}</p>
                      <p className="text-slate-400">{stageInfo.detail}</p>
                    </div>
                  </div>
                )}

                {/* Informative 429 / Error Recovery Panel */}
                {errorState && (
                  <div
                    role="alert"
                    className={`rounded-3xl border p-5 space-y-4 ${
                      errorState.code === 'RATE_LIMITED'
                        ? 'border-amber-500/40 bg-amber-950/25 text-amber-100'
                        : 'border-rose-500/40 bg-rose-950/35 text-rose-100'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <AlertTriangle
                        className={`mt-0.5 h-5 w-5 shrink-0 ${
                          errorState.code === 'RATE_LIMITED' ? 'text-amber-300' : 'text-rose-300'
                        }`}
                      />
                      <div className="space-y-1.5 text-sm">
                        <p className="font-semibold">
                          {errorState.code === 'RATE_LIMITED'
                            ? 'Limite de requisições da API Gemini (429 RESOURCE_EXHAUSTED)'
                            : 'Aviso na análise do link'}
                        </p>
                        <p className="text-xs leading-relaxed opacity-90">{errorState.message}</p>
                      </div>
                    </div>

                    {preservedData && (
                      <div className="rounded-2xl border border-white/10 bg-slate-950/65 p-3.5 text-xs text-slate-300 space-y-1.5">
                        <p className="font-semibold text-cyan-300">
                          Dados preservados das fontes consultadas:
                        </p>
                        <p>
                          <strong className="text-white">Estabelecimento:</strong>{' '}
                          {preservedData.placeName || preservedData.legalName || 'Identificado apenas pela URL'}
                        </p>
                        {preservedData.cnpj && (
                          <p className="font-mono tabular-nums">
                            <strong className="font-sans text-white">CNPJ:</strong> {preservedData.cnpj}
                          </p>
                        )}
                        {preservedData.address && (
                          <p>
                            <strong className="text-white">Endereço:</strong> {preservedData.address}
                          </p>
                        )}
                        {preservedData.metaDescription && (
                          <p>
                            <strong className="text-white">Resumo público:</strong>{' '}
                            {preservedData.metaDescription}
                          </p>
                        )}
                        {preservedData.latLng && (
                          <p className="font-mono tabular-nums text-slate-400">
                            Coordenadas: {preservedData.latLng.latitude.toFixed(5)},{' '}
                            {preservedData.latLng.longitude.toFixed(5)}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void runAnalysis(mapsUrl)}
                        disabled={phase === 'scanning' || isGeneratingFallback}
                        className="btn-3d-secondary inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold text-white whitespace-nowrap"
                      >
                        <RefreshCw className="h-3.5 w-3.5 text-cyan-300" />
                        <span>Tentar Novamente</span>
                      </button>

                      {preservedData && (
                        <button
                          type="button"
                          onClick={() => void handleGenerateFromAvailable()}
                          disabled={isGeneratingFallback || phase === 'scanning'}
                          className="btn-3d-neon inline-flex cursor-pointer items-center gap-2 rounded-full px-5 py-2 text-xs font-bold whitespace-nowrap"
                        >
                          {isGeneratingFallback ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Layers className="h-3.5 w-3.5" />
                          )}
                          <span>Gerar Projeto e Prompt com Dados Disponíveis</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Quick functional test buttons */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-xs text-slate-500">Testar com exemplo real:</span>
                  {EXAMPLE_LINKS.map((example) => (
                    <button
                      key={example.label}
                      type="button"
                      disabled={phase === 'scanning'}
                      onClick={() => {
                        setMapsUrl(example.url);
                        setErrorState(null);
                      }}
                      className="cursor-pointer rounded-full border border-slate-800 bg-slate-900/75 px-3.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-cyan-400/50 hover:text-cyan-200 disabled:opacity-50 whitespace-nowrap"
                    >
                      {example.label}
                    </button>
                  ))}
                </div>
              </form>

              <div className="grid gap-4 border-t border-slate-800/80 pt-5 text-xs text-slate-400 sm:grid-cols-2">
                <div className="flex items-start gap-2.5">
                  <Compass className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
                  <span>
                    Fontes públicas reais com declaração explícita de limitações quando um dado não é localizado.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
                  <span>
                    Entrega apenas o dossiê, projeto arquitetônico e prompt de construção sem construir o app do cliente.
                  </span>
                </div>
              </div>
            </div>

            {/* Right Column: Interactive 3D Spatial Viewport */}
            <div className="lg:col-span-5">
              <ScannerViewport3D phase={phase} stageLabel={stageInfo?.stage} />
            </div>
          </div>
        </section>

        {/* WORKSPACE OUTPUT */}
        <div ref={resultsAnchorRef}>
          {result ? (
            <BlueprintWorkspace
              result={result}
              onCopyPrompt={() => void handleCopyPrompt()}
              promptCopied={promptCopied}
            />
          ) : (
            <section className="mx-auto max-w-7xl px-6 py-16">
              <div className="surface-3d-subtle grid gap-8 rounded-3xl p-8 md:grid-cols-3">
                <div className="space-y-2">
                  <p className="text-xs font-medium text-cyan-300">Etapa 01</p>
                  <h2 className="font-display text-lg font-semibold text-white">
                    Investigação Fundamentada
                  </h2>
                  <p className="text-sm leading-relaxed text-slate-400">
                    Extrai nome, endereço, telefone, horários, produtos, avaliações, links reais e posicionamento sem inventar informações.
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-cyan-300">Etapa 02</p>
                  <h2 className="font-display text-lg font-semibold text-white">
                    Arquitetura 3D em 11 Pilares
                  </h2>
                  <p className="text-sm leading-relaxed text-slate-400">
                    Define conceito, público-alvo, paleta hex, tipografia, estética 3D, telas, botões, UX, integrações gratuitas e funil WhatsApp.
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-cyan-300">Etapa 03</p>
                  <h2 className="font-display text-lg font-semibold text-white">
                    Prompt Final de Construção
                  </h2>
                  <p className="text-sm leading-relaxed text-slate-400">
                    Gera um único prompt completo pronto para copiar, refinar no ChatGPT e executar no Google AI Studio.
                  </p>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>

      <footer className="border-t border-slate-800/80 py-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 text-xs text-slate-500 sm:flex-row">
          <span>VIRA SCANNER 3D — Arquiteto Inteligente de Aplicativos</span>
          <span>Pesquisa fundamentada e documentação arquitetônica comercial</span>
        </div>
      </footer>
    </div>
  );
}
