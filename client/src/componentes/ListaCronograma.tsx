import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { api, apiAvaliacoes, apiEntregaveis, apiListas } from '../api';
import { usarCronograma } from '../estado/usarCronograma';
import { HORIZONTE_DIAS, magnitudeDoArraste, type Grupo, type ItemCronograma } from '../lib/cronograma';
import { cn, formatarData, hojeISO } from '../util';
import { CampoOrcamento, LinhaCronograma, NOME_CLASSE } from './Cronograma';
import { Aviso, Carregando, IconeArrastar, IconeChevron, IconeX, Modal } from './ui';

/**
 * Cronograma completo: uma lista só, agrupada por proximidade.
 *
 * A ordem vem do cálculo, nunca de uma nota exibida. "Reagendar" apenas move a
 * data — não é atraso, não é falha, não fica registrado como tal.
 *
 * Arrastar um item não reordena a lista na marra: grava a intenção e a fila é
 * remontada com ela aplicada. Se um fato novo pesar mais, o cálculo vence.
 *
 * Vive na coluna direita do Calendário. O arraste só existe aqui: no calendário
 * ao lado, mudar data é decisão consciente, feita pelo modal.
 */

const GRUPOS: { id: Grupo; titulo: string; recolhido: boolean }[] = [
  { id: 'hoje', titulo: 'Hoje', recolhido: false },
  { id: 'semana', titulo: 'Esta semana', recolhido: false },
  { id: 'depois', titulo: 'Depois', recolhido: false },
  { id: 'alem_horizonte', titulo: 'Além do horizonte', recolhido: true },
];

export interface LigacaoCalendario {
  /** Mostra só os itens com prazo neste dia. Vem de um clique no calendário. */
  filtroData: string | null;
  aoLimparFiltroData: () => void;
  /** Chave "tipo:id" do item a realçar. Só realce: nunca reordena nem repriorza. */
  itemDestacado: string | null;
  /** Passar o mouse num item realça a data dele no calendário. */
  aoPassarNoItem: (item: ItemCronograma | null) => void;
  /** Clicar leva o calendário até a data do item. */
  aoEscolherItem: (item: ItemCronograma) => void;
}

