import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { Bloco, Pasta } from '../tipos';
import { cn, formatarData } from '../util';
import { MenuContexto, type ItemMenu } from '../componentes/MenuContexto';
import {
  Carregando,
  Confirmacao,
  Etiqueta,
  IconeBloco,
  IconeBusca,
  IconeChevron,
  IconeEstrela,
  IconeLapis,
  IconeLixeira,
  IconeMais,
  IconeMover,
  IconeOlho,
  IconeOlhoCortado,
  IconePasta,
  Modal,
  Vazio,
} from '../componentes/ui';

type Filtro = 'todos' | 'favoritos' | 'ocultos';
type Alvo = { tipo: 'pasta'; dado: Pasta } | { tipo: 'bloco'; dado: Bloco };

/** A própria pasta e todas as suas descendentes — destinos proibidos ao movê-la. */
function descendentesDe(pastas: Pasta[], pastaId: string) {
  const proibidos = new Set<string>([pastaId]);
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const p of pastas) {
      if (p.pasta_pai_id && proibidos.has(p.pasta_pai_id) && !proibidos.has(p.id)) {
        proibidos.add(p.id);
        mudou = true;
      }
    }
  }
  return proibidos;
}

/**
 * Sob o ponteiro, uma pasta sempre vence a área do nível atual — as duas zonas
 * se sobrepõem, e sem isso o alvo ficaria ambíguo.
 */
const deteccaoDeColisao: CollisionDetection = (args) => {
  const sob = pointerWithin(args);
  const pasta = sob.find((c) => String(c.id).startsWith('pasta-'));
  return pasta ? [pasta] : sob.filter((c) => c.id === 'nivel-atual');
};

