import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, apiListas } from '../api';
import type { Bloco, ListaQuestoes, Modo } from '../tipos';
import { cn } from '../util';
import { ConstruirTabela } from './ConstruirTabela';
import { ModoAprendizagem } from './ModoAprendizagem';
import { ModoProva } from './ModoProva';
import { ModoProjeto } from './ModoProjeto';
import { ChatBloco } from '../componentes/ChatBloco';
import { ModalConfiguracoes } from '../componentes/ModalConfiguracoes';
import { Carregando, Etiqueta, IconeChevron, IconeEngrenagem, Vazio } from '../componentes/ui';

const MODOS: { valor: Modo; rotulo: string }[] = [
  { valor: 'prova', rotulo: 'Modo Prova' },
  { valor: 'projeto', rotulo: 'Modo Projeto' },
  { valor: 'aprendizagem', rotulo: 'Modo Aprendizagem' },
];

const CHAVE_CHAT = 'chat-bloco-aberto';

export function PaginaBloco() {
  const { id = '' } = useParams();
  const [bloco, setBloco] = useState<Bloco | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Os três modos são lentes sobre o mesmo bloco, nunca etapas sequenciais.
  // Aprendizagem é o modo padrão ao abrir.
  const [modo, setModo] = useState<Modo>('aprendizagem');
  const [config, setConfig] = useState<'relacoes' | 'tabela' | null>(null);

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
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

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
      <Cabecalho bloco={bloco}>
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

        <button
          className="btn-secundario px-2"
          onClick={() => setConfig('relacoes')}
          aria-label="Configurações do bloco"
          title="Configurações do bloco"
        >
          <IconeEngrenagem />
        </button>
      </Cabecalho>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto">
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
        abaInicial={config ?? 'relacoes'}
        aoFechar={() => setConfig(null)}
        aoSalvarTabela={() => void carregar()}
      />
    </div>
  );
}

function Cabecalho({ bloco, children }: { bloco: Bloco; children?: React.ReactNode }) {
  return (
    <header className="shrink-0 border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <nav className="mb-0.5 flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            <Link to="/blocos" className="rounded px-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              Blocos
            </Link>
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
