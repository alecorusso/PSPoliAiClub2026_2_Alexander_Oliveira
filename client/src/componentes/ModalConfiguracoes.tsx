import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { Bloco, Fusao, LinhaEditor, Relacao, TipoRelacao, Topico } from '../tipos';
import { cn, linhasParaPayload, topicosParaLinhas } from '../util';
import { EditorTabelaConteudos } from './EditorTabelaConteudos';
import { Aviso, Carregando, Confirmacao, IconeBusca, IconeLink, IconeLixeira, Modal, Vazio } from './ui';

type Aba = 'bloco' | 'relacoes' | 'tabela';

// A fusão não está aqui de propósito: ela é direcional e de duas ou mais
// origens, então tem seção própria, logo abaixo.
const TIPOS: { valor: TipoRelacao; rotulo: string }[] = [
  { valor: 'pre_requisito', rotulo: 'é pré-requisito de' },
  { valor: 'deriva_de', rotulo: 'deriva de' },
];

/** O rótulo muda conforme a perspectiva: a aresta é gravada uma única vez. */
function rotuloRelacao(r: Relacao) {
  if (r.tipo === 'pre_requisito') return r.perspectiva === 'origem' ? 'é pré-requisito de' : 'depende de';
  return r.perspectiva === 'origem' ? 'deriva de' : 'dá origem a';
}

const nomes = (lista: { nome: string }[]) => lista.map((o) => o.nome).join(' + ');

