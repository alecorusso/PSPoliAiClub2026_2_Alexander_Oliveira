import { useCallback, useEffect, useState } from 'react';
import { apiCompromissos } from '../api';
import type { Compromisso } from '../tipos';
import { cn, formatarData, hojeISO } from '../util';
import { Carregando, IconeLapis, IconeLixeira, IconeLista, IconeMais, IconeX } from './ui';

/**
 * Compromissos do dia.
 * Itens não concluídos de dias anteriores não são movidos para hoje nem geram
 * alerta, cobrança ou contagem de falhas — cada dia guarda só os seus.
 */
export function CardCompromissos() {
  const hoje = hojeISO();
  const [data, setData] = useState(hoje);
  const [itens, setItens] = useState<Compromisso[]>([]);
  const [datas, setDatas] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [novo, setNovo] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState('');
  const [consultando, setConsultando] = useState(false);

  const ehHoje = data === hoje;

  const carregar = useCallback(async () => {
    const [lista, todasAsDatas] = await Promise.all([
      apiCompromissos.listar(data),
      apiCompromissos.datas(),
    ]);
    setItens(lista);
    setDatas(todasAsDatas.filter((d) => d !== hoje));
    setCarregando(false);
  }, [data, hoje]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const adicionar = async () => {
    const texto = novo.trim();
    if (!texto) return;
    setNovo('');
    await apiCompromissos.criar(hoje, texto);
    if (!ehHoje) setData(hoje);
    else await carregar();
  };

  const alternar = async (c: Compromisso) => {
    await apiCompromissos.atualizar(c.id, { concluido: c.concluido !== 1 });
    await carregar();
  };

  const salvarEdicao = async (c: Compromisso) => {
    const texto = rascunho.trim();
    setEditando(null);
    if (!texto || texto === c.descricao) return;
    await apiCompromissos.atualizar(c.id, { descricao: texto });
    await carregar();
  };

  const excluir = async (c: Compromisso) => {
    await apiCompromissos.excluir(c.id);
    await carregar();
  };

  return (
    <div className="cartao p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <IconeLista className="h-4 w-4 text-zinc-400" />
        <h2 className="flex-1 text-sm font-semibold">
          {ehHoje ? 'Compromissos de hoje' : `Compromissos de ${formatarData(data)}`}
        </h2>

        {/* Consulta a dias anteriores — só leitura, nada é trazido para hoje. */}
        {consultando || !ehHoje ? (
          <span className="flex items-center gap-1">
            <select
              className="campo w-40 py-1 text-xs"
              value={data}
              onChange={(e) => setData(e.target.value)}
              aria-label="Ver compromissos de outro dia"
            >
              <option value={hoje}>Hoje</option>
              {datas.map((d) => (
                <option key={d} value={d}>
                  {formatarData(d)}
                </option>
              ))}
            </select>
            <button
              className="btn-sutil px-1.5 py-1"
              onClick={() => {
                setData(hoje);
                setConsultando(false);
              }}
              aria-label="Voltar para hoje"
            >
              <IconeX />
            </button>
          </span>
        ) : (
          datas.length > 0 && (
            <button className="btn-sutil px-2 py-1 text-xs" onClick={() => setConsultando(true)}>
              Ver outro dia
            </button>
          )
        )}
      </div>

      {!ehHoje && (
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          Consulta de um dia anterior. Itens em aberto continuam nesse dia — nada é movido para hoje.
        </p>
      )}

      {carregando ? (
        <Carregando />
      ) : (
        <>
          {itens.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {ehHoje ? 'Nenhum compromisso registrado para hoje.' : 'Nenhum compromisso nesse dia.'}
            </p>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {itens.map((c) => (
                <li key={c.id} className="group flex items-center gap-2.5 py-2 first:pt-0">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 cursor-pointer accent-indigo-600"
                    checked={c.concluido === 1}
                    onChange={() => void alternar(c)}
                    aria-label={`Marcar "${c.descricao}"`}
                  />

                  {editando === c.id ? (
                    <input
                      className="campo flex-1 py-1"
                      value={rascunho}
                      autoFocus
                      onChange={(e) => setRascunho(e.target.value)}
                      onBlur={() => void salvarEdicao(c)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void salvarEdicao(c);
                        if (e.key === 'Escape') setEditando(null);
                      }}
                    />
                  ) : (
                    <span
                      className={cn(
                        'min-w-0 flex-1 text-sm',
                        c.concluido === 1 && 'text-zinc-400 line-through dark:text-zinc-600'
                      )}
                    >
                      {c.descricao}
                    </span>
                  )}

                  <span className="flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      className="btn-sutil px-1.5 py-1"
                      onClick={() => {
                        setEditando(c.id);
                        setRascunho(c.descricao);
                      }}
                      aria-label={`Editar "${c.descricao}"`}
                    >
                      <IconeLapis className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="btn-perigo px-1.5 py-1"
                      onClick={() => void excluir(c)}
                      aria-label={`Excluir "${c.descricao}"`}
                    >
                      <IconeLixeira className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex gap-2">
            <input
              className="campo py-1.5"
              placeholder="Adicionar compromisso…"
              value={novo}
              onChange={(e) => setNovo(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void adicionar()}
            />
            <button className="btn-secundario py-1.5" onClick={() => void adicionar()} disabled={!novo.trim()}>
              <IconeMais className="h-3.5 w-3.5" />
              Adicionar
            </button>
          </div>
          {!ehHoje && novo.trim() && (
            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              O novo compromisso será criado em hoje.
            </p>
          )}
        </>
      )}
    </div>
  );
}
