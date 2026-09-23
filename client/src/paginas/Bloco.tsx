import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, apiListas } from '../api';
import type { Bloco, ListaQuestoes, Modo, Pasta } from '../tipos';
import { cn } from '../util';
import { ConstruirTabela } from './ConstruirTabela';
import { ModoAprendizagem } from './ModoAprendizagem';
import { ModoProva } from './ModoProva';
import { ModoProjeto } from './ModoProjeto';
import { ChatBloco } from '../componentes/ChatBloco';
import { useFoco } from '../estado/foco';
import { esquecerRotaBlocos, guardarRotaBlocos } from '../estado/memoriaBlocos';
import { ModalConfiguracoes } from '../componentes/ModalConfiguracoes';
import { PainelAcademico } from '../componentes/PainelAcademico';
import { PainelMateriais } from '../componentes/PainelMateriais';
import {
  Carregando,
  Etiqueta,
  IconeAcademico,
  IconeChevron,
  IconeEngrenagem,
  IconeRelogio,
  IconeUpload,
  Vazio,
} from '../componentes/ui';

const MODOS: { valor: Modo; rotulo: string }[] = [
  { valor: 'prova', rotulo: 'Modo Prova' },
  { valor: 'projeto', rotulo: 'Modo Projeto' },
  { valor: 'aprendizagem', rotulo: 'Modo Aprendizagem' },
];

const CHAVE_CHAT = 'chat-bloco-aberto';