export function ModalConfiguracoes({
  bloco,
  aberto,
  abaInicial = 'bloco',
  aoFechar,
  aoSalvarTabela,
}: {
  bloco: Bloco;
  aberto: boolean;
  abaInicial?: Aba;
  aoFechar: () => void;
  /** Recarrega o bloco no pai — usada pela tabela e pelo contador de faltas. */
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
            ['bloco', 'Bloco'],
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

      {aba === 'bloco' ? (
        <AbaBloco bloco={bloco} aoSalvar={aoSalvarTabela} />
      ) : aba === 'relacoes' ? (
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
  const [fusao, setFusao] = useState<Fusao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    const [r, b, f] = await Promise.all([
      api.listarRelacoes(bloco.id),
      api.listarBlocos(),
      api.obterFusao(bloco.id),
    ]);
    // As arestas de fusão aparecem na seção própria, com os rótulos por
    // perspectiva; aqui ficariam soltas e sem sentido.
    setRelacoes(r.filter((x) => x.tipo !== 'fusao_com'));
    setTodos(b.filter((x) => x.id !== bloco.id));
    setFusao(f);
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

      <SecaoFusao bloco={bloco} fusao={fusao} todos={todos} aoMudar={() => void carregar()} />
    </div>
  );
}

/**
 * Fusão: um bloco RESULTADO é a fusão de DUAS OU MAIS ORIGENS.
 *
 * Não é uma relação entre dois blocos como as outras — por isso não está no
 * seletor de tipos acima. Os rótulos mudam conforme o lado: no resultado,
 * "é fusão de A + B"; em cada origem, "funde com B para formar C".
 */
function SecaoFusao({
  bloco,
  fusao,
  todos,
  aoMudar,
}: {
  bloco: Bloco;
  fusao: Fusao | null;
  todos: Bloco[];
  aoMudar: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [escolhidas, setEscolhidas] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmandoDesfazer, setConfirmandoDesfazer] = useState(false);

  const origens = fusao?.resultado?.origens ?? null;
  const ehResultado = origens !== null;

  const abrir = () => {
    setEscolhidas(origens?.map((o) => o.id) ?? []);
    setErro(null);
    setEditando(true);
  };

  const alternar = (id: string) =>
    setEscolhidas((atuais) =>
      atuais.includes(id) ? atuais.filter((x) => x !== id) : [...atuais, id]
    );

  const salvar = async () => {
    setErro(null);
    try {
      await api.salvarFusao(bloco.id, escolhidas);
      setEditando(false);
      aoMudar();
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  const desfazer = async () => {
    await api.desfazerFusao(bloco.id);
    setConfirmandoDesfazer(false);
    setEditando(false);
    aoMudar();
  };

  return (
    <div>
      <label className="rotulo">Fusão</label>

      {ehResultado && (
        <p className="mb-2 text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">É fusão de </span>
          <span className="font-medium">{nomes(origens)}</span>
        </p>
      )}

      {/* Perspectiva de quem é origem: o mesmo registro, lido do outro lado. */}
      {(fusao?.comoOrigem ?? []).map((f) => (
        <p key={f.resultado.id} className="mb-2 text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">
            {f.outras.length > 0 ? `Funde com ${nomes(f.outras)} para formar ` : 'Forma '}
          </span>
          <span className="font-medium">{f.resultado.nome}</span>
        </p>
      ))}

      {!editando ? (
        <div className="flex flex-wrap gap-2">
          <button className="btn-secundario" onClick={abrir}>
            {ehResultado ? 'Editar fusão' : 'É fusão de…'}
          </button>
          {ehResultado && (
            <button className="btn-sutil px-2 py-1 text-xs" onClick={() => setConfirmandoDesfazer(true)}>
              Desfazer fusão
            </button>
          )}
        </div>
      ) : (
        <div className="surgir space-y-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Escolha os blocos que se fundem para formar {bloco.nome}. São necessários pelo menos dois.
          </p>
          {todos.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Não há outros blocos.</p>
          ) : (
            <div className="max-h-48 space-y-0.5 overflow-y-auto">
              {todos.map((b) => (
                <label
                  key={b.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 shrink-0 accent-indigo-600"
                    checked={escolhidas.includes(b.id)}
                    onChange={() => alternar(b.id)}
                  />
                  <span className="truncate">{b.nome}</span>
                </label>
              ))}
            </div>
          )}

          {erro && <Aviso tom="atencao">{erro}</Aviso>}

          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn-primario"
              onClick={() => void salvar()}
              disabled={escolhidas.length < 2}
            >
              {ehResultado ? 'Salvar fusão' : 'Criar fusão'}
            </button>
            <button className="btn-secundario" onClick={() => setEditando(false)}>
              Cancelar
            </button>
            {/* Cair abaixo de duas origens desfaz a fusão: ela deixa de existir. */}
            {ehResultado && escolhidas.length < 2 && (
              <button className="btn-sutil px-2 py-1 text-xs" onClick={() => setConfirmandoDesfazer(true)}>
                Desfazer a fusão inteira
              </button>
            )}
          </div>
          {ehResultado && escolhidas.length < 2 && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Uma fusão precisa de pelo menos dois blocos de origem. Com menos que isso, ela deixa de
              existir.
            </p>
          )}
        </div>
      )}

      <Confirmacao
        aberto={confirmandoDesfazer}
        titulo="Desfazer a fusão?"
        mensagem={`${bloco.nome} deixa de ser registrado como fusão de outros blocos. Os blocos em si continuam como estão.`}
        rotuloConfirmar="Desfazer fusão"
        aoConfirmar={() => void desfazer()}
        aoCancelar={() => setConfirmandoDesfazer(false)}
      />
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

// ---------------------------------------------------------------------------
// Aba: dados do bloco
// É por aqui que uma disciplina cursada é ligada ou desligada depois da criação,
// e onde o limite de faltas e a média de aprovação são editados.
// ---------------------------------------------------------------------------
function AbaBloco({ bloco, aoSalvar }: { bloco: Bloco; aoSalvar: () => void }) {
  const [nome, setNome] = useState(bloco.nome);
  const [descricao, setDescricao] = useState(bloco.descricao ?? '');
  const [academico, setAcademico] = useState(bloco.wrapper_academico === 1);
  const [limiteFaltas, setLimiteFaltas] = useState(
    bloco.limite_faltas === null ? '' : String(bloco.limite_faltas)
  );
  const [media, setMedia] = useState(
    bloco.media_aprovacao === null ? '' : String(bloco.media_aprovacao)
  );
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);

  useEffect(() => {
    setNome(bloco.nome);
    setDescricao(bloco.descricao ?? '');
    setAcademico(bloco.wrapper_academico === 1);
    setLimiteFaltas(bloco.limite_faltas === null ? '' : String(bloco.limite_faltas));
    setMedia(bloco.media_aprovacao === null ? '' : String(bloco.media_aprovacao));
  }, [bloco]);

  const salvar = async () => {
    if (!nome.trim()) return;
    setSalvando(true);
    setMensagem(null);
    try {
      await api.atualizarBloco(bloco.id, {
        nome,
        descricao,
        wrapper_academico: academico,
        // Desligar a disciplina não apaga os valores já informados.
        limite_faltas: academico ? limiteFaltas : bloco.limite_faltas,
        media_aprovacao: academico ? media : bloco.media_aprovacao,
      });
      aoSalvar();
      setMensagem('Alterações salvas.');
    } catch (e) {
      setMensagem((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="rotulo">Nome</label>
        <input className="campo" value={nome} onChange={(e) => setNome(e.target.value)} />
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
            Deixe em branco para não registrar o valor. Ligar a disciplina libera o botão
            "Acadêmico" no topo do bloco, com o contador de faltas e a calculadora de média.
          </p>
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        {mensagem && <span className="text-sm text-zinc-500 dark:text-zinc-400">{mensagem}</span>}
        <button className="btn-primario" onClick={() => void salvar()} disabled={salvando || !nome.trim()}>
          Salvar
        </button>
      </div>
    </div>
  );
}
