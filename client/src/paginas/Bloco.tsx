import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import type { Bloco, Modo } from '../tipos';
import { cn } from '../util';
import { ConstruirTabela } from './ConstruirTabela';
import { ModoAprendizagem } from './ModoAprendizagem';
import { ModalConfiguracoes } from '../componentes/ModalConfiguracoes';
import { Carregando, Etiqueta, IconeChevron, IconeEngrenagem, Vazio } from '../componentes/ui';

const MODOS: { valor: Modo; rotulo: string }[] = [
  { valor: 'prova', rotulo: 'Modo Prova' },
  { valor: 'projeto', rotulo: 'Modo Projeto' },
  { valor: 'aprendizagem', rotulo: 'Modo Aprendizagem' },
];

export function PaginaBloco() {
  const { id = '' } = useParams();
  const [bloco, setBloco] = useState<Bloco | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Os três modos são lentes sobre o mesmo bloco, nunca etapas sequenciais.
  // Aprendizagem é o modo padrão ao abrir.
  const [modo, setModo] = useState<Modo>('aprendizagem');
  const [config, setConfig] = useState<'relacoes' | 'tabela' | null>(null);

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

  return (
    <div>
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

      {modo !== 'aprendizagem' ? (
        <div className="flex min-h-[50vh] items-center justify-center px-6">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Este modo será implementado na próxima etapa.
          </p>
        </div>
      ) : bloco.tabela_conteudos_construida === 0 ? (
        // Primeira entrada no bloco: as três opções de construção da tabela.
        // O alternador de modos continua disponível — os modos são lentes,
        // não etapas: nenhum é bloqueado por falta de progresso em outro.
        <ConstruirTabela bloco={bloco} aoConcluir={() => void carregar()} />
      ) : (
        <ModoAprendizagem bloco={bloco} aoAbrirTabela={() => setConfig('tabela')} />
      )}

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
    <header className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
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
