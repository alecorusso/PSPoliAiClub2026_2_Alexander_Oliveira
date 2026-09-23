import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { usarCronograma } from '../estado/usarCronograma';
import { sugestoesDoDia } from '../lib/cronograma';
import { textoDuracao } from './CampoEstimativa';
import { CampoOrcamento, LinhaCronograma } from './Cronograma';
import { Carregando, Etiqueta, IconeLista } from './ui';

/**
 * Sugestões do dia.
 *
 * É uma sugestão, não uma meta: o tempo planejado aqui nunca é comparado com o
 * tempo das sessões de foco, e nada aqui vira cobrança.
 */
export function CardSugestoes() {
  const { fila, orcamentoMin, carregando, erro, salvarOrcamento } = usarCronograma();

  const sugestoes = useMemo(() => sugestoesDoDia(fila, orcamentoMin), [fila, orcamentoMin]);

  return (
    <section>
      <div className="cartao p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <IconeLista className="h-4 w-4 text-zinc-400" />
          <h2 className="text-sm font-semibold">Sugestões do dia</h2>
          {sugestoes.itens.length > 0 && <Etiqueta>{sugestoes.itens.length}</Etiqueta>}
          <div className="ml-auto flex items-center gap-3">
            <CampoOrcamento minutos={orcamentoMin} aoMudar={(m) => void salvarOrcamento(m)} />
            <Link className="text-xs text-zinc-500 hover:underline dark:text-zinc-400" to="/calendario">
              Ver cronograma
            </Link>
          </div>
        </div>

        {carregando ? (
          <Carregando />
        ) : erro ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{erro}</p>
        ) : sugestoes.itens.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Nada com prazo ou tempo estimado no momento.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {sugestoes.itens.map((item) => (
                <LinhaCronograma
                  key={`${item.tipo}:${item.id}`}
                  item={item}
                  className="first:pt-0 last:pb-0"
                  acoes={
                    <Link className="btn-secundario py-1.5" to={`/blocos/${item.blocoId}`}>
                      Abrir
                    </Link>
                  }
                />
              ))}
            </ul>
            <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
              {textoDuracao(sugestoes.totalMin)} de trabalho estimado.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
