import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { apiCronograma, apiGrafo } from '../api';
import { arestasDoCaminho, getPreRequisitosTransitivos } from '../lib/grafo';
import {
  calcularLayout,
  posicaoParaNovoBloco,
  semPosicao,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_MOSTRAR_NOMES,
  ZOOM_MOSTRAR_ROTULOS_ARESTA,
  ZOOM_PADRAO,
  LARGURA_NO,
  ALTURA_NO,
  type ArestaDoGrafo,
  type BlocoDoGrafo,
} from '../lib/layoutGrafo';
import { cn } from '../util';
import {
  Confirmacao,
  IconeAcademico,
  IconeBusca,
  IconeEstrela,
  Carregando,
} from './ui';

/**
 * Mapa dos blocos.
 *
 * Uma tela contínua: o que aparece depende só de onde você está e de quanto
 * zoom deu. O layout é calculado uma vez e gravado — o mapa não se reorganiza
 * sozinho, porque lembrar onde as coisas estão é metade da utilidade dele.
 *
 * Arrastar um nó move o bloco e nada mais: relações continuam sendo editadas
 * só pelo modal.
 */

/** Chave em `config` onde fica o último enquadramento do mapa. */
const CHAVE_ENQUADRAMENTO = 'grafo_enquadramento';
/** Espera antes de gravar o enquadramento, para não escrever a cada pixel. */
const ESPERA_GRAVAR_MS = 600;

type Filtro = 'todos' | 'favoritos' | 'ocultos';

interface DadosNo extends Record<string, unknown> {
  bloco: BlocoDoGrafo;
  mostrarNome: boolean;
  selecionado: boolean;
  esmaecido: boolean;
  realcado: boolean;
  /** Oculto que está sendo mostrado: contorno tracejado. */
  comoOculto: boolean;
  aoAbrir: (id: string) => void;
}

// ===========================================================================
// Nó
// ===========================================================================
function NoBloco({ data }: NodeProps<Node<DadosNo>>) {
  const { bloco, mostrarNome, selecionado, esmaecido, realcado, comoOculto, aoAbrir } = data;

  return (
    <div
      onDoubleClick={() => aoAbrir(bloco.id)}
      title={bloco.nome}
      className={cn(
        'flex items-center gap-1.5 rounded-lg border px-2.5 text-xs transition',
        'bg-white dark:bg-zinc-900',
        mostrarNome ? 'justify-start' : 'justify-center',
        comoOculto
          ? 'border-dashed border-zinc-400 opacity-50 dark:border-zinc-600'
          : 'border-zinc-300 dark:border-zinc-700',
        selecionado && 'border-indigo-500 ring-2 ring-indigo-500/40 dark:border-indigo-400',
        realcado && !selecionado && 'border-indigo-400 ring-1 ring-indigo-400/40',
        esmaecido && 'opacity-30'
      )}
      style={{ width: LARGURA_NO, height: ALTURA_NO }}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      {mostrarNome ? (
        <>
          {bloco.favorito === 1 && (
            <IconeEstrela className="h-3 w-3 shrink-0 text-amber-500" aria-label="Favorito" />
          )}
          <span className="min-w-0 flex-1 truncate">{bloco.nome}</span>
          {bloco.wrapper_academico === 1 && (
            <IconeAcademico className="h-3 w-3 shrink-0 text-zinc-400" aria-label="Disciplina" />
          )}
        </>
      ) : (
        // Longe demais para ler: o nó vira um ponto.
        <span className="h-2.5 w-2.5 rounded-full bg-zinc-400 dark:bg-zinc-500" />
      )}
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
}

const tiposDeNo = { bloco: NoBloco };

// ===========================================================================
// Legenda
// ===========================================================================
function Legenda({ mostrarRotulos }: { mostrarRotulos: boolean }) {
  const linha = (traco: string, cor: string, rotulo: string) => (
    <span key={rotulo} className="flex items-center gap-1.5">
      <svg width="22" height="8" aria-hidden="true">
        <line x1="1" y1="4" x2="21" y2="4" stroke={cor} strokeWidth="2" strokeDasharray={traco} />
      </svg>
      {rotulo}
    </span>
  );
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white/90 px-2.5 py-2 text-xs text-zinc-600 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90 dark:text-zinc-300">
      {linha('0', '#6366f1', 'é pré-requisito de')}
      {linha('5 3', '#0ea5e9', 'deriva de')}
      {linha('1 3', '#a855f7', 'funde para formar')}
      {!mostrarRotulos && (
        <span className="text-zinc-400 dark:text-zinc-500">Aproxime para ver os rótulos</span>
      )}
    </div>
  );
}

