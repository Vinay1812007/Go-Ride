// Code block with a Copy button. Slate background, mono font, copies clean.
import { useState } from 'react';
import { cn } from '@/lib/cn';

interface Props {
  code: string;
  language?: string;
  className?: string;
}

export default function CodeBlock({ code, language, className }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  }

  return (
    <div className={cn('relative group rounded-xl bg-surface-strong text-slate-100 overflow-hidden my-3', className)}>
      {language && (
        <div className="absolute top-0 right-0 text-[10px] uppercase tracking-wider px-2 py-1 bg-slate-800 text-slate-400 rounded-bl-md">
          {language}
        </div>
      )}
      <button
        type="button"
        onClick={copy}
        className={cn(
          'absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition',
          'text-[11px] px-2 py-1 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-100',
          language ? 'top-8' : '',
          copied ? 'opacity-100 bg-emerald-600 hover:bg-emerald-600' : '',
        )}
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
      <pre className="p-4 overflow-x-auto text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
