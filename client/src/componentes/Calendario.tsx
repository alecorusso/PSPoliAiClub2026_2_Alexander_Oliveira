import { useMemo, useState } from 'react';
import {
  agruparPorData,
  DIAS_DA_SEMANA,
  grade,
  navegar,
  rotuloDoPeriodo,
  type ItemCalendario,
  type TipoItemCalendario,
  type Visao,
} from '../lib/calendario';
import { cn } from '../util';
import { IconeEsquerda, IconeDireita } from './ui';

/**
 * Grade do calendário.
 *
 * Aqui NÃO existe arraste: mudar a data de um item é decisão consciente, feita
 * pelo modal. Quem arrasta é o cronograma, ao lado, e por isso as duas áreas são
 * visualmente separadas — o mesmo gesto não pode significar coisas diferentes
 * sem que se veja a fronteira.
 */

/** Quantos itens cabem num dia antes de virar "+N". */
const MAX_POR_DIA = 3;

export const TIPOS: Record<
  TipoItemCalendario,
  { rotulo: string; ponto: string; pilula: string }
> = {
  evento: {
    rotulo: 'Evento',
    ponto: 'bg-zinc-400 dark:bg-zinc-500',
    pilula: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
  },
  avaliacao: {
    rotulo: 'Avaliação',
    ponto: 'bg-rose-500',
    pilula: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200',
  },
  entregavel: {
    rotulo: 'Entregável',
    ponto: 'bg-indigo-500',
    pilula: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-200',
  },
  lista: {
    rotulo: 'Lista de questões',
    ponto: 'bg-amber-500',
    pilula: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  },
  revisao: {
    rotulo: 'Revisão',
    ponto: 'bg-emerald-500',
    pilula: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
  },
};

export function Legenda() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-zinc-500 dark:text-zinc-400">
      {Object.entries(TIPOS).map(([tipo, t]) => (
        <span key={tipo} className="flex items-center gap-1.5">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', t.ponto)} />
          {t.rotulo}
        </span>
      ))}
    </div>
  );
}

