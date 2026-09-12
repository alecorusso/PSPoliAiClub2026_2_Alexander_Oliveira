import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { Bloco, LinhaEditor, Relacao, TipoRelacao, Topico } from '../tipos';
import { cn, linhasParaPayload, topicosParaLinhas } from '../util';
import { EditorTabelaConteudos } from './EditorTabelaConteudos';
import { Aviso, Carregando, IconeBusca, IconeLink, IconeLixeira, Modal, Vazio } from './ui';

type Aba = 'relacoes' | 'tabela';

const TIPOS: { valor: TipoRelacao; rotulo: string }[] = [
  { valor: 'pre_requisito', rotulo: 'é pré-requisito de' },
  { valor: 'deriva_de', rotulo: 'deriva de' },
  { valor: 'fusao_com', rotulo: 'é fusão de' },
];

/** O rótulo muda conforme a perspectiva: a aresta é gravada uma única vez. */
function rotuloRelacao(r: Relacao) {
  if (r.tipo === 'fusao_com') return 'é fusão com';
  if (r.tipo === 'pre_requisito') return r.perspectiva === 'origem' ? 'é pré-requisito de' : 'depende de';
  return r.perspectiva === 'origem' ? 'deriva de' : 'dá origem a';
}

export function ModalConfiguracoes({
  bloco,
  aberto,
  abaInicial = 'relacoes',
  aoFechar,
  aoSalvarTabela,
}: {
  bloco: Bloco;
  aberto: boolean;
  abaInicial?: Aba;
  aoFechar: () => void;
  aoSalvarTabela: () => void;
}) {
  const [aba, setAba] = useState<Aba>(abaInicial);

  useEffect(() => {
    if (aberto) setAba(abaInicial);
  }, [aberto, abaInicial]);

  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo={`Configurações · ${bloco.nome}`} largura="max-w-3xl">
      <div className="mb-4 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {(
          [
            ['relacoes', 'Relações'],
            ['tabela', 'Tabela de conteúdos'],
          ] as [Aba, string][]
        ).map(([valor, rotulo]) => (
          <button
            key={valor}
            onClick={() => setAba(valor)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition',
              aba === valor
                ? 'border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300'
                : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
            )}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {aba === 'relacoes' ? (
        <AbaRelacoes bloco={bloco} />
      ) : (
        <AbaTabela bloco={bloco} aoSalvar={aoSalvarTabela} />
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Aba: relações entre blocos
// ---------------------------------------------------------------------------
function AbaRelacoes({ bloco }: { bloco: Bloco }) {
  const [relacoes, setRelacoes] = useState<Relacao[]>([]);
  const [todos, setTodos] = useState<Bloco[]>([]);
  const [busca, setBusca] = useState('');
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoRelacao>('pre_requisito');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    const [r, b] = await Promise.all([api.listarRelacoes(bloco.id), api.listarBlocos()]);
    setRelacoes(r);
    setTodos(b.filter((x) => x.id !== bloco.id));
    setCarregando(false);
  }, [bloco.id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const resultados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return [];
    return todos.filter((b) => b.nome.toLowerCase().includes(termo)).slice(0, 6);
  }, [busca, todos]);

  const nomeSelecionado = todos.find((b) => b.id === selecionado)?.nome ?? '';

  const adicionar = async () => {
    if (!selecionado) return;
    setErro(null);
    try {
      await api.criarRelacao(bloco.id, { bloco_destino_id: selecionado, tipo });
      setSelecionado(null);
      setBusca('');
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  const remover = async (id: string) => {
    await api.excluirRelacao(id);
    await carregar();
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label className="rotulo">Adicionar relação</label>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{bloco.nome}</span>
          <select
            className="campo w-44"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoRelacao)}
          >
            {TIPOS.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.rotulo}
              </option>
            ))}
          </select>
          <span className="text-zinc-500 dark:text-zinc-400">…</span>
        </div>

        <div className="relative">
          <IconeBusca className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            className="campo pl-9"
            placeholder="Buscar bloco pelo nome…"
            value={selecionado ? nomeSelecionado : busca}
            onChange={(e) => {
              setSelecionado(null);
              setBusca(e.target.value);
            }}
          />
        </div>

        {!selecionado && resultados.length > 0 && (
          <div className="cartao divide-y divide-zinc-200 overflow-hidden dark:divide-zinc-800">
            {resultados.map((b) => (
              <button
                key={b.id}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => setSelecionado(b.id)}
              >
                {b.nome}
              </button>
            ))}
          </div>
        )}

        {erro && <Aviso tom="atencao">{erro}</Aviso>}

        <button className="btn-primario" onClick={() => void adicionar()} disabled={!selecionado}>
          Adicionar relação
        </button>
      </div>

      <div>
        <label className="rotulo">Relações existentes</label>
        {carregando ? (
          <Carregando />
        ) : relacoes.length === 0 ? (
          <Vazio
            icone={<IconeLink className="h-7 w-7" />}
            titulo="Nenhuma relação"
            descricao="Relacione este bloco a outros para registrar dependências e derivações."
          />
        ) : (
          <ul className="cartao divide-y divide-zinc-200 overflow-hidden dark:divide-zinc-800">
            {relacoes.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <IconeLink className="h-4 w-4 shrink-0 text-zinc-400" />
                <span className="min-w-0 flex-1">
                  <span className="text-zinc-500 dark:text-zinc-400">{rotuloRelacao(r)} </span>
                  <span className="font-medium">{r.outro_nome}</span>
                </span>
                <button
                  className="btn-perigo px-2 py-1"
                  onClick={() => void remover(r.id)}
                  aria-label="Remover relação"
                  title="Remover relação"
                >
                  <IconeLixeira />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba: editor da tabela de conteúdos
// ---------------------------------------------------------------------------
function AbaTabela({ bloco, aoSalvar }: { bloco: Bloco; aoSalvar: () => void }) {
  const [linhas, setLinhas] = useState<LinhaEditor[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);

  useEffect(() => {
    api
      .listarTopicos(bloco.id)
      .then((t: Topico[]) => setLinhas(topicosParaLinhas(t)))
      .finally(() => setCarregando(false));
  }, [bloco.id]);

  const salvar = async () => {
    setSalvando(true);
    setMensagem(null);
    try {
      const uteis = linhas.filter((l) => l.titulo.trim());
      const salvos = await api.salvarTopicos(bloco.id, linhasParaPayload(uteis), true);
      setLinhas(topicosParaLinhas(salvos));
      setMensagem('Tabela de conteúdos salva.');
      aoSalvar();
    } catch (e) {
      setMensagem((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  if (carregando) return <Carregando />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Editar um tópico preserva os checks, revisões e evidências já registrados. Tópicos removidos
        aqui levam junto seu histórico.
      </p>
      <div className="max-h-[50vh] overflow-y-auto pr-1">
        <EditorTabelaConteudos linhas={linhas} aoMudar={setLinhas} />
      </div>
      <div className="flex items-center justify-between gap-3">
        {mensagem ? (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">{mensagem}</span>
        ) : (
          <span />
        )}
        <button className="btn-primario" onClick={() => void salvar()} disabled={salvando}>
          Salvar tabela
        </button>
      </div>
    </div>
  );
}
