import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, apiAvaliacoes } from '../api';
import type { Bloco, LinhaAvaliacao } from '../tipos';
import {
  calcularMedias,
  cn,
  formatarNota,
  novoId,
  numeroOuNulo,
  textoFaltas,
  type ResultadoMedias,
} from '../util';
import { Aviso, Carregando, IconeLixeira, IconeMais } from './ui';

const CHAVE_SOMA = 'soma-esperada-pesos';

/**
 * Wrapper acadêmico: contador de faltas e calculadora de média.
 * As notas são dado acadêmico informado pelo usuário — a plataforma não avalia
 * nada, apenas guarda e faz a aritmética que ele pediu.
 */
export function AbaWrapperAcademico({
  bloco,
  aoAtualizarBloco,
}: {
  bloco: Bloco;
  aoAtualizarBloco: () => void;
}) {
  return (
    <div className="space-y-8">
      <ContadorFaltas bloco={bloco} aoAtualizarBloco={aoAtualizarBloco} />
      <Calculadora bloco={bloco} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contador de faltas
// ---------------------------------------------------------------------------
function ContadorFaltas({ bloco, aoAtualizarBloco }: { bloco: Bloco; aoAtualizarBloco: () => void }) {
  const [faltas, setFaltas] = useState(bloco.faltas_registradas);
  const [rascunho, setRascunho] = useState(String(bloco.faltas_registradas));
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setFaltas(bloco.faltas_registradas);
    setRascunho(String(bloco.faltas_registradas));
  }, [bloco.faltas_registradas]);

  const limite = bloco.limite_faltas;

  const gravar = async (valor: number) => {
    const novo = Math.max(0, Math.round(valor));
    setFaltas(novo);
    setRascunho(String(novo));
    setSalvando(true);
    try {
      await api.atualizarBloco(bloco.id, { faltas_registradas: novo });
      aoAtualizarBloco();
    } finally {
      setSalvando(false);
    }
  };

  const proporcao = limite && limite > 0 ? Math.min(faltas / limite, 1) : 0;
  const restam = limite === null ? null : limite - faltas;
  // Âmbar ao se aproximar e ao atingir o limite. Nunca vermelho alarmante.
  const emAtencao = restam !== null && restam <= Math.max(2, Math.ceil((limite ?? 0) * 0.25));

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold">Faltas</h3>

      {limite === null ? (
        <Aviso>
          Este bloco não tem limite de faltas registrado. Você pode informá-lo ao editar o bloco.
        </Aviso>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm">
              <span className="text-lg font-semibold">{faltas}</span>
              <span className="text-zinc-500 dark:text-zinc-400"> de {limite}</span>
            </span>
            <span
              className={cn(
                'text-sm',
                emAtencao ? 'text-amber-700 dark:text-amber-300' : 'text-zinc-500 dark:text-zinc-400'
              )}
            >
              {textoFaltas(faltas, limite)}
            </span>
          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                emAtencao ? 'bg-amber-500' : 'bg-indigo-500'
              )}
              style={{ width: `${proporcao * 100}%` }}
            />
          </div>
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn-secundario py-1.5" onClick={() => void gravar(faltas - 1)} disabled={faltas === 0 || salvando}>
          −1 falta
        </button>
        <button className="btn-secundario py-1.5" onClick={() => void gravar(faltas + 1)} disabled={salvando}>
          <IconeMais className="h-3.5 w-3.5" />1 falta
        </button>
        <span className="mx-1 text-xs text-zinc-400 dark:text-zinc-600">ou</span>
        <input
          className="campo w-24 py-1.5"
          type="number"
          min={0}
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          onBlur={() => void gravar(numeroOuNulo(rascunho) ?? faltas)}
          onKeyDown={(e) => e.key === 'Enter' && void gravar(numeroOuNulo(rascunho) ?? faltas)}
          aria-label="Faltas registradas"
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Calculadora de média e simulador
// ---------------------------------------------------------------------------
function Calculadora({ bloco }: { bloco: Bloco }) {
  const [linhas, setLinhas] = useState<LinhaAvaliacao[]>([]);
  const [simuladas, setSimuladas] = useState<Record<string, string>>({});
  const [simulando, setSimulando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [somaEsperada, setSomaEsperada] = useState<number | null>(() => {
    try {
      const bruto = localStorage.getItem(CHAVE_SOMA);
      return bruto ? Number(bruto) || null : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    apiAvaliacoes
      .listar(bloco.id)
      .then((avs) =>
        setLinhas(
          avs.map((a) => ({
            id: a.id,
            titulo: a.titulo,
            peso: a.peso === null ? '' : String(a.peso),
            nota: a.nota === null ? '' : String(a.nota),
          }))
        )
      )
      .finally(() => setCarregando(false));
  }, [bloco.id]);

  const trocarSomaEsperada = (valor: number | null) => {
    setSomaEsperada(valor);
    try {
      if (valor === null) localStorage.removeItem(CHAVE_SOMA);
      else localStorage.setItem(CHAVE_SOMA, String(valor));
    } catch {
      // armazenamento indisponível — vale só para esta sessão
    }
  };

  const resultado = useMemo(
    () => calcularMedias(linhas, simulando ? simuladas : {}, bloco.media_aprovacao, somaEsperada),
    [linhas, simuladas, simulando, bloco.media_aprovacao, somaEsperada]
  );

  const atualizar = (id: string, campo: keyof LinhaAvaliacao, valor: string) =>
    setLinhas((atuais) => atuais.map((l) => (l.id === id ? { ...l, [campo]: valor } : l)));

  const adicionar = () =>
    setLinhas((atuais) => [...atuais, { id: novoId(), titulo: '', peso: '', nota: '' }]);

  const remover = (id: string) => {
    setLinhas((atuais) => atuais.filter((l) => l.id !== id));
    setSimuladas(({ [id]: _removida, ...resto }) => resto);
  };

  // As notas simuladas nunca são enviadas ao servidor.
  const salvar = useCallback(async () => {
    setSalvando(true);
    setMensagem(null);
    try {
      const avs = await apiAvaliacoes.salvar(
        bloco.id,
        linhas.filter((l) => l.titulo.trim() || l.peso || l.nota)
      );
      setLinhas(
        avs.map((a) => ({
          id: a.id,
          titulo: a.titulo,
          peso: a.peso === null ? '' : String(a.peso),
          nota: a.nota === null ? '' : String(a.nota),
        }))
      );
      setMensagem('Avaliações salvas.');
    } catch (e) {
      setMensagem((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }, [bloco.id, linhas]);

  if (carregando) return <Carregando />;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Média e simulação</h3>
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <label htmlFor="soma-esperada">Soma esperada dos pesos</label>
          <select
            id="soma-esperada"
            className="campo w-32 py-1 text-xs"
            value={somaEsperada === null ? '' : String(somaEsperada)}
            onChange={(e) => trocarSomaEsperada(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Livre</option>
            <option value="10">10</option>
            <option value="100">100</option>
          </select>
        </div>
      </div>

      {/* Grade editável */}
      <div className="cartao overflow-hidden">
        <div className="grid grid-cols-[1fr_5rem_6rem_2rem] gap-2 border-b border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <span>Avaliação</span>
          <span>Peso</span>
          <span>Nota</span>
          <span />
        </div>

        {linhas.length === 0 ? (
          <p className="px-3 py-4 text-sm text-zinc-500 dark:text-zinc-400">
            Nenhuma avaliação cadastrada.
          </p>
        ) : (
          linhas.map((l) => {
            const semNota = numeroOuNulo(l.nota) === null;
            const simulada = simulando && semNota;
            return (
              <div
                key={l.id}
                className="grid grid-cols-[1fr_5rem_6rem_2rem] items-center gap-2 border-b border-zinc-100 px-3 py-1.5 last:border-0 dark:border-zinc-800/60"
              >
                <input
                  className="campo py-1.5"
                  placeholder="Nome da avaliação"
                  value={l.titulo}
                  onChange={(e) => atualizar(l.id, 'titulo', e.target.value)}
                />
                <input
                  className="campo py-1.5"
                  placeholder="—"
                  inputMode="decimal"
                  value={l.peso}
                  onChange={(e) => atualizar(l.id, 'peso', e.target.value)}
                  aria-label={`Peso de ${l.titulo || 'avaliação'}`}
                />
                {simulada ? (
                  // Nota hipotética: itálico e fundo distinto. Nunca salva no banco.
                  <input
                    className="campo bg-amber-50 py-1.5 italic dark:bg-amber-950/40"
                    placeholder="simular"
                    inputMode="decimal"
                    value={simuladas[l.id] ?? ''}
                    onChange={(e) => setSimuladas((s) => ({ ...s, [l.id]: e.target.value }))}
                    aria-label={`Nota simulada de ${l.titulo || 'avaliação'}`}
                  />
                ) : (
                  <input
                    className="campo py-1.5"
                    placeholder="—"
                    inputMode="decimal"
                    value={l.nota}
                    onChange={(e) => atualizar(l.id, 'nota', e.target.value)}
                    aria-label={`Nota de ${l.titulo || 'avaliação'}`}
                  />
                )}
                <button
                  className="btn-perigo px-1.5 py-1"
                  onClick={() => remover(l.id)}
                  aria-label={`Remover ${l.titulo || 'avaliação'}`}
                  title="Remover avaliação"
                >
                  <IconeLixeira className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn-secundario py-1.5" onClick={adicionar}>
          <IconeMais className="h-3.5 w-3.5" />
          Adicionar avaliação
        </button>
        <button className="btn-primario py-1.5" onClick={() => void salvar()} disabled={salvando}>
          Salvar avaliações
        </button>
        {mensagem && <span className="text-xs text-zinc-500 dark:text-zinc-400">{mensagem}</span>}
      </div>

      {/* Simulação */}
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-indigo-600"
            checked={simulando}
            onChange={(e) => setSimulando(e.target.checked)}
          />
          Simular notas
        </label>
        <span className="flex-1 text-xs text-zinc-500 dark:text-zinc-400">
          Preenche notas hipotéticas nas avaliações sem nota. Nada disso é salvo.
        </span>
        {simulando && (
          <button className="btn-sutil py-1" onClick={() => setSimuladas({})}>
            Limpar simulação
          </button>
        )}
      </div>

      {resultado.avisoPesos && (
        <div className="mt-3">
          <Aviso>{resultado.avisoPesos}</Aviso>
        </div>
      )}

      <Resultados resultado={resultado} mediaAprovacao={bloco.media_aprovacao} simulando={simulando} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Os três resultados, ao vivo
// ---------------------------------------------------------------------------
function Resultados({
  resultado,
  mediaAprovacao,
  simulando,
}: {
  resultado: ResultadoMedias;
  mediaAprovacao: number | null;
  simulando: boolean;
}) {
  const { mediaAtual, mediaProjetada, notaNecessaria, situacao } = resultado;

  const textoNecessaria = () => {
    if (mediaAprovacao === null) return 'Este bloco não tem média para aprovação registrada.';
    switch (situacao) {
      case 'garantida':
        return `As notas já informadas alcançam a média ${formatarNota(mediaAprovacao)}, independentemente das restantes.`;
      case 'inalcancavel':
        return `Com as notas informadas, a média ${formatarNota(mediaAprovacao)} não é mais alcançável nas avaliações restantes.`;
      case 'sem_restantes':
        return mediaAtual !== null && mediaAtual >= mediaAprovacao
          ? `Todas as avaliações têm nota. A média final é ${formatarNota(mediaAtual)}, igual ou acima de ${formatarNota(mediaAprovacao)}.`
          : `Todas as avaliações têm nota. A média final é ${formatarNota(mediaAtual)}.`;
      case 'em_andamento':
        return `Média ${formatarNota(notaNecessaria)} nas avaliações restantes para fechar ${formatarNota(mediaAprovacao)}.`;
      default:
        return 'Informe pesos e ao menos uma nota para calcular.';
    }
  };

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <Resultado rotulo="Média atual" valor={formatarNota(mediaAtual)} nota="Só as avaliações com nota informada." />
      <Resultado
        rotulo="Média final projetada"
        valor={formatarNota(mediaProjetada)}
        nota={
          simulando
            ? 'Com as notas simuladas; as demais assumem a média atual.'
            : 'As avaliações sem nota assumem a média atual, então o valor coincide com ela.'
        }
        destaque={simulando}
      />
      <Resultado rotulo="Nota necessária" valor={situacao === 'em_andamento' ? formatarNota(notaNecessaria) : '—'} nota={textoNecessaria()} />
    </div>
  );
}

function Resultado({
  rotulo,
  valor,
  nota,
  destaque,
}: {
  rotulo: string;
  valor: string;
  nota: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2.5',
        destaque
          ? 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'
          : 'border-zinc-200 dark:border-zinc-800'
      )}
    >
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{rotulo}</p>
      <p className={cn('mt-0.5 text-2xl font-semibold tabular-nums', destaque && 'italic')}>{valor}</p>
      <p className="mt-1 text-xs leading-snug text-zinc-500 dark:text-zinc-500">{nota}</p>
    </div>
  );
}