export function PaginaBloco() {
  const { id = '' } = useParams();
  const { sessao: sessaoFoco, iniciar: iniciarFoco } = useFoco();
  const [bloco, setBloco] = useState<Bloco | null>(null);
  const [pastas, setPastas] = useState<Pasta[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Os três modos são lentes sobre o mesmo bloco, nunca etapas sequenciais.
  // Aprendizagem é o modo padrão ao abrir.
  const [modo, setModo] = useState<Modo>('aprendizagem');
  const [config, setConfig] = useState<'bloco' | 'relacoes' | 'tabela' | null>(null);
  // O painel acadêmico tem entrada própria, fora das configurações.
  const [academicoAberto, setAcademicoAberto] = useState(false);
  const [materiaisAberto, setMateriaisAberto] = useState(false);

  // O chat lateral acompanha os três modos e sobrevive à troca de modo.
  const [chatAberto, setChatAberto] = useState(() => {
    try {
      return localStorage.getItem(CHAVE_CHAT) === '1';
    } catch {
      return false;
    }
  });
  const [chatVersao, setChatVersao] = useState(0);

  const alternarChat = (aberto: boolean) => {
    setChatAberto(aberto);
    try {
      localStorage.setItem(CHAVE_CHAT, aberto ? '1' : '0');
    } catch {
      // armazenamento indisponível — vale só para esta sessão
    }
  };

  const carregar = useCallback(async () => {
    try {
      setBloco(await api.obterBloco(id));
    } catch (e) {
      // Bloco excluído ou id inválido: deixa de ser o destino lembrado.
      esquecerRotaBlocos();
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // O bloco aberto é o lugar onde você estava: sair e voltar pela barra lateral
  // traz de volta o bloco, não a pasta dele.
  useEffect(() => {
    if (id) guardarRotaBlocos(`/blocos/${id}`);
  }, [id]);

  // Usadas só para montar o caminho até a pasta que contém este bloco.
  useEffect(() => {
    api.listarPastas().then(setPastas).catch(() => setPastas([]));
  }, []);

  // Da raiz até a pasta do bloco, para dar um atalho de volta a cada nível.
  const trilha = useMemo(() => {
    const caminho: Pasta[] = [];
    let cursor = bloco?.pasta_id ?? null;
    while (cursor) {
      const pasta = pastas.find((p) => p.id === cursor);
      if (!pasta) break;
      caminho.unshift(pasta);
      cursor = pasta.pasta_pai_id;
    }
    return caminho;
  }, [bloco?.pasta_id, pastas]);

  /**
   * "Corrigir com a IA": o contexto da lista entra no chat do bloco como uma
   * mensagem visível. A correção é informativa e não altera o status da lista.
   */
  const corrigirNoChat = useCallback(async (lista: ListaQuestoes) => {
    await apiListas.corrigir(lista.id);
    alternarChat(true);
    setChatVersao((v) => v + 1);
  }, []);

  if (carregando) {
    return (
      <div className="px-6 py-6">
        <Carregando />
      </div>
    );
  }

  if (erro || !bloco) {
    return (
      <div className="px-6 py-10">
        <Vazio
          titulo="Bloco não encontrado"
          descricao={erro ?? undefined}
          acao={
            <Link className="btn-secundario" to="/blocos">
              Voltar para Blocos
            </Link>
          }
        />
      </div>
    );
  }

  const tabelaPendente = bloco.tabela_conteudos_construida === 0;

  return (
    <div className="flex h-full flex-col">
      <Cabecalho bloco={bloco} trilha={trilha}>
        {/* Alternador de três modos */}
        <div className="flex rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700">
          {MODOS.map((m) => (
            <button
              key={m.valor}
              onClick={() => setModo(m.valor)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition',
                modo === m.valor
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
              )}
            >
              {m.rotulo}
            </button>
          ))}
        </div>

        {bloco.wrapper_academico === 1 && (
          <button
            className={cn(
              'btn-secundario',
              academicoAberto && 'border-indigo-400 text-indigo-700 dark:border-indigo-500 dark:text-indigo-300'
            )}
            onClick={() => setAcademicoAberto((v) => !v)}
            aria-expanded={academicoAberto}
            title="Faltas, notas e média desta disciplina"
          >
            <IconeAcademico />
            Acadêmico
          </button>
        )}

        {/* Os materiais valem nos três modos: é o repositório do bloco. */}
        <button
          className={cn(
            'btn-secundario',
            materiaisAberto && 'border-indigo-400 text-indigo-700 dark:border-indigo-500 dark:text-indigo-300'
          )}
          onClick={() => setMateriaisAberto((v) => !v)}
          aria-expanded={materiaisAberto}
          title="Documentos deste bloco"
        >
          <IconeUpload />
          Materiais
        </button>

        {/* Iniciada daqui, a sessão fica associada a este bloco. */}
        {!sessaoFoco && (
          <button
            className="btn-secundario"
            onClick={() => void iniciarFoco(bloco.id, bloco.nome)}
            title="Registrar uma sessão de foco neste bloco"
          >
            <IconeRelogio />
            Iniciar foco
          </button>
        )}

        <button
          className="btn-secundario px-2"
          onClick={() => setConfig('bloco')}
          aria-label="Configurações do bloco"
          title="Configurações do bloco"
        >
          <IconeEngrenagem />
        </button>
      </Cabecalho>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto">
          {/* Painel retrátil: mora na janela do bloco, não nas configurações.
              Fica acima do modo e some inteiro quando recolhido. */}
          {bloco.wrapper_academico === 1 && academicoAberto && (
            <section
              id="painel-academico"
              aria-label="Acadêmico"
              className="surgir border-b border-zinc-200 bg-zinc-50/60 px-6 py-5 dark:border-zinc-800 dark:bg-zinc-900/40"
            >
              <div className="mb-3 flex items-center gap-2">
                <IconeAcademico className="h-4 w-4 text-zinc-400" />
                <h2 className="text-sm font-semibold">Acadêmico</h2>
                <button
                  className="btn-sutil ml-auto px-2 py-1 text-xs"
                  onClick={() => setAcademicoAberto(false)}
                >
                  Recolher
                </button>
              </div>
              <PainelAcademico
                bloco={bloco}
                aoAtualizarBloco={() => void carregar()}
                aoIrParaBloco={() => setConfig('bloco')}
              />
            </section>
          )}

          {materiaisAberto && (
            <section
              id="painel-materiais"
              aria-label="Materiais"
              className="surgir border-b border-zinc-200 bg-zinc-50/60 px-6 py-5 dark:border-zinc-800 dark:bg-zinc-900/40"
            >
              <div className="mb-3 flex items-center gap-2">
                <IconeUpload className="h-4 w-4 text-zinc-400" />
                <h2 className="text-sm font-semibold">Materiais</h2>
                <button
                  className="btn-sutil ml-auto px-2 py-1 text-xs"
                  onClick={() => setMateriaisAberto(false)}
                >
                  Recolher
                </button>
              </div>
              <PainelMateriais blocoId={bloco.id} />
            </section>
          )}

          {modo === 'aprendizagem' ? (
            tabelaPendente ? (
              // Primeira entrada no bloco: as três opções de construção da tabela.
              // O alternador de modos continua disponível — os modos são lentes,
              // não etapas: nenhum é bloqueado por falta de progresso em outro.
              <ConstruirTabela bloco={bloco} aoConcluir={() => void carregar()} />
            ) : (
              <ModoAprendizagem bloco={bloco} aoAbrirTabela={() => setConfig('tabela')} />
            )
          ) : modo === 'prova' ? (
            <ModoProva bloco={bloco} aoCorrigir={corrigirNoChat} />
          ) : (
            <ModoProjeto
              bloco={bloco}
              aoCorrigir={corrigirNoChat}
              aoAtualizarBloco={() => void carregar()}
              aoAbrirTabela={() => setConfig('tabela')}
            />
          )}
        </div>

        <ChatBloco
          blocoId={bloco.id}
          modo={modo}
          aberto={chatAberto}
          aoAlternar={alternarChat}
          versao={chatVersao}
        />
      </div>

      <ModalConfiguracoes
        bloco={bloco}
        aberto={config !== null}
        abaInicial={config ?? 'bloco'}
        aoFechar={() => setConfig(null)}
        aoSalvarTabela={() => void carregar()}
      />
    </div>
  );
}

function Cabecalho({
  bloco,
  trilha,
  children,
}: {
  bloco: Bloco;
  trilha: Pasta[];
  children?: React.ReactNode;
}) {
  return (
    <header className="shrink-0 border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {/* Caminho completo: sair do bloco leva à pasta em que ele está. */}
          <nav className="mb-0.5 flex flex-wrap items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            <Link to="/blocos" className="rounded px-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              Blocos
            </Link>
            {trilha.map((p) => (
              <span key={p.id} className="flex items-center gap-1">
                <IconeChevron className="h-3 w-3" />
                <Link
                  to={`/blocos?pasta=${p.id}`}
                  className="rounded px-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {p.nome}
                </Link>
              </span>
            ))}
            <IconeChevron className="h-3 w-3" />
          </nav>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <span className="truncate">{bloco.nome}</span>
            {bloco.wrapper_academico === 1 && <Etiqueta>Disciplina</Etiqueta>}
          </h1>
          {bloco.descricao && (
            <p className="mt-0.5 max-w-2xl truncate text-sm text-zinc-500 dark:text-zinc-400">
              {bloco.descricao}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">{children}</div>
      </div>
    </header>
  );
}
