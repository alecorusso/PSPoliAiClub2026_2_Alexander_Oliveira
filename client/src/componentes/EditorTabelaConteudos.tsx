import type { LinhaEditor, Natureza, Peso } from '../tipos';
import {
  cn,
  excluirLinha,
  inserirFilho,
  inserirIrmao,
  moverParaBaixo,
  moverParaCima,
  novoId,
  podeDescer,
  podePromover,
  podeRebaixar,
  podeSubir,
  promover,
  rebaixar,
  ROTULO_NATUREZA,
  ROTULO_PESO,
} from '../util';
import {
  IconeBaixo,
  IconeCima,
  IconeDireita,
  IconeEsquerda,
  IconeLista,
  IconeMais,
  IconeLixeira,
  Vazio,
} from './ui';

const NATUREZAS: Natureza[] = ['declarativo', 'procedimental', 'relacional'];
const PESOS: Peso[] = ['baixo', 'medio', 'alto'];

/**
 * Editor da tabela de conteúdos. A reordenação é feita por botões de seta
 * (↑ ↓ para ordem, ← → para nível) — sem drag-and-drop, por decisão de projeto.
 * Tópicos irmãos no mesmo nível são normais: não há desempate.
 */
export function EditorTabelaConteudos({
  linhas,
  aoMudar,
}: {
  linhas: LinhaEditor[];
  aoMudar: (linhas: LinhaEditor[]) => void;
}) {
  const atualizarCampo = (i: number, campo: Partial<LinhaEditor>) =>
    aoMudar(linhas.map((l, j) => (j === i ? { ...l, ...campo } : l)));

  const adicionarNoFim = () =>
    aoMudar([...linhas, { id: novoId(), titulo: '', natureza: 'declarativo', peso: 'medio', nivel: 0 }]);

  if (linhas.length === 0) {
    return (
      <Vazio
        icone={<IconeLista className="h-8 w-8" />}
        titulo="A tabela de conteúdos está vazia"
        descricao="Adicione o primeiro tópico para começar a montar a árvore."
        acao={
          <button className="btn-primario" onClick={adicionarNoFim}>
            <IconeMais />
            Adicionar tópico
          </button>
        }
      />
    );
  }

  return (
    <div>
      <div className="space-y-1">
        {linhas.map((linha, i) => (
          <div
            key={linha.id}
            className="group flex items-start gap-2 rounded-lg px-1 py-1 hover:bg-zinc-100/70 dark:hover:bg-zinc-900"
            style={{ marginLeft: linha.nivel * 22 }}
          >
            {/* Guia visual de indentação */}
            {linha.nivel > 0 && (
              <span className="mt-3.5 h-px w-3 shrink-0 bg-zinc-300 dark:bg-zinc-700" aria-hidden />
            )}

            <input
              className="campo min-w-0 flex-1 py-1.5"
              placeholder="Título do tópico"
              value={linha.titulo}
              onChange={(e) => atualizarCampo(i, { titulo: e.target.value })}
            />

            <select
              className="campo w-36 shrink-0 py-1.5"
              value={linha.natureza}
              onChange={(e) => atualizarCampo(i, { natureza: e.target.value as Natureza })}
              aria-label="Natureza do tópico"
            >
              {NATUREZAS.map((n) => (
                <option key={n} value={n}>
                  {ROTULO_NATUREZA[n]}
                </option>
              ))}
            </select>

            <select
              className="campo w-24 shrink-0 py-1.5"
              value={linha.peso}
              onChange={(e) => atualizarCampo(i, { peso: e.target.value as Peso })}
              aria-label="Peso do tópico"
            >
              {PESOS.map((p) => (
                <option key={p} value={p}>
                  {ROTULO_PESO[p]}
                </option>
              ))}
            </select>

            <div className="flex shrink-0 items-center">
              <BotaoSeta
                titulo="Mover para cima"
                desativado={!podeSubir(linhas, i)}
                aoClicar={() => aoMudar(moverParaCima(linhas, i))}
              >
                <IconeCima className="h-3.5 w-3.5" />
              </BotaoSeta>
              <BotaoSeta
                titulo="Mover para baixo"
                desativado={!podeDescer(linhas, i)}
                aoClicar={() => aoMudar(moverParaBaixo(linhas, i))}
              >
                <IconeBaixo className="h-3.5 w-3.5" />
              </BotaoSeta>
              <BotaoSeta
                titulo="Diminuir nível"
                desativado={!podePromover(linhas, i)}
                aoClicar={() => aoMudar(promover(linhas, i))}
              >
                <IconeEsquerda className="h-3.5 w-3.5" />
              </BotaoSeta>
              <BotaoSeta
                titulo="Aumentar nível"
                desativado={!podeRebaixar(linhas, i)}
                aoClicar={() => aoMudar(rebaixar(linhas, i))}
              >
                <IconeDireita className="h-3.5 w-3.5" />
              </BotaoSeta>

              <span className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-800" />

              <BotaoSeta titulo="Adicionar tópico abaixo" aoClicar={() => aoMudar(inserirIrmao(linhas, i))}>
                <IconeMais className="h-3.5 w-3.5" />
              </BotaoSeta>
              <BotaoSeta titulo="Adicionar subtópico" aoClicar={() => aoMudar(inserirFilho(linhas, i))}>
                <span className="flex items-center text-[10px] font-semibold leading-none">
                  <IconeDireita className="h-3 w-3" />+
                </span>
              </BotaoSeta>
              <BotaoSeta
                titulo="Excluir tópico e seus subtópicos"
                perigo
                aoClicar={() => aoMudar(excluirLinha(linhas, i))}
              >
                <IconeLixeira className="h-3.5 w-3.5" />
              </BotaoSeta>
            </div>
          </div>
        ))}
      </div>

      <button className="btn-secundario mt-3" onClick={adicionarNoFim}>
        <IconeMais />
        Adicionar tópico
      </button>
    </div>
  );
}

function BotaoSeta({
  children,
  titulo,
  desativado,
  perigo,
  aoClicar,
}: {
  children: React.ReactNode;
  titulo: string;
  desativado?: boolean;
  perigo?: boolean;
  aoClicar: () => void;
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      disabled={desativado}
      onClick={aoClicar}
      className={cn(
        'rounded p-1.5 transition disabled:opacity-25',
        perigo
          ? 'text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400'
          : 'text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
      )}
    >
      {children}
    </button>
  );
}
