import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  ExternalLink,
  Layers,
  MapPin,
  MessageSquare,
  Palette,
  Smartphone,
  Type as TypeIcon,
} from 'lucide-react';
import type { ScannerBlueprintResult } from '../types/blueprint';
import { MarkdownRenderer } from './MarkdownRenderer';

interface BlueprintWorkspaceProps {
  result: ScannerBlueprintResult;
  onCopyPrompt: () => void;
  promptCopied: boolean;
}

export function BlueprintWorkspace({
  result,
  onCopyPrompt,
  promptCopied,
}: BlueprintWorkspaceProps) {
  const { companyProfile, architecture, executiveReportMarkdown, finalBuildPrompt } = result;

  const [selectedScreenIdx, setSelectedScreenIdx] = useState(0);
  const [copiedHex, setCopiedHex] = useState<string | null>(null);
  const [copiedWhatsapp, setCopiedWhatsapp] = useState(false);

  const activeScreen = architecture.screens[selectedScreenIdx] || architecture.screens[0];

  const handleCopyHex = async (hex: string) => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopiedHex(hex);
      setTimeout(() => setCopiedHex(null), 1800);
    } catch {
      // Clipboard fallback silent
    }
  };

  const handleCopyWhatsapp = async () => {
    try {
      await navigator.clipboard.writeText(architecture.whatsappAndSocialStrategy.prefilledMessageTemplate);
      setCopiedWhatsapp(true);
      setTimeout(() => setCopiedWhatsapp(false), 2000);
    } catch {
      // Clipboard fallback silent
    }
  };

  const handleDownloadText = (filename: string, text: string) => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const slugName = (companyProfile.name || 'empresa')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const promptChars = finalBuildPrompt.length;
  const promptLines = finalBuildPrompt.split('\n').length;

  return (
    <div className="mx-auto max-w-7xl space-y-20 px-6 pb-24 pt-8">
      {/* SECTION 01: DOSSIÊ DA EMPRESA */}
      <section id="dossie" className="scroll-mt-24 space-y-8">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-800/80 pb-6 md:flex-row md:items-end">
          <div className="space-y-2">
            <p className="text-xs font-medium tracking-wider text-cyan-300">
              01. Levantamento Verificado
            </p>
            <h2 className="font-display text-3xl font-bold tracking-tight text-white">
              {companyProfile.name}
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
              <span>{companyProfile.category}</span>
              <span aria-hidden="true">·</span>
              <span>{companyProfile.locationSummary}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                Analisado em {new Date(result.analyzedAt).toLocaleString('pt-BR')}
              </span>
            </div>
          </div>

          <a
            href={companyProfile.socialLinks.googleMapsUrl || result.resolvedMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-3d-secondary inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-semibold text-slate-100 whitespace-nowrap shrink-0"
          >
            <MapPin className="h-3.5 w-3.5 text-cyan-300" />
            <span>
              {(companyProfile.socialLinks.googleMapsUrl || '').includes('google.com/maps') ||
              (companyProfile.socialLinks.googleMapsUrl || '').includes('goo.gl')
                ? 'Abrir no Google Maps'
                : 'Abrir Link Analisado'}
            </span>
            <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
          </a>
        </div>

        {/* Structured Dossier Grid (single-level depth, whitespace separated) */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="surface-3d rounded-3xl p-6 space-y-5">
            <h3 className="font-display text-base font-semibold text-white">
              Dados de Contato e Operação
            </h3>
            <dl className="space-y-4 text-sm">
              {companyProfile.legalName && (
                <div>
                  <dt className="text-xs text-slate-400">
                    Razão Social
                    {companyProfile.fieldStatuses?.legalName === 'confirmed'
                      ? ' · Confirmada'
                      : companyProfile.fieldStatuses?.legalName === 'unconfirmed'
                        ? ' · Não confirmada'
                        : ''}
                  </dt>
                  <dd className="mt-1 text-slate-200 leading-relaxed">{companyProfile.legalName}</dd>
                </div>
              )}
              {companyProfile.cnpj && (
                <div className={companyProfile.legalName ? 'border-t border-slate-800/70 pt-3' : ''}>
                  <dt className="text-xs text-slate-400">
                    CNPJ
                    {companyProfile.fieldStatuses?.cnpj === 'confirmed'
                      ? ' · Confirmado'
                      : companyProfile.fieldStatuses?.cnpj === 'unconfirmed'
                        ? ' · Não confirmado'
                        : ''}
                  </dt>
                  <dd className="mt-1 font-mono text-slate-200 tabular-nums">{companyProfile.cnpj}</dd>
                </div>
              )}
              <div className={companyProfile.legalName || companyProfile.cnpj ? 'border-t border-slate-800/70 pt-3' : ''}>
                <dt className="text-xs text-slate-400">
                  Endereço
                  {companyProfile.fieldStatuses?.address === 'confirmed'
                    ? ' · Confirmado'
                    : companyProfile.fieldStatuses?.address === 'unconfirmed'
                      ? ' · Não confirmado'
                      : ''}
                </dt>
                <dd className="mt-1 text-slate-200 leading-relaxed">{companyProfile.address}</dd>
              </div>
              <div className="border-t border-slate-800/70 pt-3">
                <dt className="text-xs text-slate-400">Telefone / WhatsApp</dt>
                <dd className="mt-1 font-mono text-slate-200 tabular-nums">
                  {companyProfile.phone}
                  {companyProfile.whatsapp && !companyProfile.phone.includes(companyProfile.whatsapp)
                    ? ` · WhatsApp ${companyProfile.whatsapp}`
                    : ''}
                </dd>
              </div>
              <div className="border-t border-slate-800/70 pt-3">
                <dt className="text-xs text-slate-400">Horários de Funcionamento</dt>
                <dd className="mt-1 text-slate-200 leading-relaxed">{companyProfile.hours}</dd>
              </div>
            </dl>
          </div>

          <div className="surface-3d rounded-3xl p-6 space-y-5">
            <h3 className="font-display text-base font-semibold text-white">
              Oferta, Reputação e Posicionamento
            </h3>
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-xs text-slate-400">Produtos e Serviços</p>
                <ul className="mt-2 space-y-1.5 text-slate-200">
                  {companyProfile.productsAndServices.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="border-t border-slate-800/70 pt-3">
                <p className="text-xs text-slate-400">Avaliações e Diferenciais</p>
                <p className="mt-1 text-slate-200 leading-relaxed">
                  {companyProfile.reviewsAndDifferentiators}
                </p>
              </div>
            </div>
          </div>

          <div className="surface-3d rounded-3xl p-6 space-y-5">
            <h3 className="font-display text-base font-semibold text-white">
              Identidade, Visual e Presença Digital
            </h3>
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-xs text-slate-400">Identidade e Posicionamento</p>
                <p className="mt-1 text-slate-200 leading-relaxed">
                  {companyProfile.identityAndPositioning}
                </p>
              </div>
              <div className="border-t border-slate-800/70 pt-3">
                <p className="text-xs text-slate-400">Fotografias e Referências Visuais</p>
                <p className="mt-1 text-slate-200 leading-relaxed">
                  {companyProfile.visualReferences}
                </p>
              </div>
              <div className="border-t border-slate-800/70 pt-3 space-y-2">
                <p className="text-xs text-slate-400">Canais Digitais Verificados</p>
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-400">Site oficial</span>
                    {companyProfile.socialLinks.website ? (
                      <a
                        href={companyProfile.socialLinks.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-cyan-300 hover:underline truncate max-w-[200px]"
                      >
                        <span className="truncate">{companyProfile.socialLinks.website}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="text-slate-500">Não localizado</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-400">Instagram</span>
                    {companyProfile.socialLinks.instagram ? (
                      <a
                        href={companyProfile.socialLinks.instagram}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-cyan-300 hover:underline truncate max-w-[200px]"
                      >
                        <span className="truncate">{companyProfile.socialLinks.instagram}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="text-slate-500">Não localizado</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-400">Facebook</span>
                    {companyProfile.socialLinks.facebook ? (
                      <a
                        href={companyProfile.socialLinks.facebook}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-cyan-300 hover:underline truncate max-w-[200px]"
                      >
                        <span className="truncate">{companyProfile.socialLinks.facebook}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="text-slate-500">Não localizado</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Limitations & Real Sources row */}
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="surface-3d-subtle rounded-3xl p-6 space-y-3">
            <div className="flex items-center gap-2 text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <h3 className="font-display text-sm font-semibold">
                Transparência e Limitações da Pesquisa
              </h3>
            </div>
            {companyProfile.limitations.length > 0 ? (
              <ul className="space-y-1.5 text-sm text-slate-300">
                {companyProfile.limitations.map((lim, idx) => (
                  <li key={idx} className="leading-relaxed">
                    · {lim}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">
                Nenhuma limitação crítica reportada nas fontes públicas acessadas.
              </p>
            )}
          </div>

          <div className="surface-3d-subtle rounded-3xl p-6 space-y-3">
            <h3 className="font-display text-sm font-semibold text-white">
              Fontes Reais Consultadas ({companyProfile.verifiedSources.length})
            </h3>
            {companyProfile.verifiedSources.length > 0 ? (
              <ul className="max-h-40 space-y-2 overflow-y-auto pr-2 text-xs">
                {companyProfile.verifiedSources.map((src, idx) => (
                  <li key={idx} className="flex items-center justify-between gap-3">
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-cyan-300 hover:text-cyan-200 hover:underline truncate"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      <span className="truncate">{src.title}</span>
                    </a>
                    <span className="shrink-0 text-slate-500">
                      {src.sourceType === 'google_maps' ? 'Maps' : 'Web'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">
                Referência baseada exclusivamente na URL informada do Google Maps e metadados públicos extraídos.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* SECTION 02: ARQUITETURA INTELIGENTE (11 PILARES) */}
      <section id="arquitetura" className="scroll-mt-24 space-y-10">
        <div className="space-y-2 border-b border-slate-800/80 pb-6">
          <p className="text-xs font-medium tracking-wider text-cyan-300">
            02. Arquitetura Inteligente do Aplicativo
          </p>
          <h2 className="font-display text-3xl font-bold tracking-tight text-white">
            Projeto Completo em 11 Pilares
          </h2>
          <p className="max-w-3xl text-sm text-slate-400 leading-relaxed">
            Proposta personalizada de produto, UX, direção de arte 3D e estratégia comercial desenhada sob medida para {companyProfile.name}.
          </p>
        </div>

        {/* Pillars 1, 2, 3 */}
        <div className="grid gap-6 lg:grid-cols-3">
          <article className="surface-3d rounded-3xl p-6 space-y-3">
            <p className="text-xs font-medium text-cyan-300">01. Conceito e Objetivo</p>
            <h3 className="font-display text-lg font-semibold text-white">
              Proposta Central do Aplicativo
            </h3>
            <p className="text-sm leading-relaxed text-slate-300">
              {architecture.conceptAndObjective}
            </p>
          </article>

          <article className="surface-3d rounded-3xl p-6 space-y-4">
            <p className="text-xs font-medium text-cyan-300">02. Público-Alvo</p>
            <h3 className="font-display text-lg font-semibold text-white">
              Perfis e Hábitos Mobile
            </h3>
            <div className="space-y-2.5 text-sm text-slate-300">
              <p>
                <span className="font-semibold text-white">Primário: </span>
                {architecture.targetAudience.primaryPersona}
              </p>
              <p>
                <span className="font-semibold text-white">Secundário: </span>
                {architecture.targetAudience.secondaryPersona}
              </p>
              <p className="text-xs text-slate-400">
                Uso mobile: {architecture.targetAudience.mobileHabits}
              </p>
            </div>
          </article>

          <article className="surface-3d rounded-3xl p-6 space-y-4">
            <p className="text-xs font-medium text-cyan-300">03. Identidade Visual</p>
            <h3 className="font-display text-lg font-semibold text-white">
              Direção Criativa e Motivo 3D
            </h3>
            <div className="space-y-2 text-sm text-slate-300">
              <p>{architecture.visualIdentity.styleDirection}</p>
              <p className="text-xs text-slate-400">
                <strong className="text-slate-200">Atmosfera:</strong> {architecture.visualIdentity.atmosphere}
              </p>
              <p className="text-xs text-slate-400">
                <strong className="text-slate-200">Tom de voz:</strong> {architecture.visualIdentity.brandVoice}
              </p>
              <p className="text-xs text-slate-400">
                <strong className="text-slate-200">Motivo 3D:</strong> {architecture.visualIdentity.motif3D}
              </p>
            </div>
          </article>
        </div>

        {/* Pillars 4, 5, 6: Palette, Typography, 3D Style */}
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Pillar 4: Color Palette */}
          <article className="surface-3d rounded-3xl p-6 lg:col-span-5 space-y-4">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-cyan-300" />
              <h3 className="font-display text-lg font-semibold text-white">
                04. Paleta de Cores (Clique para Copiar)
              </h3>
            </div>
            <div className="space-y-3">
              {architecture.colorPalette.map((swatch, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleCopyHex(swatch.hex)}
                  className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-2xl border border-slate-800/80 bg-slate-950/60 p-3 text-left transition-colors hover:border-cyan-400/45 focus-visible:outline-2 focus-visible:outline-cyan-400"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className="h-10 w-10 shrink-0 rounded-xl border border-white/15 shadow-md"
                      style={{ backgroundColor: swatch.hex }}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        {swatch.name} · <span className="font-normal text-slate-400">{swatch.role}</span>
                      </p>
                      <p className="truncate text-xs text-slate-400">{swatch.usage}</p>
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-xs text-cyan-300 tabular-nums">
                    {copiedHex === swatch.hex ? 'Copiado' : swatch.hex}
                  </span>
                </button>
              ))}
            </div>
          </article>

          {/* Pillar 5: Typography */}
          <article className="surface-3d rounded-3xl p-6 lg:col-span-3 space-y-4">
            <div className="flex items-center gap-2">
              <TypeIcon className="h-4 w-4 text-cyan-300" />
              <h3 className="font-display text-lg font-semibold text-white">
                05. Tipografia
              </h3>
            </div>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-slate-400">Display / Títulos</dt>
                <dd className="mt-0.5 font-display text-base font-bold text-white">
                  {architecture.typography.displayFont}
                </dd>
              </div>
              <div className="border-t border-slate-800/70 pt-2.5">
                <dt className="text-xs text-slate-400">Corpo e Interface</dt>
                <dd className="mt-0.5 font-medium text-slate-200">
                  {architecture.typography.bodyFont}
                </dd>
              </div>
              <div className="border-t border-slate-800/70 pt-2.5">
                <dt className="text-xs text-slate-400">Dados / Preços / Horários</dt>
                <dd className="mt-0.5 font-mono text-xs text-cyan-300">
                  {architecture.typography.monoFont}
                </dd>
              </div>
              <div className="border-t border-slate-800/70 pt-2.5">
                <dt className="text-xs text-slate-400">Justificativa</dt>
                <dd className="mt-1 text-xs leading-relaxed text-slate-300">
                  {architecture.typography.rationale}
                </dd>
              </div>
            </dl>
          </article>

          {/* Pillar 6: 3D Style & Effects */}
          <article className="surface-3d rounded-3xl p-6 lg:col-span-4 space-y-4">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-cyan-300" />
              <h3 className="font-display text-lg font-semibold text-white">
                06. Estilo 3D e Efeitos Visuais
              </h3>
            </div>
            <dl className="space-y-3 text-xs leading-relaxed text-slate-300">
              <div>
                <dt className="font-semibold text-white">Profundidade 3D</dt>
                <dd className="mt-0.5">{architecture.style3DAndEffects.depthSystem}</dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Iluminação e Sombras Realistas</dt>
                <dd className="mt-0.5">{architecture.style3DAndEffects.lightingAndShadows}</dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Tratamento Neon e Acentos</dt>
                <dd className="mt-0.5">{architecture.style3DAndEffects.neonAndAccentTreatment}</dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Botões Arredondados e Microinterações</dt>
                <dd className="mt-0.5">
                  {architecture.style3DAndEffects.buttonStyle} — {architecture.style3DAndEffects.microInteractions}
                </dd>
              </div>
            </dl>
          </article>
        </div>

        {/* Pillar 7: Structure of All Screens */}
        <article className="surface-3d rounded-3xl p-6 md:p-8 space-y-6">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div className="space-y-1">
              <p className="text-xs font-medium text-cyan-300">
                07. Estrutura de Todas as Telas ({architecture.screens.length})
              </p>
              <h3 className="font-display text-xl font-bold text-white">
                Mapa Interativo de Telas do Aplicativo
              </h3>
            </div>

            <div className="flex flex-wrap gap-2">
              {architecture.screens.map((scr, idx) => (
                <button
                  key={scr.id || idx}
                  type="button"
                  onClick={() => setSelectedScreenIdx(idx)}
                  className={`cursor-pointer rounded-full px-4 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                    idx === selectedScreenIdx
                      ? 'bg-cyan-400 text-slate-950 shadow-[0_6px_18px_-4px_rgba(34,211,238,0.5)]'
                      : 'bg-slate-900/90 text-slate-300 border border-slate-800 hover:border-cyan-400/40'
                  }`}
                >
                  {idx + 1}. {scr.name}
                </button>
              ))}
            </div>
          </div>

          {activeScreen && (
            <div className="grid gap-6 border-t border-slate-800/80 pt-6 lg:grid-cols-12">
              <div className="space-y-4 lg:col-span-5">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Smartphone className="h-4 w-4 text-cyan-300" />
                  <span className="font-mono text-cyan-300">{activeScreen.route}</span>
                </div>
                <h4 className="font-display text-2xl font-bold text-white">
                  {activeScreen.name}
                </h4>
                <p className="text-sm leading-relaxed text-slate-300">
                  {activeScreen.purpose}
                </p>
                <div className="border-t border-slate-800/70 pt-3">
                  <p className="text-xs font-semibold text-white">Estrutura de Layout</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-300">
                    {activeScreen.layoutStructure}
                  </p>
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-3 lg:col-span-7">
                <div className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-4 space-y-2.5">
                  <p className="text-xs font-semibold text-cyan-300">Componentes</p>
                  <ul className="space-y-1.5 text-xs leading-relaxed text-slate-300">
                    {activeScreen.keyComponents.map((comp, i) => (
                      <li key={i}>· {comp}</li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-4 space-y-2.5">
                  <p className="text-xs font-semibold text-cyan-300">Botões Principais</p>
                  <ul className="space-y-1.5 text-xs leading-relaxed text-slate-200">
                    {activeScreen.primaryButtons.map((btn, i) => (
                      <li key={i}>· {btn}</li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-4 space-y-2.5">
                  <p className="text-xs font-semibold text-cyan-300">Interações</p>
                  <ul className="space-y-1.5 text-xs leading-relaxed text-slate-300">
                    {activeScreen.userInteractions.map((inter, i) => (
                      <li key={i}>· {inter}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </article>

        {/* Pillar 8: Buttons & Features Table */}
        <article className="surface-3d rounded-3xl p-6 md:p-8 space-y-5">
          <div className="space-y-1">
            <p className="text-xs font-medium text-cyan-300">
              08. Botões e Funcionalidades
            </p>
            <h3 className="font-display text-xl font-bold text-white">
              Matriz de Ações e Conversão
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400">
                  <th className="py-3 pr-4 font-medium">Rótulo do Botão</th>
                  <th className="py-3 pr-4 font-medium">Tela</th>
                  <th className="py-3 pr-4 font-medium">Ação Executada</th>
                  <th className="py-3 font-medium">Valor Comercial</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {architecture.buttonsAndFeatures.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-900/40">
                    <td className="py-3 pr-4 font-semibold text-cyan-300 whitespace-nowrap">
                      {item.label}
                    </td>
                    <td className="py-3 pr-4 text-slate-300 whitespace-nowrap">
                      {item.screenLocation}
                    </td>
                    <td className="py-3 pr-4 text-slate-200 leading-relaxed">
                      {item.action}
                    </td>
                    <td className="py-3 text-slate-400 leading-relaxed">
                      {item.businessValue}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        {/* Pillars 9, 10, 11 */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Pillar 9: Navigation & UX */}
          <article className="surface-3d rounded-3xl p-6 space-y-4">
            <p className="text-xs font-medium text-cyan-300">09. Navegação e UX</p>
            <h3 className="font-display text-lg font-semibold text-white">
              Jornada e Experiência Mobile
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed">
              {architecture.navigationAndUX.navigationPattern}
            </p>
            <ol className="list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-slate-300">
              {architecture.navigationAndUX.userFlowSteps.map((step, idx) => (
                <li key={idx}>{step}</li>
              ))}
            </ol>
            <p className="border-t border-slate-800/70 pt-3 text-xs text-slate-400">
              {architecture.navigationAndUX.accessibilityNotes}
            </p>
          </article>

          {/* Pillar 10: Recommended Integrations */}
          <article className="surface-3d rounded-3xl p-6 space-y-4">
            <p className="text-xs font-medium text-cyan-300">10. Integrações Recomendadas</p>
            <h3 className="font-display text-lg font-semibold text-white">
              Ecossistema Sem Custo Obrigatório
            </h3>
            <ul className="space-y-3 text-xs">
              {architecture.recommendedIntegrations.map((integ, idx) => (
                <li
                  key={idx}
                  className="border-b border-slate-800/70 pb-3 last:border-b-0 last:pb-0 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white">{integ.name}</span>
                    <span className="text-cyan-300">{integ.costTier}</span>
                  </div>
                  <p className="text-slate-400">{integ.category}</p>
                  <p className="text-slate-300 leading-relaxed">{integ.purpose}</p>
                </li>
              ))}
            </ul>
          </article>

          {/* Pillar 11: WhatsApp & Social Strategy */}
          <article className="surface-3d rounded-3xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-cyan-300" />
              <p className="text-xs font-medium text-cyan-300">11. WhatsApp e Redes Sociais</p>
            </div>
            <h3 className="font-display text-lg font-semibold text-white">
              Estratégia de Conversão Direta
            </h3>
            <div className="space-y-3 text-xs leading-relaxed text-slate-300">
              <p>{architecture.whatsappAndSocialStrategy.whatsappFlow}</p>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/75 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-white">Mensagem Pré-preenchida</span>
                  <button
                    type="button"
                    onClick={handleCopyWhatsapp}
                    className="inline-flex cursor-pointer items-center gap-1 text-cyan-300 hover:text-cyan-200"
                  >
                    {copiedWhatsapp ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedWhatsapp ? 'Copiada' : 'Copiar'}</span>
                  </button>
                </div>
                <p className="font-mono text-[11px] text-slate-300">
                  {architecture.whatsappAndSocialStrategy.prefilledMessageTemplate}
                </p>
              </div>

              <p>
                <strong className="text-white">Instagram: </strong>
                {architecture.whatsappAndSocialStrategy.instagramFunnel}
              </p>
              <p>
                <strong className="text-white">Facebook & SEO Local: </strong>
                {architecture.whatsappAndSocialStrategy.facebookAndLocalSeo}
              </p>
            </div>
          </article>
        </div>
      </section>

      {/* SECTION 03: RELATÓRIO ESCRITO COMPLETO */}
      <section id="relatorio" className="scroll-mt-24 space-y-6">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-800/80 pb-6 sm:flex-row sm:items-end">
          <div className="space-y-2">
            <p className="text-xs font-medium tracking-wider text-cyan-300">
              03. Documento Executivo
            </p>
            <h2 className="font-display text-3xl font-bold tracking-tight text-white">
              Relatório Arquitetônico Completo
            </h2>
          </div>

          <button
            type="button"
            onClick={() =>
              handleDownloadText(`relatorio-${slugName}.md`, executiveReportMarkdown)
            }
            className="btn-3d-secondary inline-flex cursor-pointer items-center gap-2 rounded-full px-5 py-2.5 text-xs font-semibold text-slate-100 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5 text-cyan-300" />
            <span>Baixar Relatório (.md)</span>
          </button>
        </div>

        <div className="surface-3d rounded-3xl p-6 md:p-10">
          <MarkdownRenderer content={executiveReportMarkdown} />
        </div>
      </section>

      {/* SECTION 04: ÚNICO PROMPT FINAL DE CONSTRUÇÃO */}
      <section id="prompt-final" className="scroll-mt-24 space-y-6">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-800/80 pb-6 md:flex-row md:items-end">
          <div className="space-y-2">
            <p className="text-xs font-medium tracking-wider text-cyan-300">
              04. Entrega Final Pronta para Execução
            </p>
            <h2 className="font-display text-3xl font-bold tracking-tight text-white">
              Prompt Final de Construção
            </h2>
            <p className="max-w-2xl text-sm text-slate-400">
              Copie este prompt único e envie ao ChatGPT para refinamento ou execute diretamente no Google AI Studio para construir o aplicativo projetado.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() =>
                handleDownloadText(`prompt-construcao-${slugName}.txt`, finalBuildPrompt)
              }
              className="btn-3d-secondary inline-flex cursor-pointer items-center gap-2 rounded-full px-5 py-3 text-xs font-semibold text-slate-100 whitespace-nowrap shrink-0"
            >
              <Download className="h-4 w-4 text-cyan-300" />
              <span>Baixar (.txt)</span>
            </button>

            <button
              type="button"
              onClick={onCopyPrompt}
              className="btn-3d-neon inline-flex cursor-pointer items-center gap-2 rounded-full px-6 py-3 text-xs font-bold tracking-wide whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
            >
              {promptCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              <span>{promptCopied ? 'PROMPT COPIADO' : 'COPIAR PROMPT DE CONSTRUÇÃO'}</span>
            </button>
          </div>
        </div>

        <div className="surface-3d overflow-hidden rounded-3xl">
          <div className="flex items-center justify-between border-b border-slate-800/80 bg-slate-950/60 px-6 py-3 text-xs text-slate-400">
            <span>Prompt único autocontido · Português (BR)</span>
            <span className="font-mono tabular-nums">
              {promptLines} linhas · {promptChars.toLocaleString('pt-BR')} caracteres
            </span>
          </div>
          <pre className="max-h-[540px] overflow-y-auto whitespace-pre-wrap break-words p-6 font-mono text-xs leading-relaxed text-slate-200 md:p-8">
            {finalBuildPrompt}
          </pre>
        </div>
      </section>
    </div>
  );
}
