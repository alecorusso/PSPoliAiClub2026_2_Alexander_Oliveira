import { useEffect, type ReactNode } from 'react';
import { cn, CORES_NATUREZA, ROTULO_NATUREZA } from '../util';
import type { Natureza } from '../tipos';

// ---------------------------------------------------------------------------
// Ícones (SVG inline — sem dependência externa)
// ---------------------------------------------------------------------------
type PropsIcone = { className?: string };
const svg = (d: ReactNode, extra?: Record<string, string>) =>
  function Icone({ className = 'h-4 w-4' }: PropsIcone) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
        {...extra}
      >
        {d}
      </svg>
    );
  };

export const IconeCasa = svg(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>);
export const IconeBlocos = svg(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>);
export const IconeCalendario = svg(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>);
export const IconeGrafico = svg(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>);
export const IconePasta = svg(<><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></>);
export const IconeBloco = svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 9h8M8 13h8M8 17h5" /></>);
export const IconeMais = svg(<><path d="M12 5v14M5 12h14" /></>);
export const IconeEstrela = svg(<><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8Z" /></>);
export const IconeOlhoCortado = svg(<><path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.4 5.3A9.6 9.6 0 0 1 12 5c5 0 9 4.5 9 7 0 .9-.7 2.2-1.9 3.4M6.3 6.8C4.2 8.2 3 10.1 3 12c0 2.5 4 7 9 7 1.3 0 2.5-.3 3.6-.8" /></>);
export const IconeOlho = svg(<><path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z" /><circle cx="12" cy="12" r="2.6" /></>);
export const IconeLapis = svg(<><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" /></>);
export const IconeLixeira = svg(<><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></>);
export const IconeMover = svg(<><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M12 11v6M9 14l3-3 3 3" /></>);
export const IconeEngrenagem = svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1.7a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 3.4 7.5a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H8a1.6 1.6 0 0 0 1-1.5V1.7a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1 1.6 1.6 0 0 0 .4-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V8a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></>);
export const IconeX = svg(<><path d="M18 6 6 18M6 6l12 12" /></>);
export const IconeBusca = svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const IconeCima = svg(<><path d="M12 19V5M5 12l7-7 7 7" /></>);
export const IconeBaixo = svg(<><path d="M12 5v14M19 12l-7 7-7-7" /></>);
export const IconeEsquerda = svg(<><path d="M19 12H5M12 19l-7-7 7-7" /></>);
export const IconeDireita = svg(<><path d="M5 12h14M12 5l7 7-7 7" /></>);
export const IconeChevron = svg(<><path d="m9 6 6 6-6 6" /></>);
export const IconeUpload = svg(<><path d="M12 16V4M8 8l4-4 4 4" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>);
export const IconeLista = svg(<><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></>);
export const IconeBussola = svg(<><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5Z" /></>);
export const IconeConversa = svg(<><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /></>);
export const IconeCheck = svg(<><path d="m5 13 4 4L19 7" /></>);
export const IconeRelogio = svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const IconeSol = svg(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const IconeLua = svg(<><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></>);
export const IconeMinimizar = svg(<><path d="M5 18h14" /></>);
export const IconeExpandir = svg(<><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" /></>);
export const IconeLink = svg(<><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>);

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
export function Modal({
  aberto,
  aoFechar,
  titulo,
  descricao,
  children,
  largura = 'max-w-lg',
}: {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  descricao?: string;
  children: ReactNode;
  largura?: string;
}) {
  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar();
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [aberto, aoFechar]);

  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-950/40 p-4 py-10 backdrop-blur-[2px]">
      <div
        className={cn('cartao surgir w-full shadow-xl', largura)}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-semibold">{titulo}</h2>
            {descricao && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{descricao}</p>}
          </div>
          <button className="btn-sutil -mr-2 -mt-1 px-2" onClick={aoFechar} aria-label="Fechar">
            <IconeX />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Confirmacao({
  aberto,
  titulo,
  mensagem,
  rotuloConfirmar = 'Confirmar',
  perigo = false,
  aoConfirmar,
  aoCancelar,
}: {
  aberto: boolean;
  titulo: string;
  mensagem: string;
  rotuloConfirmar?: string;
  perigo?: boolean;
  aoConfirmar: () => void;
  aoCancelar: () => void;
}) {
  return (
    <Modal aberto={aberto} aoFechar={aoCancelar} titulo={titulo} largura="max-w-md">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{mensagem}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secundario" onClick={aoCancelar}>
          Cancelar
        </button>
        <button
          className={perigo ? 'btn bg-red-600 text-white hover:bg-red-500' : 'btn-primario'}
          onClick={aoConfirmar}
        >
          {rotuloConfirmar}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Etiquetas
// ---------------------------------------------------------------------------
export function TagNatureza({ natureza, className }: { natureza: Natureza; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        CORES_NATUREZA[natureza],
        className
      )}
    >
      {ROTULO_NATUREZA[natureza]}
    </span>
  );
}

export function Etiqueta({
  children,
  className,
  tom = 'neutro',
}: {
  children: ReactNode;
  className?: string;
  tom?: 'neutro' | 'atencao';
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
        tom === 'atencao'
          ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
          : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
        className
      )}
    >
      {children}
    </span>
  );
}

export function Vazio({ icone, titulo, descricao, acao }: { icone?: ReactNode; titulo: string; descricao?: string; acao?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 px-6 py-12 text-center dark:border-zinc-800">
      {icone && <div className="mb-3 text-zinc-400 dark:text-zinc-600">{icone}</div>}
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{titulo}</p>
      {descricao && <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-500">{descricao}</p>}
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  );
}

export function Aviso({ children, tom = 'neutro' }: { children: ReactNode; tom?: 'neutro' | 'atencao' }) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2 text-sm',
        tom === 'atencao'
          ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
          : 'border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300'
      )}
    >
      {children}
    </div>
  );
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-300 border-t-indigo-500 dark:border-zinc-700 dark:border-t-indigo-400" />
      {texto}
    </div>
  );
}