// ===========================================================================
// Mapa
// ===========================================================================
function Mapa({
  blocoEmFoco,
  aoAbrirBloco,
}: {
  blocoEmFoco: string | null;
  aoAbrirBloco: (id: string) => void;
}) {
  const fluxo = useReactFlow();
  const [blocos, setBlocos] = useState<BlocoDoGrafo[]>([]);
  const [relacoes, setRelacoes] = useState<ArestaDoGrafo[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [selecionado, setSelecionado] = useState<string | null>(blocoEmFoco);
  const [zoom, setZoom] = useState(ZOOM_PADRAO);
  const [caminhoLigado, setCaminhoLigado] = useState(false);
  const [mostrarOcultos, setMostrarOcultos] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busca, setBusca] = useState('');
  const [confirmandoReorganizar, setConfirmandoReorganizar] = useState(false);

  const enquadramentoSalvo = useRef<Viewport | null>(null);
  const jaEnquadrou = useRef(false);
  const timerGravar = useRef<number | null>(null);

  // --- carregamento e primeiro layout -------------------------------------
  const carregar = useCallback(async () => {
    const d = await apiGrafo.dados();
    let lista = d.blocos;

    const novos = semPosicao(lista);
    if (novos.length > 0) {
      // Primeiro mapa: calcula tudo. Depois disso, só o bloco novo ganha lugar,
      // sem mover nenhum dos que já estão.
      const primeiraVez = novos.length === lista.length;
      const posicoes = primeiraVez
        ? calcularLayout(lista, d.relacoes)
        : novos.map((b) => ({ id: b.id, ...posicaoParaNovoBloco(b.id, lista, d.relacoes) }));

      await apiGrafo.salvarPosicoes(posicoes);
      const porId = new Map(posicoes.map((p) => [p.id, p]));
      lista = lista.map((b) =>
        porId.has(b.id) ? { ...b, pos_x: porId.get(b.id)!.pos_x, pos_y: porId.get(b.id)!.pos_y } : b
      );
    }

    setBlocos(lista);
    setRelacoes(d.relacoes);
    try {
      const bruto = d.config?.[CHAVE_ENQUADRAMENTO];
      enquadramentoSalvo.current = bruto ? JSON.parse(bruto) : null;
    } catch {
      enquadramentoSalvo.current = null;
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // --- enquadramento -------------------------------------------------------
  const centralizarEm = useCallback(
    (id: string) => {
      const b = blocos.find((x) => x.id === id);
      if (!b || b.pos_x === null || b.pos_y === null) return;
      void fluxo.setCenter(b.pos_x + LARGURA_NO / 2, b.pos_y + ALTURA_NO / 2, {
        zoom: ZOOM_PADRAO,
        duration: 300,
      });
    },
    [blocos, fluxo]
  );

  useEffect(() => {
    if (carregando || blocos.length === 0 || jaEnquadrou.current) return;
    jaEnquadrou.current = true;

    if (blocoEmFoco) {
      // Aberto a partir de um bloco: centraliza nele, no zoom de leitura.
      // Quem mais aparece depende só da distância no mapa.
      centralizarEm(blocoEmFoco);
      return;
    }
    if (enquadramentoSalvo.current) {
      void fluxo.setViewport(enquadramentoSalvo.current);
      return;
    }
    const ultimo = [...blocos]
      .filter((b) => b.ultimo_acesso)
      .sort((a, b) => String(b.ultimo_acesso).localeCompare(String(a.ultimo_acesso)))[0];
    if (ultimo) centralizarEm(ultimo.id);
  }, [carregando, blocos, blocoEmFoco, centralizarEm, fluxo]);

  /** Guarda o enquadramento para a próxima abertura a partir das pastas. */
  const gravarEnquadramento = useCallback((v: Viewport) => {
    if (timerGravar.current) window.clearTimeout(timerGravar.current);
    timerGravar.current = window.setTimeout(() => {
      void apiCronograma.salvarConfig({ [CHAVE_ENQUADRAMENTO]: JSON.stringify(v) });
    }, ESPERA_GRAVAR_MS);
  }, []);

  const centralizar = () => {
    const alvo =
      selecionado ??
      blocoEmFoco ??
      [...blocos]
        .filter((b) => b.ultimo_acesso)
        .sort((a, b) => String(b.ultimo_acesso).localeCompare(String(a.ultimo_acesso)))[0]?.id;
    if (alvo) centralizarEm(alvo);
  };

  // --- caminho de pré-requisitos ------------------------------------------
  const caminho = useMemo(() => {
    if (!caminhoLigado || !selecionado) return null;
    const nos = getPreRequisitosTransitivos(selecionado, relacoes);
    nos.add(selecionado);
    return { nos, arestas: arestasDoCaminho(selecionado, relacoes) };
  }, [caminhoLigado, selecionado, relacoes]);

  // --- nós e arestas -------------------------------------------------------
  const mostrarNomes = zoom >= ZOOM_MOSTRAR_NOMES;
  const mostrarRotulos = zoom >= ZOOM_MOSTRAR_ROTULOS_ARESTA;

  const visiveis = useMemo(() => {
    return blocos.filter((b) => {
      if (b.oculto !== 1) return true;
      // Oculto aparece quando pedido, ou quando a cadeia de pré-requisitos
      // passa por ele — senão o caminho apareceria partido.
      if (mostrarOcultos || filtro === 'ocultos') return true;
      return Boolean(caminho?.nos.has(b.id));
    });
  }, [blocos, mostrarOcultos, filtro, caminho]);

  const esmaecer = useCallback(
    (b: BlocoDoGrafo) => {
      if (filtro === 'favoritos' && b.favorito !== 1) return true;
      if (filtro === 'ocultos' && b.oculto !== 1) return true;
      if (caminho && !caminho.nos.has(b.id)) return true;
      return false;
    },
    [filtro, caminho]
  );

  const nos: Node<DadosNo>[] = useMemo(
    () =>
      visiveis.map((b) => ({
        id: b.id,
        type: 'bloco',
        position: { x: b.pos_x ?? 0, y: b.pos_y ?? 0 },
        data: {
          bloco: b,
          mostrarNome: mostrarNomes,
          selecionado: selecionado === b.id,
          esmaecido: esmaecer(b),
          realcado: Boolean(caminho?.nos.has(b.id)),
          comoOculto: b.oculto === 1,
          aoAbrir: aoAbrirBloco,
        },
        draggable: true,
      })),
    [visiveis, mostrarNomes, selecionado, esmaecer, caminho, aoAbrirBloco]
  );

  const arestas: Edge[] = useMemo(() => {
    const idsVisiveis = new Set(visiveis.map((b) => b.id));
    return relacoes
      .filter((r) => idsVisiveis.has(r.bloco_origem_id) && idsVisiveis.has(r.bloco_destino_id))
      .map((r) => {
        const noCaminho = Boolean(caminho?.arestas.has(r.id));
        const esmaecida = Boolean(caminho) && !noCaminho;
        const base =
          r.tipo === 'pre_requisito'
            ? { cor: '#6366f1', traco: undefined, rotulo: 'é pré-requisito de' }
            : r.tipo === 'deriva_de'
              ? { cor: '#0ea5e9', traco: '5 3', rotulo: 'deriva de' }
              : { cor: '#a855f7', traco: '1 3', rotulo: 'funde para formar' };

        // A aresta é desenhada na direção da dependência: "deriva de" está
        // gravada ao contrário, então é invertida aqui.
        const [de, para] =
          r.tipo === 'deriva_de'
            ? [r.bloco_destino_id, r.bloco_origem_id]
            : [r.bloco_origem_id, r.bloco_destino_id];

        return {
          id: r.id,
          source: de,
          target: para,
          label: mostrarRotulos ? base.rotulo : undefined,
          labelStyle: { fontSize: 10, fill: base.cor },
          labelBgStyle: { fillOpacity: 0.85 },
          markerEnd: { type: MarkerType.ArrowClosed, color: base.cor, width: 14, height: 14 },
          style: {
            stroke: base.cor,
            strokeWidth: r.tipo === 'fusao_com' ? 2.5 : noCaminho ? 2.5 : 1.5,
            strokeDasharray: base.traco,
            opacity: esmaecida ? 0.2 : 1,
          },
        } satisfies Edge;
      });
  }, [relacoes, visiveis, caminho, mostrarRotulos]);

  // --- interações ----------------------------------------------------------
  const reorganizar = async () => {
    const posicoes = calcularLayout(blocos, relacoes);
    await apiGrafo.salvarPosicoes(posicoes);
    const porId = new Map(posicoes.map((p) => [p.id, p]));
    setBlocos((atuais) =>
      atuais.map((b) => ({ ...b, pos_x: porId.get(b.id)!.pos_x, pos_y: porId.get(b.id)!.pos_y }))
    );
    setConfirmandoReorganizar(false);
  };

  const resultadosBusca = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return [];
    return blocos.filter((b) => b.nome.toLowerCase().includes(termo)).slice(0, 6);
  }, [busca, blocos]);

  const favoritos = useMemo(() => blocos.filter((b) => b.favorito === 1), [blocos]);

  if (carregando) {
    return (
      <div className="flex h-full items-center justify-center">
        <Carregando />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {/* Barra de ações */}
      <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
        <div className="relative">
          <IconeBusca className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            className="campo w-52 py-1.5 pl-8 text-sm"
            placeholder="Buscar bloco…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            aria-label="Buscar bloco no mapa"
          />
          {resultadosBusca.length > 0 && (
            <div className="cartao absolute left-0 top-full mt-1 w-full divide-y divide-zinc-200 overflow-hidden dark:divide-zinc-800">
              {resultadosBusca.map((b) => (
                <button
                  key={b.id}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  onClick={() => {
                    setSelecionado(b.id);
                    centralizarEm(b.id);
                    setBusca('');
                  }}
                >
                  {b.nome}
                </button>
              ))}
            </div>
          )}
        </div>

        <button className="btn-secundario py-1.5" onClick={centralizar}>
          Centralizar
        </button>

        <select
          className="campo w-auto py-1.5 text-sm"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value as Filtro)}
          aria-label="Filtrar blocos"
        >
          <option value="todos">Todos</option>
          <option value="favoritos">Só favoritos</option>
          <option value="ocultos">Só ocultos</option>
        </select>

        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-indigo-600"
            checked={mostrarOcultos}
            onChange={(e) => setMostrarOcultos(e.target.checked)}
          />
          Mostrar ocultos
        </label>

        <label
          className={cn(
            'flex items-center gap-1.5 text-xs',
            selecionado
              ? 'cursor-pointer text-zinc-600 dark:text-zinc-300'
              : 'cursor-not-allowed text-zinc-400 dark:text-zinc-600'
          )}
          title={selecionado ? undefined : 'Selecione um bloco para ver o caminho'}
        >
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-indigo-600"
            checked={caminhoLigado}
            disabled={!selecionado}
            onChange={(e) => setCaminhoLigado(e.target.checked)}
          />
          Caminho de pré-requisitos
        </label>

        <button
          className="btn-sutil px-2 py-1 text-xs"
          onClick={() => setConfirmandoReorganizar(true)}
        >
          Reorganizar mapa
        </button>
      </div>

      {/* Favoritos: atalho fixo dentro do mapa */}
      {favoritos.length > 0 && (
        <aside
          aria-label="Favoritos"
          className="absolute right-3 top-3 z-10 max-h-64 w-44 overflow-y-auto rounded-lg border border-zinc-200 bg-white/90 p-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90"
        >
          <p className="mb-1 px-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">Favoritos</p>
          {favoritos.map((b) => (
            <button
              key={b.id}
              className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
              onClick={() => {
                setSelecionado(b.id);
                centralizarEm(b.id);
              }}
            >
              <IconeEstrela className="h-3 w-3 shrink-0 text-amber-500" />
              <span className="truncate">{b.nome}</span>
            </button>
          ))}
        </aside>
      )}

      {/* Destaque do bloco selecionado */}
      {selecionado && (
        <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2 rounded-lg border border-zinc-200 bg-white/90 px-3 py-2 text-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
          <span className="max-w-48 truncate font-medium">
            {blocos.find((b) => b.id === selecionado)?.nome}
          </span>
          <button className="btn-secundario py-1" onClick={() => aoAbrirBloco(selecionado)}>
            Abrir
          </button>
        </div>
      )}

      <Legenda mostrarRotulos={mostrarRotulos} />

      <ReactFlow
        nodes={nos}
        edges={arestas}
        nodeTypes={tiposDeNo}
        minZoom={ZOOM_MIN}
        maxZoom={ZOOM_MAX}
        // Arrastar um nó nunca cria relação: o mapa não conecta nada.
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        onMove={(_, v) => {
          setZoom(v.zoom);
          gravarEnquadramento(v);
        }}
        onNodeClick={(_, no) => setSelecionado(no.id)}
        onPaneClick={() => setSelecionado(null)}
        onNodeDragStop={(_, no) => {
          setBlocos((atuais) =>
            atuais.map((b) => (b.id === no.id ? { ...b, pos_x: no.position.x, pos_y: no.position.y } : b))
          );
          void apiGrafo.mover(no.id, no.position.x, no.position.y);
        }}
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>

      <Confirmacao
        aberto={confirmandoReorganizar}
        titulo="Reorganizar o mapa?"
        mensagem="Todos os blocos voltam para as posições calculadas. As posições que você ajustou à mão são perdidas."
        rotuloConfirmar="Reorganizar"
        aoConfirmar={() => void reorganizar()}
        aoCancelar={() => setConfirmandoReorganizar(false)}
      />
    </div>
  );
}

export function GrafoBlocos({
  blocoEmFoco = null,
  aoAbrirBloco,
}: {
  blocoEmFoco?: string | null;
  aoAbrirBloco: (id: string) => void;
}) {
  return (
    <ReactFlowProvider>
      <Mapa blocoEmFoco={blocoEmFoco} aoAbrirBloco={aoAbrirBloco} />
    </ReactFlowProvider>
  );
}
