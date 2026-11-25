interface HeaderBarProps {
  hasResult: boolean;
  onCopyPrompt: () => void;
  onFocusScanner: () => void;
  promptCopied: boolean;
}

export function HeaderBar({
  hasResult,
  onCopyPrompt,
  onFocusScanner,
  promptCopied,
}: HeaderBarProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#060913]/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-4">
        {/* Zone 1: Single-line brand wordmark */}
        <a
          href="#scanner"
          className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          VIRA SCANNER 3D
        </a>

        {/* Zone 2: Concise single-line navigation links */}
        <nav
          aria-label="Navegação principal"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-300"
        >
          <a
            href="#scanner"
            className="whitespace-nowrap shrink-0 transition-colors hover:text-cyan-300"
          >
            Scanner
          </a>
          <a
            href="#dossie"
            className={`whitespace-nowrap shrink-0 transition-colors ${
              hasResult ? 'hover:text-cyan-300' : 'text-slate-500 pointer-events-none'
            }`}
          >
            Dossiê
          </a>
          <a
            href="#arquitetura"
            className={`whitespace-nowrap shrink-0 transition-colors ${
              hasResult ? 'hover:text-cyan-300' : 'text-slate-500 pointer-events-none'
            }`}
          >
            Arquitetura
          </a>
          <a
            href="#prompt-final"
            className={`whitespace-nowrap shrink-0 transition-colors ${
              hasResult ? 'hover:text-cyan-300' : 'text-slate-500 pointer-events-none'
            }`}
          >
            Prompt Final
          </a>
        </nav>

        {/* Zone 3: Single primary action */}
        <div className="shrink-0">
          {hasResult ? (
            <button
              type="button"
              onClick={onCopyPrompt}
              className="btn-3d-neon cursor-pointer rounded-full px-5 py-2 text-xs font-bold tracking-wide whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
            >
              {promptCopied ? 'Prompt Copiado' : 'Copiar Prompt Final'}
            </button>
          ) : (
            <button
              type="button"
              onClick={onFocusScanner}
              className="btn-3d-secondary cursor-pointer rounded-full px-5 py-2 text-xs font-semibold text-slate-100 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
            >
              Nova Análise
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