export function ListaCronograma({
  versao,
  aoMudar,
  ligacao,
}: {
  /** Muda quando o calendário grava algo, para a fila ser remontada. */
  versao?: number;
  /** Avisa o calendário de que a fila mexeu em algum registro. */
  aoMudar?: () => void;
  ligacao?: LigacaoCalendario;
}) {
  const { fila, orcamentoMin, carregando, erro, recarregar, salvarOrcamento, ajustar, restaurar } =
    usarCronograma();
  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const refLista = useRef<HTMLDivElement | null>(null);

  // O calendário mexeu em algum registro: a fila é remontada.
  const primeiraVersao = useRef(versao);
  useEffect(() => {
    if (versao !== undefined && versao !== primeiraVersao.current) void recarregar();
  }, [versao, recarregar]);

  // Item escolhido no calendário: realça e rola até ele, sem mexer na ordem.
  useEffect(() => {
    const alvo = ligacao?.itemDestacado;
    if (!alvo || !refLista.current) return;
    const el = refLista.current.querySelector(`[data-item="${alvo}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [ligacao?.itemDestacado]);
  const [bloco, setBloco] = useState('');
  const [modo, setModo] = useState('');
  const [recolhidos, setRecolhidos] = useState<Record<string, boolean>>(
    () => Object.fromEntries(GRUPOS.map((g) => [g.id, g.recolhido]))
  );
  const [reagendando, setReagendando] = useState<ItemCronograma | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [falha, setFalha] = useState<string | null>(null);

  const blocos = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const i of fila) mapa.set(i.blocoId, i.blocoNome);
    return [...mapa].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [fila]);

  const filtrada = useMemo(
    () =>
      fila.filter(
        (i) =>
          (!bloco || i.blocoId === bloco) &&
          (!modo || i.classe === modo) &&
          (!ligacao?.filtroData || i.prazo === ligacao.filtroData)
      ),
    [fila, bloco, modo, ligacao?.filtroData]
  );

  const concluir = async (item: ItemCronograma) => {
    setOcupado(item.id);
    setFalha(null);
    try {
      if (item.tipo === 'entregavel') await apiEntregaveis.concluir(item.id, true);
      else if (item.tipo === 'lista') await apiListas.atualizar(item.id, { status: 'completa' });
      else if (item.tipo === 'revisao') await api.concluirRevisao(item.id);
      // Na fila só há avaliações sem nota: concluir marca que ela foi
      // realizada. A nota é registrada à parte, no painel Acadêmico.
      else await apiAvaliacoes.marcarRealizada(item.id, true);
      await recarregar();
      aoMudar?.();
    } catch (e) {
      setFalha((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const reagendar = async (item: ItemCronograma, data: string) => {
    setOcupado(item.id);
    setFalha(null);
    try {
      if (item.tipo === 'entregavel') await apiEntregaveis.reagendar(item.id, data);
      else if (item.tipo === 'lista') await apiListas.atualizar(item.id, { data_prevista: data });
      else if (item.tipo === 'avaliacao') await apiAvaliacoes.reagendar(item.id, data);
      else await api.reagendarRevisao(item.id, data);
      await recarregar();
      aoMudar?.();
    } catch (e) {
      setFalha((e as Error).message);
    } finally {
      setOcupado(null);
      setReagendando(null);
    }
  };

  /** O usuário nunca vê nem digita a magnitude: ela vem do próprio arraste. */
  const aoSoltar = async (ev: DragEndEvent) => {
    const de = filtrada.findIndex((i) => chave(i) === ev.active.id);
    const para = filtrada.findIndex((i) => chave(i) === ev.over?.id);
    if (de < 0 || para < 0 || de === para) return;

    setFalha(null);
    try {
      await ajustar(
        filtrada[de],
        para < de ? 'promover' : 'rebaixar',
        magnitudeDoArraste(de, para)
      );
    } catch (e) {
      setFalha((e as Error).message);
    }
  };

  if (carregando) {
    return (
      <div className="px-6 py-6">
        <Carregando />
      </div>
    );
  }

  return (
    <div ref={refLista} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Cronograma
        </h2>
        <div className="ml-auto">
          <CampoOrcamento minutos={orcamentoMin} aoMudar={(m) => void salvarOrcamento(m)} />
        </div>
      </div>

      {/* Filtro vindo de um clique no calendário. Some com um clique. */}
      {ligacao?.filtroData && (
        <div className="flex items-center gap-2 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-200">
          <span>Mostrando o prazo de {formatarData(ligacao.filtroData)}</span>
          <button
            className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-indigo-100 dark:hover:bg-indigo-500/20"
            onClick={ligacao.aoLimparFiltroData}
          >
            <IconeX className="h-3 w-3" />
            Limpar
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="campo w-auto py-1.5 text-sm"
          value={bloco}
          onChange={(e) => setBloco(e.target.value)}
          aria-label="Filtrar por bloco"
        >
          <option value="">Todos os blocos</option>
          {blocos.map(([id, nome]) => (
            <option key={id} value={id}>
              {nome}
            </option>
          ))}
        </select>
        <select
          className="campo w-auto py-1.5 text-sm"
          value={modo}
          onChange={(e) => setModo(e.target.value)}
          aria-label="Filtrar por modo"
        >
          <option value="">Todos os modos</option>
          {Object.entries(NOME_CLASSE).map(([id, nome]) => (
            <option key={id} value={id}>
              {nome}
            </option>
          ))}
        </select>
      </div>

      {(erro || falha) && <Aviso tom="atencao">{erro ?? falha}</Aviso>}

      <DndContext sensors={sensores} onDragEnd={(ev) => void aoSoltar(ev)}>
      {filtrada.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {ligacao?.filtroData
            ? 'Nenhum item com prazo neste dia.'
            : 'Itens com prazo ou tempo estimado aparecem aqui.'}
        </p>
      ) : (
        GRUPOS.map((g) => {
          const itens = filtrada.filter((i) => i.grupo === g.id);
          if (itens.length === 0) return null;
          const fechado = recolhidos[g.id];
          return (
            <section key={g.id}>
              <button
                className="mb-2 flex w-full items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                onClick={() => setRecolhidos((r) => ({ ...r, [g.id]: !r[g.id] }))}
                aria-expanded={!fechado}
              >
                <IconeChevron
                  className={'h-3.5 w-3.5 transition ' + (fechado ? '' : 'rotate-90')}
                />
                {g.titulo}
                <span className="font-normal normal-case">({itens.length})</span>
                {g.id === 'alem_horizonte' && (
                  <span className="ml-1 font-normal normal-case text-zinc-400 dark:text-zinc-500">
                    mais de {HORIZONTE_DIAS} dias
                  </span>
                )}
              </button>

              {!fechado && (
                <ul className="cartao divide-y divide-zinc-200 px-4 dark:divide-zinc-800">
                  {itens.map((item) => (
                    <ItemArrastavel
                      key={chave(item)}
                      item={item}
                      destacado={ligacao?.itemDestacado === chave(item)}
                      ligacao={ligacao}
                      aoRestaurar={() => void restaurar(item)}
                      acoes={
                        <>
                          <button
                            className="btn-sutil px-2 py-1 text-xs"
                            onClick={() => void concluir(item)}
                            disabled={ocupado === item.id}
                            title={
                              item.tipo === 'avaliacao'
                                ? 'Marca a avaliação como realizada. A nota é registrada à parte.'
                                : undefined
                            }
                          >
                            Concluir
                          </button>
                          {item.tipo === 'avaliacao' && (
                            // A nota é dado acadêmico: só o usuário registra, no bloco.
                            <Link className="btn-sutil px-2 py-1 text-xs" to={`/blocos/${item.blocoId}`}>
                              Registrar nota
                            </Link>
                          )}
                          <button
                            className="btn-sutil px-2 py-1 text-xs"
                            onClick={() => setReagendando(item)}
                            disabled={ocupado === item.id}
                          >
                            Reagendar
                          </button>
                        </>
                      }
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}
      </DndContext>

      <ModalReagendar item={reagendando} aoFechar={() => setReagendando(null)} aoSalvar={reagendar} />
    </div>
  );
}

const chave = (i: ItemCronograma) => `${i.tipo}:${i.id}`;

/** Linha da fila que pode ser arrastada para cima ou para baixo. */
function ItemArrastavel({
  item,
  acoes,
  aoRestaurar,
  destacado,
  ligacao,
}: {
  item: ItemCronograma;
  acoes: React.ReactNode;
  aoRestaurar: () => void;
  destacado?: boolean;
  ligacao?: LigacaoCalendario;
}) {
  const id = chave(item);
  const { setNodeRef: refArraste, listeners, isDragging } = useDraggable({ id });
  const { setNodeRef: refSolta, isOver } = useDroppable({ id });

  const referencia = (no: HTMLElement | null) => {
    refArraste(no);
    refSolta(no);
  };

  return (
    <LinhaCronograma
      ref={referencia}
      item={item}
      acoes={acoes}
      aoRestaurar={aoRestaurar}
      data-item={id}
      // Realce visual: nunca reordena nem altera a prioridade.
      onMouseEnter={() => ligacao?.aoPassarNoItem(item)}
      onMouseLeave={() => ligacao?.aoPassarNoItem(null)}
      onClick={() => ligacao?.aoEscolherItem(item)}
      className={cn(
        'transition',
        isDragging && 'opacity-40',
        isOver && 'bg-indigo-50/60 dark:bg-indigo-500/10',
        destacado && 'rounded-lg ring-2 ring-zinc-900 dark:ring-zinc-100'
      )}
      alca={
        <span
          {...listeners}
          role="button"
          tabIndex={-1}
          aria-label={`Mudar a posição de ${item.titulo}`}
          title="Arraste para cima ou para baixo"
          className="-ml-1 cursor-grab text-zinc-300 transition hover:text-zinc-500 active:cursor-grabbing dark:text-zinc-600 dark:hover:text-zinc-400"
        >
          <IconeArrastar className="h-4 w-4" />
        </span>
      }
    />
  );
}

function ModalReagendar({
  item,
  aoFechar,
  aoSalvar,
}: {
  item: ItemCronograma | null;
  aoFechar: () => void;
  aoSalvar: (item: ItemCronograma, data: string) => Promise<void>;
}) {
  const [data, setData] = useState(hojeISO());

  return (
    <Modal
      aberto={Boolean(item)}
      aoFechar={aoFechar}
      titulo="Reagendar"
      descricao="Mover a data não conta como atraso."
      largura="max-w-sm"
    >
      <label className="rotulo">Nova data</label>
      <input
        className="campo"
        type="date"
        value={data}
        onChange={(e) => setData(e.target.value)}
        aria-label="Nova data"
      />
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secundario" onClick={aoFechar}>
          Cancelar
        </button>
        <button className="btn-primario" onClick={() => item && void aoSalvar(item, data)}>
          Reagendar
        </button>
      </div>
    </Modal>
  );
}
