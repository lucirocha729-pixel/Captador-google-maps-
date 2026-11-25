import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Compass,
  FileText,
  Image as ImageIcon,
  Layers,
  Loader2,
  Paperclip,
  RefreshCw,
  ShieldCheck,
  X,
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

interface AttachedMaterial {
  id: string;
  file: File;
  previewUrl: string | null;
}

const EXAMPLE_INPUTS = [
  {
    label: 'CNPJ',
    value: '60.664.745/0001-87',
  },
  {
    label: 'Nome da Empresa',
    value: 'Museu de Arte de São Paulo MASP',
  },
  {
    label: 'Texto Copiado do Google',
    value: `Museu de Arte de São Paulo Assis Chateaubriand\nAv. Paulista, 1578 - Bela Vista, São Paulo - SP, 01310-200\n(11) 3149-5959\nhttps://masp.org.br`,
  },
  {
    label: 'Instagram + Site',
    value: 'https://www.instagram.com/masp/\nhttps://masp.org.br/',
  },
];

const MAX_CLIENT_FILES = 5;
const MAX_CLIENT_FILE_BYTES = 5 * 1024 * 1024;

export default function App() {
  const [materialText, setMaterialText] = useState('');
  const [attachments, setAttachments] = useState<AttachedMaterial[]>([]);
  const [phase, setPhase] = useState<ScannerPhase>('idle');
  const [stageInfo, setStageInfo] = useState<AnalysisStageEvent | null>(null);
  const [errorState, setErrorState] = useState<AnalysisErrorPayload | null>(null);
  const [preservedData, setPreservedData] = useState<CollectedResearchData | null>(null);
  const [result, setResult] = useState<ScannerBlueprintResult | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const [isGeneratingFallback, setIsGeneratingFallback] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const resultsAnchorRef = useRef<HTMLDivElement | null>(null);
  const isSubmittingRef = useRef(false);
  const attachmentsRef = useRef<AttachedMaterial[]>([]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    return () => {
      for (const att of attachmentsRef.current) {
        if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
      }
    };
  }, []);

  const handleFocusScanner = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => textareaRef.current?.focus(), 250);
  };

  const addFiles = (incomingFiles: File[]) => {
    if (incomingFiles.length === 0) return;
    setErrorState(null);

    const nextItems: AttachedMaterial[] = [];
    for (const file of incomingFiles) {
      if (attachments.length + nextItems.length >= MAX_CLIENT_FILES) {
        setErrorState({
          status: 400,
          code: 'INVALID_INPUT',
          message: `Limite máximo de ${MAX_CLIENT_FILES} arquivos por identificação.`,
        });
        break;
      }
      if (file.size > MAX_CLIENT_FILE_BYTES) {
        setErrorState({
          status: 400,
          code: 'INVALID_INPUT',
          message: `O arquivo "${file.name}" excede o limite de 5 MB.`,
        });
        continue;
      }
      const isImage = file.type.startsWith('image/');
      const previewUrl = isImage ? URL.createObjectURL(file) : null;
      nextItems.push({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        previewUrl,
      });
    }

    if (nextItems.length > 0) {
      setAttachments((prev) => [...prev, ...nextItems]);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files ? Array.from(e.target.files) : [];
    addFiles(fileList);
    e.target.value = '';
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const pastedFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) pastedFiles.push(f);
      }
    }

    if (pastedFiles.length > 0) {
      addFiles(pastedFiles);
    }
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

  const runAnalysis = async (rawText: string, files: AttachedMaterial[]) => {
    if (isSubmittingRef.current) return;

    const trimmed = rawText.trim();
    if (!trimmed && files.length === 0) {
      setErrorState({
        status: 400,
        code: 'INVALID_INPUT',
        message:
          'Cole qualquer informação da empresa (CNPJ, nome, endereço, texto do Google, links) ou anexe uma imagem/documento.',
      });
      textareaRef.current?.focus();
      return;
    }

    isSubmittingRef.current = true;
    setErrorState(null);
    setPhase('scanning');
    setStageInfo({
      stage: 'Recebendo e classificando material',
      detail:
        files.length > 0
          ? `Processando texto e ${files.length} anexo(s) enviado(s) para identificar a empresa.`
          : 'Extraindo identificadores (CNPJ, nome, telefone, endereço ou links) para pesquisa.',
    });

    try {
      let response: Response;
      if (files.length > 0) {
        const formData = new FormData();
        formData.append('text', trimmed);
        for (const item of files) {
          formData.append('files', item.file);
        }
        response = await fetch('/api/analyze', {
          method: 'POST',
          body: formData,
        });
      } else {
        response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: trimmed }),
        });
      }

      const contentType = response.headers.get('content-type') || '';

      if (!response.ok || contentType.includes('application/json')) {
        const errPayload = (await response.json().catch(() => null)) as { error?: string } | null;
        setErrorState({
          status: response.status,
          code: response.status === 429 ? 'RATE_LIMITED' : 'INVALID_INPUT',
          message: errPayload?.error || 'Falha ao iniciar a identificação da empresa.',
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
        throw new Error('A identificação terminou sem retornar o projeto arquitetônico.');
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
        message: err instanceof Error ? err.message : 'Erro inesperado ao identificar a empresa.',
        collectedData: preservedData ?? undefined,
      });
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void runAnalysis(materialText, attachments);
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
            {/* Left Column: Universal Multimodal Identification Input */}
            <div className="flex flex-col justify-center space-y-6 lg:col-span-7">
              <div className="space-y-4">
                <p className="text-xs font-medium tracking-wider text-cyan-300">
                  Motor de Identificação Universal · OCR · CNPJ · Arquitetura 3D
                </p>
                <h1 className="font-display text-4xl font-extrabold tracking-tight text-white [text-wrap:balance] sm:text-5xl">
                  VAMOS ENCONTRAR SUA EMPRESA
                </h1>
                <p className="max-w-2xl text-base leading-relaxed text-slate-300">
                  Cole qualquer informação, envie uma imagem ou digite o CNPJ, nome ou endereço. Nossa inteligência identifica sua empresa.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <label htmlFor="company-material-input" className="sr-only">
                  Cole informações, links, CNPJ, nome ou endereço da empresa
                </label>

                <div className="input-3d-recessed rounded-3xl p-4 space-y-3">
                  <textarea
                    id="company-material-input"
                    ref={textareaRef}
                    rows={4}
                    value={materialText}
                    onChange={(e) => setMaterialText(e.target.value)}
                    onPaste={handlePaste}
                    placeholder="Cole texto do Google ou Instagram, CNPJ, razão social, nome fantasia, endereço, telefone, múltiplos links ou cole uma captura de tela (Ctrl+V)..."
                    disabled={phase === 'scanning'}
                    className="w-full resize-y bg-transparent text-sm leading-relaxed text-white placeholder:text-slate-500 focus:outline-none disabled:opacity-60"
                  />

                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 border-t border-slate-800/80 pt-3">
                      {attachments.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center gap-2 rounded-2xl border border-slate-700/80 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-200"
                        >
                          {item.previewUrl ? (
                            <img
                              src={item.previewUrl}
                              alt={item.file.name}
                              className="h-6 w-6 rounded-lg object-cover border border-white/10"
                            />
                          ) : item.file.type.startsWith('image/') ? (
                            <ImageIcon className="h-4 w-4 text-cyan-300" />
                          ) : (
                            <FileText className="h-4 w-4 text-cyan-300" />
                          )}
                          <span className="max-w-[160px] truncate">{item.file.name}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveAttachment(item.id)}
                            disabled={phase === 'scanning'}
                            aria-label={`Remover ${item.file.name}`}
                            className="cursor-pointer rounded-full p-0.5 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-40"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/70 pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept="image/png,image/jpeg,image/webp,image/gif,.pdf,.txt,.csv,.json,.md"
                        onChange={handleFileChange}
                        className="sr-only"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={phase === 'scanning'}
                        className="btn-3d-secondary inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold text-slate-200 whitespace-nowrap disabled:opacity-55"
                      >
                        <Paperclip className="h-3.5 w-3.5 text-cyan-300" />
                        <span>Anexar Imagem ou Documento</span>
                      </button>
                      <span className="text-[11px] text-slate-500">
                        Imagens (OCR), PDF, TXT · até 5 MB
                      </span>
                    </div>

                    <button
                      type="submit"
                      disabled={phase === 'scanning'}
                      className="btn-3d-neon inline-flex cursor-pointer items-center justify-center gap-2 rounded-full px-7 py-3 text-xs font-extrabold tracking-wider whitespace-nowrap shrink-0 disabled:cursor-not-allowed disabled:opacity-65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
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
                            : 'Aviso na identificação'}
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
                          {preservedData.placeName || preservedData.legalName || preservedData.inputSummary || 'Identificado'}
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
                        onClick={() => void runAnalysis(materialText, attachments)}
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
                  <span className="text-xs text-slate-500">Testar entrada:</span>
                  {EXAMPLE_INPUTS.map((example) => (
                    <button
                      key={example.label}
                      type="button"
                      disabled={phase === 'scanning'}
                      onClick={() => {
                        setMaterialText(example.value);
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
                    Identifica por CNPJ, nome, endereço, texto copiado, captura de tela (OCR) ou múltiplos links, cruzando fontes públicas reais.
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