export function Calendario({
  itens,
  hoje,
  visao,
  aoMudarVisao,
  ancora,
  aoMudarAncora,
  diaSelecionado,
  aoEscolherDia,
  aoAbrirItem,
  datasDestacadas,
  itemDestacado,
  vinculadosDestacados,
  aoPassarNoItem,
}: {
  itens: ItemCalendario[];
  hoje: string;
  visao: Visao;
  aoMudarVisao: (v: Visao) => void;
  ancora: string;
  aoMudarAncora: (d: string) => void;
  diaSelecionado: string | null;
  /** Dia vazio abre o novo evento; dia com itens filtra o cronograma. Decide a página. */
  aoEscolherDia: (d: string) => void;
  aoAbrirItem: (i: ItemCalendario) => void;
  /** Datas realçadas por causa do cronograma ao lado. Só realce, nunca reordena. */
  datasDestacadas?: Set<string>;
  itemDestacado?: string | null;
  /** Chaves "tipo:id" realçadas por vínculo com o item em foco. */
  vinculadosDestacados?: Set<string>;
  aoPassarNoItem?: (i: ItemCalendario | null) => void;
}) {
  const [diaExpandido, setDiaExpandido] = useState<string | null>(null);

  const semanas = useMemo(() => grade(visao, ancora), [visao, ancora]);
  const porData = useMemo(() => agruparPorData(itens), [itens]);

  const chave = (i: ItemCalendario) => `${i.tipo}:${i.id}`;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* Barra de navegação */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
          {(['mes', 'semana'] as Visao[]).map((v) => (
            <button
              key={v}
              className={cn(
                'rounded-md px-3 py-1 text-sm transition',
                visao === v
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
              )}
              onClick={() => aoMudarVisao(v)}
              aria-pressed={visao === v}
            >
              {v === 'mes' ? 'Mês' : 'Semana'}
            </button>
          ))}
        </div>

        <button
          className="btn-secundario px-2 py-1.5"
          onClick={() => aoMudarAncora(navegar(visao, ancora, -1))}
          aria-label="Período anterior"
        >
          <IconeEsquerda className="h-4 w-4" />
        </button>
        <button
          className="btn-secundario px-2 py-1.5"
          onClick={() => aoMudarAncora(navegar(visao, ancora, 1))}
          aria-label="Próximo período"
        >
          <IconeDireita className="h-4 w-4" />
        </button>
        <button className="btn-secundario py-1.5" onClick={() => aoMudarAncora(hoje)}>
          Hoje
        </button>

        <span className="text-sm font-medium first-letter:uppercase">{rotuloDoPeriodo(visao, ancora)}</span>
      </div>

      {/* Grade */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
          {DIAS_DA_SEMANA.map((d) => (
            <div key={d} className="px-2 py-1.5 text-center text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {d}
            </div>
          ))}
        </div>

        {semanas.map((semana) => (
          <div key={semana[0].data} className="grid grid-cols-7 border-b border-zinc-200 last:border-0 dark:border-zinc-800">
            {semana.map((dia) => {
              const doDia = porData.get(dia.data) ?? [];
              const expandido = diaExpandido === dia.data;
              const visiveis = expandido ? doDia : doDia.slice(0, MAX_POR_DIA);
              const escondidos = doDia.length - visiveis.length;
              const ehHoje = dia.data === hoje;

              return (
                // A célula inteira é o alvo de clique do dia: dia vazio abre o
                // novo evento, dia com itens filtra o cronograma ao lado.
                <div
                  key={dia.data}
                  role="button"
                  tabIndex={0}
                  aria-label={`Dia ${dia.data}`}
                  onClick={() => aoEscolherDia(dia.data)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      aoEscolherDia(dia.data);
                    }
                  }}
                  className={cn(
                    'min-h-24 cursor-pointer border-r border-zinc-200 p-1 text-left transition last:border-0 dark:border-zinc-800',
                    'hover:bg-zinc-50 dark:hover:bg-zinc-800/40',
                    visao === 'semana' && 'min-h-64',
                    dia.foraDoPeriodo && 'bg-zinc-50/60 dark:bg-zinc-900/40',
                    diaSelecionado === dia.data && 'bg-indigo-50 dark:bg-indigo-500/10',
                    datasDestacadas?.has(dia.data) && 'ring-2 ring-inset ring-indigo-400 dark:ring-indigo-500'
                  )}
                >
                  <div className="mb-1 px-1 py-0.5">
                    <span
                      className={cn(
                        'text-xs',
                        dia.foraDoPeriodo ? 'text-zinc-400 dark:text-zinc-600' : 'text-zinc-600 dark:text-zinc-300',
                        ehHoje &&
                          'flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900'
                      )}
                    >
                      {Number(dia.data.slice(8))}
                    </span>
                  </div>

                  <div className="space-y-0.5">
                    {visiveis.map((item) => (
                      <button
                        key={chave(item)}
                        onClick={(e) => {
                          e.stopPropagation();
                          aoAbrirItem(item);
                        }}
                        onMouseEnter={() => aoPassarNoItem?.(item)}
                        onMouseLeave={() => aoPassarNoItem?.(null)}
                        title={`${TIPOS[item.tipo].rotulo}: ${item.titulo}`}
                        className={cn(
                          'block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] leading-tight transition hover:brightness-95',
                          TIPOS[item.tipo].pilula,
                          item.concluido === 1 && 'line-through opacity-60',
                          itemDestacado === chave(item) && 'ring-2 ring-zinc-900 dark:ring-zinc-100',
                          // Realce do vínculo: a avaliação e o que a realiza.
                          vinculadosDestacados?.has(chave(item)) &&
                            itemDestacado !== chave(item) &&
                            'ring-2 ring-indigo-400 dark:ring-indigo-500'
                        )}
                      >
                        {item.titulo}
                      </button>
                    ))}

                    {escondidos > 0 && (
                      <button
                        className="w-full rounded px-1.5 py-0.5 text-left text-[11px] text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDiaExpandido(dia.data);
                        }}
                      >
                        +{escondidos}
                      </button>
                    )}
                    {expandido && doDia.length > MAX_POR_DIA && (
                      <button
                        className="w-full rounded px-1.5 py-0.5 text-left text-[11px] text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDiaExpandido(null);
                        }}
                      >
                        Recolher
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <Legenda />
    </div>
  );
}