export function PaginaBlocos() {
  const navegar = useNavigate();
  const [pastas, setPastas] = useState<Pasta[]>([]);
  const [blocos, setBlocos] = useState<Bloco[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [pastaAtual, setPastaAtual] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');

  const [menuNovo, setMenuNovo] = useState<{ x: number; y: number } | null>(null);
  const [modalBloco, setModalBloco] = useState(false);
  const [modalPasta, setModalPasta] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; alvo: Alvo } | null>(null);
  const [renomeando, setRenomeando] = useState<Alvo | null>(null);
  const [moverAlvo, setMoverAlvo] = useState<Alvo | null>(null);
  const [excluindo, setExcluindo] = useState<Alvo | null>(null);

  const carregar = useCallback(async () => {
    const [p, b] = await Promise.all([api.listarPastas(), api.listarBlocos()]);
    setPastas(p);
    setBlocos(b);
    setCarregando(false);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Caminho da pasta atual, para o breadcrumb.
  const trilha = useMemo(() => {
    const caminho: Pasta[] = [];
    let cursor = pastaAtual;
    while (cursor) {
      const p = pastas.find((x) => x.id === cursor);
      if (!p) break;
      caminho.unshift(p);
      cursor = p.pasta_pai_id;
    }
    return caminho;
  }, [pastaAtual, pastas]);

  const nomeDaPasta = useCallback(
    (id: string | null) => (id ? (pastas.find((p) => p.id === id)?.nome ?? '—') : 'Início'),
    [pastas]
  );

  const buscando = busca.trim().length > 0;

  const visivel = useCallback(
    (item: { favorito: number; oculto: number }) => {
      if (filtro === 'favoritos') return item.favorito === 1;
      if (filtro === 'ocultos') return item.oculto === 1;
      return item.oculto === 0;
    },
    [filtro]
  );

  // Busca por nome: global quando há termo, senão apenas a pasta atual.
  const { pastasVisiveis, blocosVisiveis } = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const casa = (nome: string) => nome.toLowerCase().includes(termo);

    if (buscando) {
      return {
        pastasVisiveis: pastas.filter((p) => visivel(p) && casa(p.nome)),
        blocosVisiveis: blocos.filter((b) => visivel(b) && casa(b.nome)),
      };
    }
    return {
      pastasVisiveis: pastas.filter((p) => p.pasta_pai_id === pastaAtual && visivel(p)),
      blocosVisiveis: blocos.filter((b) => b.pasta_id === pastaAtual && visivel(b)),
    };
  }, [busca, buscando, pastas, blocos, pastaAtual, visivel]);

  const vazio = pastasVisiveis.length === 0 && blocosVisiveis.length === 0;

  // --- ações do menu de contexto ---
  const alternarFavorito = async (alvo: Alvo) => {
    const novo = alvo.dado.favorito === 1 ? 0 : 1;
    if (alvo.tipo === 'pasta') await api.atualizarPasta(alvo.dado.id, { favorito: novo });
    else await api.atualizarBloco(alvo.dado.id, { favorito: novo });
    await carregar();
  };

  // Ocultar uma pasta esconde seu conteúdo na visualização, mas não altera
  // a flag "oculto" individual dos blocos dentro dela.
  const alternarOculto = async (alvo: Alvo) => {
    const novo = alvo.dado.oculto === 1 ? 0 : 1;
    if (alvo.tipo === 'pasta') await api.atualizarPasta(alvo.dado.id, { oculto: novo });
    else await api.atualizarBloco(alvo.dado.id, { oculto: novo });
    await carregar();
  };

  const confirmarExclusao = async () => {
    if (!excluindo) return;
    if (excluindo.tipo === 'pasta') await api.excluirPasta(excluindo.dado.id);
    else await api.excluirBloco(excluindo.dado.id);
    setExcluindo(null);
    await carregar();
  };

  const itensMenu = (alvo: Alvo): ItemMenu[] => [
    {
      rotulo: alvo.dado.favorito === 1 ? 'Remover dos favoritos' : 'Favoritar',
      icone: <IconeEstrela />,
      aoClicar: () => void alternarFavorito(alvo),
    },
    {
      rotulo: alvo.dado.oculto === 1 ? 'Mostrar' : 'Ocultar',
      icone: alvo.dado.oculto === 1 ? <IconeOlho /> : <IconeOlhoCortado />,
      aoClicar: () => void alternarOculto(alvo),
    },
    { rotulo: 'Renomear', icone: <IconeLapis />, aoClicar: () => setRenomeando(alvo) },
    { rotulo: 'Mover para…', icone: <IconeMover />, aoClicar: () => setMoverAlvo(alvo) },
    { rotulo: 'Excluir', icone: <IconeLixeira />, perigo: true, aoClicar: () => setExcluindo(alvo) },
  ];

  const abrirMenu = (e: React.MouseEvent, alvo: Alvo) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, alvo });
  };

  // --- arrastar e soltar ---------------------------------------------------
  // O menu de contexto continua sendo o caminho equivalente, e é por ele que a
  // movimentação funciona pelo teclado.
  const [arrastando, setArrastando] = useState<Alvo | null>(null);

  // Pequena distância antes de virar arraste, para o clique simples continuar
  // abrindo o item.
  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const proibidos = useMemo(
    () => (arrastando?.tipo === 'pasta' ? descendentesDe(pastas, arrastando.dado.id) : new Set<string>()),
    [arrastando, pastas]
  );

  const aoIniciarArraste = ({ active }: DragStartEvent) => {
    const id = String(active.id);
    if (id.startsWith('pasta-')) {
      const pasta = pastas.find((x) => x.id === id.slice(6));
      if (pasta) setArrastando({ tipo: 'pasta', dado: pasta });
    } else {
      const bloco = blocos.find((x) => x.id === id.slice(6));
      if (bloco) setArrastando({ tipo: 'bloco', dado: bloco });
    }
  };

  const aoSoltar = async ({ active, over }: DragEndEvent) => {
    const alvo = arrastando;
    setArrastando(null);
    if (!alvo || !over) return;

    const idAtivo = String(active.id);
    // Soltar em área vazia move para o nível atual do breadcrumb.
    const destino = over.id === 'nivel-atual' ? pastaAtual : String(over.id).slice(6);
    if (destino === idAtivo.slice(6)) return;

    const atual = alvo.tipo === 'pasta' ? alvo.dado.pasta_pai_id : alvo.dado.pasta_id;
    if (atual === destino) return;
    // Uma pasta nunca entra em si mesma nem numa descendente.
    if (alvo.tipo === 'pasta' && destino !== null && descendentesDe(pastas, alvo.dado.id).has(destino)) return;

    if (alvo.tipo === 'pasta') await api.atualizarPasta(alvo.dado.id, { pasta_pai_id: destino });
    else await api.atualizarBloco(alvo.dado.id, { pasta_id: destino });
    await carregar();
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      {/* Cabeçalho */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Blocos</h1>
          <nav className="mt-1 flex flex-wrap items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400">
            <button
              className={cn('rounded px-1.5 py-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-800', !pastaAtual && 'font-medium text-zinc-800 dark:text-zinc-200')}
              onClick={() => setPastaAtual(null)}
            >
              Todos os blocos
            </button>
            {trilha.map((p) => (
              <span key={p.id} className="flex items-center gap-1">
                <IconeChevron className="h-3 w-3" />
                <button
                  className={cn(
                    'rounded px-1.5 py-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-800',
                    p.id === pastaAtual && 'font-medium text-zinc-800 dark:text-zinc-200'
                  )}
                  onClick={() => setPastaAtual(p.id)}
                >
                  {p.nome}
                </button>
              </span>
            ))}
          </nav>
        </div>

        {/* Botão "+" com duas opções */}
        <div className="relative">
          <button
            className="btn-primario"
            onClick={(e) => {
              e.stopPropagation();
              const caixa = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setMenuNovo(menuNovo ? null : { x: caixa.right - 192, y: caixa.bottom + 6 });
            }}
          >
            <IconeMais />
            Novo
          </button>
          {menuNovo && (
            <MenuContexto
              x={menuNovo.x}
              y={menuNovo.y}
              aoFechar={() => setMenuNovo(null)}
              itens={[
                { rotulo: 'Novo bloco', icone: <IconeBloco />, aoClicar: () => setModalBloco(true) },
                { rotulo: 'Nova pasta', icone: <IconePasta />, aoClicar: () => setModalPasta(true) },
              ]}
            />
          )}
        </div>
      </div>

      {/* Busca e filtros */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <IconeBusca className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            className="campo pl-9"
            placeholder="Buscar por nome…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <div className="flex rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700">
          {(
            [
              ['todos', 'Todos'],
              ['favoritos', 'Só favoritos'],
              ['ocultos', 'Só ocultos'],
            ] as [Filtro, string][]
          ).map(([valor, rotulo]) => (
            <button
              key={valor}
              onClick={() => setFiltro(valor)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition',
                filtro === valor
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
              )}
            >
              {rotulo}
            </button>
          ))}
        </div>
      </div>

      {buscando && (
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          Buscando em todas as pastas. Limpe a busca para voltar à navegação por pastas.
        </p>
      )}

      {/* Grade de cards quadrados */}
      {carregando ? (
        <Carregando />
      ) : vazio ? (
        <Vazio
          icone={<IconeBloco className="h-8 w-8" />}
          titulo={buscando ? 'Nenhum resultado' : 'Esta pasta está vazia'}
          descricao={
            buscando
              ? 'Nenhum bloco ou pasta com esse nome.'
              : 'Crie um bloco para começar, ou uma pasta para organizar.'
          }
          acao={
            !buscando && (
              <div className="flex gap-2">
                <button className="btn-primario" onClick={() => setModalBloco(true)}>
                  Novo bloco
                </button>
                <button className="btn-secundario" onClick={() => setModalPasta(true)}>
                  Nova pasta
                </button>
              </div>
            )
          }
        />
      ) : (
        <DndContext
          sensors={sensores}
          collisionDetection={deteccaoDeColisao}
          onDragStart={aoIniciarArraste}
          onDragEnd={(e) => void aoSoltar(e)}
          onDragCancel={() => setArrastando(null)}
        >
          <AreaDoNivel>
          {pastasVisiveis.map((p) => (
            <Card
              key={p.id}
              id={`pasta-${p.id}`}
              pasta
              proibido={proibidos.has(p.id)}
              nome={p.nome}
              favorito={p.favorito === 1}
              oculto={p.oculto === 1}
              legenda={buscando ? `em ${nomeDaPasta(p.pasta_pai_id)}` : 'Pasta'}
              icone={<IconePasta className="h-7 w-7" />}
              aoAbrir={() => {
                setBusca('');
                setPastaAtual(p.id);
              }}
              aoMenu={(e) => abrirMenu(e, { tipo: 'pasta', dado: p })}
            />
          ))}
          {blocosVisiveis.map((b) => (
            <Card
              key={b.id}
              id={`bloco-${b.id}`}
              nome={b.nome}
              favorito={b.favorito === 1}
              oculto={b.oculto === 1}
              legenda={
                buscando
                  ? `em ${nomeDaPasta(b.pasta_id)}`
                  : b.ultimo_acesso
                    ? `Acesso em ${formatarData(b.ultimo_acesso)}`
                    : 'Sem acesso ainda'
              }
              etiqueta={b.wrapper_academico === 1 ? 'Disciplina' : undefined}
              icone={<IconeBloco className="h-7 w-7" />}
              aoAbrir={() => navegar(`/blocos/${b.id}`)}
              aoMenu={(e) => abrirMenu(e, { tipo: 'bloco', dado: b })}
            />
          ))}
          </AreaDoNivel>

          {/* Prévia que acompanha o cursor durante o arraste. */}
          <DragOverlay dropAnimation={null}>
            {arrastando && (
              <div className="cartao flex w-40 items-center gap-2 p-3 shadow-xl">
                {arrastando.tipo === 'pasta' ? (
                  <IconePasta className="h-5 w-5 shrink-0 text-zinc-400" />
                ) : (
                  <IconeBloco className="h-5 w-5 shrink-0 text-zinc-400" />
                )}
                <span className="truncate text-sm font-medium">{arrastando.dado.nome}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {menu && (
        <MenuContexto x={menu.x} y={menu.y} itens={itensMenu(menu.alvo)} aoFechar={() => setMenu(null)} />
      )}

      <ModalNovoBloco
        aberto={modalBloco}
        pastaId={pastaAtual}
        aoFechar={() => setModalBloco(false)}
        aoCriar={carregar}
      />
      <ModalNovaPasta
        aberto={modalPasta}
        pastaPaiId={pastaAtual}
        aoFechar={() => setModalPasta(false)}
        aoCriar={carregar}
      />
      <ModalRenomear alvo={renomeando} aoFechar={() => setRenomeando(null)} aoSalvar={carregar} />
      <ModalMover
        alvo={moverAlvo}
        pastas={pastas}
        aoFechar={() => setMoverAlvo(null)}
        aoSalvar={carregar}
      />
      <Confirmacao
        aberto={Boolean(excluindo)}
        titulo={`Excluir ${excluindo?.tipo === 'pasta' ? 'pasta' : 'bloco'}`}
        mensagem={
          excluindo?.tipo === 'pasta'
            ? `"${excluindo.dado.nome}" e suas subpastas serão excluídas. Os blocos que estavam dentro voltam para a raiz — nenhum bloco é apagado.`
            : `"${excluindo?.dado.nome}" será excluído com sua tabela de conteúdos, revisões, evidências e conversas. Esta ação não pode ser desfeita.`
        }
        rotuloConfirmar="Excluir"
        perigo
        aoConfirmar={() => void confirmarExclusao()}
        aoCancelar={() => setExcluindo(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Área do nível atual: soltar aqui move o item para a pasta do breadcrumb.
// ---------------------------------------------------------------------------
function AreaDoNivel({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'nivel-atual' });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'grid min-h-40 grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 rounded-xl p-1 transition',
        isOver && 'bg-zinc-200/50 dark:bg-zinc-800/40'
      )}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card quadrado — arrastável; pastas também recebem outros itens.
// ---------------------------------------------------------------------------
function Card({
  id,
  nome,
  legenda,
  etiqueta,
  icone,
  favorito,
  oculto,
  pasta,
  proibido,
  aoAbrir,
  aoMenu,
}: {
  id: string;
  nome: string;
  legenda: string;
  etiqueta?: string;
  icone: React.ReactNode;
  favorito: boolean;
  oculto: boolean;
  /** Só pastas recebem itens soltos. */
  pasta?: boolean;
  /** A própria pasta arrastada e suas descendentes não podem recebê-la. */
  proibido?: boolean;
  aoAbrir: () => void;
  aoMenu: (e: React.MouseEvent) => void;
}) {
  const { setNodeRef: refArraste, listeners, isDragging } = useDraggable({ id });
  const { setNodeRef: refSolta, isOver } = useDroppable({ id, disabled: !pasta || proibido });

  // A pasta é, ao mesmo tempo, origem de arraste e alvo de soltura.
  const referencia = (no: HTMLElement | null) => {
    refArraste(no);
    if (pasta) refSolta(no);
  };

  return (
    <div
      ref={referencia}
      {...listeners}
      onContextMenu={aoMenu}
      className={cn(
        'cartao group relative flex aspect-square cursor-grab flex-col justify-between p-3 text-left transition',
        'hover:border-indigo-400 hover:shadow-sm dark:hover:border-indigo-600',
        oculto && 'opacity-60',
        isDragging && 'opacity-40',
        // Destaque da pasta sob o cursor durante o arraste.
        isOver && 'border-indigo-500 ring-2 ring-indigo-500/40 dark:border-indigo-400'
      )}
    >
      <div className="flex items-start justify-between">
        <span className="text-zinc-400 dark:text-zinc-500">{icone}</span>
        <span className="flex items-center gap-1">
          {favorito && <IconeEstrela className="h-3.5 w-3.5 text-amber-500" />}
          {oculto && <IconeOlhoCortado className="h-3.5 w-3.5 text-zinc-400" />}
          <button
            type="button"
            aria-label={`Abrir menu de ${nome}`}
            onClick={aoMenu}
            className="rounded px-1.5 text-lg leading-none text-zinc-400 opacity-0 transition hover:bg-zinc-200 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-zinc-800"
          >
            ⋯
          </button>
        </span>
      </div>

      {/* Ação principal em um botão de verdade, para o teclado alcançar. */}
      <button type="button" onClick={aoAbrir} className="min-w-0 text-left">
        {etiqueta && <Etiqueta className="mb-1">{etiqueta}</Etiqueta>}
        <p className="line-clamp-2 text-sm font-medium leading-snug">{nome}</p>
        <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-500">{legenda}</p>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------------
function ModalNovoBloco({
  aberto,
  pastaId,
  aoFechar,
  aoCriar,
}: {
  aberto: boolean;
  pastaId: string | null;
  aoFechar: () => void;
  aoCriar: () => Promise<void>;
}) {
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [academico, setAcademico] = useState(false);
  const [limiteFaltas, setLimiteFaltas] = useState('');
  const [media, setMedia] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (aberto) {
      setNome('');
      setDescricao('');
      setAcademico(false);
      setLimiteFaltas('');
      setMedia('');
    }
  }, [aberto]);

  const salvar = async () => {
    if (!nome.trim()) return;
    setSalvando(true);
    try {
      await api.criarBloco({
        nome,
        descricao,
        pasta_id: pastaId,
        wrapper_academico: academico,
        limite_faltas: academico ? limiteFaltas : null,
        media_aprovacao: academico ? media : null,
      });
      await aoCriar();
      aoFechar();
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo="Novo bloco">
      <div className="space-y-4">
        <div>
          <label className="rotulo">Nome</label>
          <input className="campo" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="rotulo">Descrição</label>
          <textarea
            className="campo resize-none"
            rows={3}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
        </div>

        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
          <span className="text-sm font-medium">É uma disciplina cursada?</span>
          <span className="relative inline-flex">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={academico}
              onChange={(e) => setAcademico(e.target.checked)}
            />
            <span className="h-5 w-9 rounded-full bg-zinc-300 transition peer-checked:bg-indigo-600 dark:bg-zinc-700" />
            <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-4" />
          </span>
        </label>

        {academico && (
          <div className="surgir grid grid-cols-2 gap-3">
            <div>
              <label className="rotulo">Limite de faltas</label>
              <input
                className="campo"
                type="number"
                min={0}
                value={limiteFaltas}
                onChange={(e) => setLimiteFaltas(e.target.value)}
              />
            </div>
            <div>
              <label className="rotulo">Média para aprovação</label>
              <input
                className="campo"
                type="number"
                step="0.1"
                min={0}
                value={media}
                onChange={(e) => setMedia(e.target.value)}
              />
            </div>
            <p className="col-span-2 text-xs text-zinc-500 dark:text-zinc-400">
              Por enquanto estes valores são apenas armazenados — as ferramentas acadêmicas ainda
              não têm tela.
            </p>
          </div>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secundario" onClick={aoFechar}>
          Cancelar
        </button>
        <button className="btn-primario" onClick={() => void salvar()} disabled={!nome.trim() || salvando}>
          Criar bloco
        </button>
      </div>
    </Modal>
  );
}

function ModalNovaPasta({
  aberto,
  pastaPaiId,
  aoFechar,
  aoCriar,
}: {
  aberto: boolean;
  pastaPaiId: string | null;
  aoFechar: () => void;
  aoCriar: () => Promise<void>;
}) {
  const [nome, setNome] = useState('');
  useEffect(() => {
    if (aberto) setNome('');
  }, [aberto]);

  const salvar = async () => {
    if (!nome.trim()) return;
    await api.criarPasta({ nome, pasta_pai_id: pastaPaiId });
    await aoCriar();
    aoFechar();
  };

  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo="Nova pasta" largura="max-w-md">
      <label className="rotulo">Nome</label>
      <input
        className="campo"
        value={nome}
        autoFocus
        onChange={(e) => setNome(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void salvar()}
      />
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secundario" onClick={aoFechar}>
          Cancelar
        </button>
        <button className="btn-primario" onClick={() => void salvar()} disabled={!nome.trim()}>
          Criar pasta
        </button>
      </div>
    </Modal>
  );
}

function ModalRenomear({
  alvo,
  aoFechar,
  aoSalvar,
}: {
  alvo: Alvo | null;
  aoFechar: () => void;
  aoSalvar: () => Promise<void>;
}) {
  const [nome, setNome] = useState('');
  useEffect(() => {
    if (alvo) setNome(alvo.dado.nome);
  }, [alvo]);

  const salvar = async () => {
    if (!alvo || !nome.trim()) return;
    if (alvo.tipo === 'pasta') await api.atualizarPasta(alvo.dado.id, { nome });
    else await api.atualizarBloco(alvo.dado.id, { nome });
    await aoSalvar();
    aoFechar();
  };

  return (
    <Modal aberto={Boolean(alvo)} aoFechar={aoFechar} titulo="Renomear" largura="max-w-md">
      <label className="rotulo">Nome</label>
      <input
        className="campo"
        value={nome}
        autoFocus
        onChange={(e) => setNome(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void salvar()}
      />
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secundario" onClick={aoFechar}>
          Cancelar
        </button>
        <button className="btn-primario" onClick={() => void salvar()} disabled={!nome.trim()}>
          Salvar
        </button>
      </div>
    </Modal>
  );
}

/** "Mover para…" — a movimentação é por menu de contexto, não por arrastar. */
function ModalMover({
  alvo,
  pastas,
  aoFechar,
  aoSalvar,
}: {
  alvo: Alvo | null;
  pastas: Pasta[];
  aoFechar: () => void;
  aoSalvar: () => Promise<void>;
}) {
  const [destino, setDestino] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (alvo) {
      setDestino(alvo.tipo === 'pasta' ? alvo.dado.pasta_pai_id : alvo.dado.pasta_id);
      setErro(null);
    }
  }, [alvo]);

  // Uma pasta não pode ser movida para dentro de si mesma nem de suas descendentes.
  const descendentes = useMemo(
    () => (alvo?.tipo === 'pasta' ? descendentesDe(pastas, alvo.dado.id) : new Set<string>()),
    [alvo, pastas]
  );

  const opcoes = useMemo(() => {
    const caminho = (p: Pasta): string => {
      const pai = pastas.find((x) => x.id === p.pasta_pai_id);
      return pai ? `${caminho(pai)} / ${p.nome}` : p.nome;
    };
    return pastas
      .filter((p) => !descendentes.has(p.id))
      .map((p) => ({ id: p.id, rotulo: caminho(p) }))
      .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  }, [pastas, descendentes]);

  const salvar = async () => {
    if (!alvo) return;
    try {
      if (alvo.tipo === 'pasta') await api.atualizarPasta(alvo.dado.id, { pasta_pai_id: destino });
      else await api.atualizarBloco(alvo.dado.id, { pasta_id: destino });
      await aoSalvar();
      aoFechar();
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  return (
    <Modal
      aberto={Boolean(alvo)}
      aoFechar={aoFechar}
      titulo="Mover para…"
      descricao={alvo?.dado.nome}
      largura="max-w-md"
    >
      <div className="max-h-72 space-y-1 overflow-y-auto">
        <OpcaoDestino rotulo="Todos os blocos (raiz)" ativo={destino === null} aoClicar={() => setDestino(null)} />
        {opcoes.map((o) => (
          <OpcaoDestino key={o.id} rotulo={o.rotulo} ativo={destino === o.id} aoClicar={() => setDestino(o.id)} />
        ))}
      </div>
      {erro && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{erro}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secundario" onClick={aoFechar}>
          Cancelar
        </button>
        <button className="btn-primario" onClick={() => void salvar()}>
          Mover
        </button>
      </div>
    </Modal>
  );
}

function OpcaoDestino({ rotulo, ativo, aoClicar }: { rotulo: string; ativo: boolean; aoClicar: () => void }) {
  return (
    <button
      onClick={aoClicar}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition',
        ativo
          ? 'bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300'
          : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
      )}
    >
      <IconePasta className="h-4 w-4 shrink-0 text-zinc-400" />
      <span className="truncate">{rotulo}</span>
    </button>
  );
}
