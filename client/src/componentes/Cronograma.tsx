import { useEffect, useState, type ComponentProps, type ReactNode, type Ref } from 'react';
import { Link } from 'react-router-dom';
import { textoDuracao } from './CampoEstimativa';
import { Etiqueta } from './ui';
import { cn } from '../util';
import type { ClasseItem, ItemCronograma } from '../lib/cronograma';

/**
 * Peças compartilhadas pelas duas telas que mostram a fila: as sugestões do dia
 * no Início e o cronograma completo.
 *
 * A pontuação nunca aparece. O que o usuário lê é o motivo em texto.
 */

export const NOME_CLASSE: Record<ClasseItem, string> = {
  prova: 'Prova',
  projeto: 'Projeto',
  aprendizagem: 'Aprendizagem',
};

export const NOME_TIPO: Record<ItemCronograma['tipo'], string> = {
  entregavel: 'Entregável',
  lista: 'Lista de questões',
  avaliacao: 'Avaliação',
  revisao: 'Revisão',
};

/** Orçamento diário: um campo só, editável direto, sem perguntar a cada vez. */
export function CampoOrcamento({
  minutos,
  aoMudar,
}: {
  minutos: number;
  aoMudar: (m: number) => void;
}) {
  const [texto, setTexto] = useState(String(minutos));

  useEffect(() => setTexto(String(minutos)), [minutos]);

  const confirmar = () => {
    const n = Math.round(Number(texto));
    if (Number.isFinite(n) && n > 0) aoMudar(n);
    else setTexto(String(minutos));
  };

  return (
    <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
      Tempo para hoje
      <input
        className="campo w-20 py-1 text-sm"
        type="number"
        min={15}
        step={15}
        value={texto}
        aria-label="Tempo disponível hoje, em minutos"
        onChange={(e) => setTexto(e.target.value)}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      min
    </label>
  );
}

export function LinhaCronograma({
  item,
  acoes,
  aoRestaurar,
  className,
  alca,
  ref,
  ...resto
}: {
  item: ItemCronograma;
  acoes?: ReactNode;
  aoRestaurar?: () => void;
  className?: string;
  /** Alça de arraste, quando a tela permite reordenar. */
  alca?: ReactNode;
  ref?: Ref<HTMLLIElement>;
  /** Eventos e data-* que a tela precisa pendurar na linha (realce, ligação). */
} & Omit<ComponentProps<'li'>, 'ref' | 'className' | 'children'>) {
  return (
    <li
      ref={ref}
      className={cn('flex flex-wrap items-center gap-3 py-2.5', className)}
      {...resto}
    >
      {alca}
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-sm font-medium">{item.titulo}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <Link className="hover:underline" to={`/blocos/${item.blocoId}`}>
            {item.blocoNome}
          </Link>
          <Etiqueta>{NOME_CLASSE[item.classe]}</Etiqueta>
          {item.trabalhoRestanteMin > 0 && <span>{textoDuracao(item.trabalhoRestanteMin)}</span>}
          <span>·</span>
          <span>{item.motivo}</span>
        </p>

        {/* Notas discretas: texto pequeno, cor secundária, sem caixa nem alerta. */}
        {item.trabalhoRestanteMin > 0 && item.motivoCalibracao !== 'sem histórico suficiente' && (
          <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
            Tempo {item.motivoCalibracao}.
          </p>
        )}
        {item.ajusteExpirado && (
          <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
            Ajuste desfeito: o prazo está próximo.
          </p>
        )}
        {item.ajuste && !item.ajusteExpirado && aoRestaurar && (
          <button
            className="mt-0.5 text-xs text-zinc-400 underline-offset-2 hover:underline dark:text-zinc-500"
            onClick={aoRestaurar}
          >
            Restaurar posição calculada
          </button>
        )}
      </div>
      {acoes && (
        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">{acoes}</div>
      )}
    </li>
  );
}
