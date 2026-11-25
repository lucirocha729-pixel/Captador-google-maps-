import type { ReactNode } from 'react';

interface MarkdownRendererProps {
  content: string;
}

function renderInlineSegments(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyCounter = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={`b-${keyCounter++}`} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code
          key={`c-${keyCounter++}`}
          className="rounded-md bg-slate-900/90 px-1.5 py-0.5 font-mono text-xs text-cyan-300"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      if (linkMatch) {
        parts.push(
          <a
            key={`a-${keyCounter++}`}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-300 underline decoration-cyan-500/40 underline-offset-4 hover:text-cyan-200"
          >
            {linkMatch[1]}
          </a>
        );
      } else {
        parts.push(token);
      }
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const lines = content.split('\n');
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let blockKey = 0;

  const flushList = () => {
    if (listItems.length === 0) return;
    if (listOrdered) {
      blocks.push(
        <ol
          key={`ol-${blockKey++}`}
          className="my-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-slate-300"
        >
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInlineSegments(item)}</li>
          ))}
        </ol>
      );
    } else {
      blocks.push(
        <ul
          key={`ul-${blockKey++}`}
          className="my-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-300"
        >
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInlineSegments(item)}</li>
          ))}
        </ul>
      );
    }
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    if (trimmed.startsWith('### ')) {
      flushList();
      blocks.push(
        <h4
          key={`h4-${blockKey++}`}
          className="mt-6 mb-2 font-display text-base font-semibold text-cyan-200"
        >
          {renderInlineSegments(trimmed.slice(4))}
        </h4>
      );
      continue;
    }

    if (trimmed.startsWith('## ')) {
      flushList();
      blocks.push(
        <h3
          key={`h3-${blockKey++}`}
          className="mt-8 mb-3 border-b border-slate-800/80 pb-2 font-display text-xl font-bold text-white"
        >
          {renderInlineSegments(trimmed.slice(3))}
        </h3>
      );
      continue;
    }

    if (trimmed.startsWith('# ')) {
      flushList();
      blocks.push(
        <h2
          key={`h2-${blockKey++}`}
          className="mt-6 mb-3 font-display text-2xl font-bold text-white"
        >
          {renderInlineSegments(trimmed.slice(2))}
        </h2>
      );
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (unorderedMatch) {
      if (listItems.length > 0 && listOrdered) flushList();
      listOrdered = false;
      listItems.push(unorderedMatch[1]);
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      if (listItems.length > 0 && !listOrdered) flushList();
      listOrdered = true;
      listItems.push(orderedMatch[1]);
      continue;
    }

    flushList();
    blocks.push(
      <p key={`p-${blockKey++}`} className="my-2.5 text-sm leading-relaxed text-slate-300">
        {renderInlineSegments(trimmed)}
      </p>
    );
  }

  flushList();

  return <div className="space-y-1">{blocks}</div>;
}
