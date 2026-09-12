import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../util';

export interface ItemMenu {
  rotulo: string;
  icone?: ReactNode;
  perigo?: boolean;
  aoClicar: () => void;
}

/** Menu de contexto flutuante, aberto por clique direito ou pelo botão "⋯". */
export function MenuContexto({
  x,
  y,
  itens,
  aoFechar,
}: {
  x: number;
  y: number;
  itens: ItemMenu[];
  aoFechar: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Mantém o menu dentro da janela.
  useLayoutEffect(() => {
    const caixa = ref.current?.getBoundingClientRect();
    if (!caixa) return;
    setPos({
      x: Math.min(x, window.innerWidth - caixa.width - 8),
      y: Math.min(y, window.innerHeight - caixa.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const fechar = () => aoFechar();
    const aoTeclar = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar();
    window.addEventListener('click', fechar);
    window.addEventListener('resize', fechar);
    window.addEventListener('keydown', aoTeclar);
    return () => {
      window.removeEventListener('click', fechar);
      window.removeEventListener('resize', fechar);
      window.removeEventListener('keydown', aoTeclar);
    };
  }, [aoFechar]);

  return (
    <div
      ref={ref}
      className="cartao surgir fixed z-50 min-w-48 overflow-hidden py-1 shadow-xl"
      style={{ left: pos.x, top: pos.y }}
      onClick={(e) => e.stopPropagation()}
      role="menu"
    >
      {itens.map((item) => (
        <button
          key={item.rotulo}
          role="menuitem"
          className={cn(
            'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition',
            item.perigo
              ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40'
              : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800'
          )}
          onClick={() => {
            item.aoClicar();
            aoFechar();
          }}
        >
          <span className="text-zinc-400 dark:text-zinc-500">{item.icone}</span>
          {item.rotulo}
        </button>
      ))}
    </div>
  );
}
