import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiCalendario, apiExclusao } from '../api';
import type { Bloco, TipoEvento } from '../tipos';
import type { ItemCalendario } from '../lib/calendario';
import { formatarData, hojeISO } from '../util';
import { CampoEstimativa, ESTIMATIVA_VAZIA, minutosNumero, type Estimativa } from './CampoEstimativa';
import { TIPOS } from './Calendario';
import { Aviso, Etiqueta, Modal } from './ui';

const TIPOS_EVENTO: { id: TipoEvento; rotulo: string }[] = [
  { id: 'prova', rotulo: 'Prova' },
  { id: 'aula', rotulo: 'Aula' },
  { id: 'entrega', rotulo: 'Entrega' },
  { id: 'outro', rotulo: 'Outro' },
];

/**
 * Novo evento.
 *
 * Prova + bloco com wrapper acadêmico = avaliação daquele bloco, e o formulário
 * muda para os campos da avaliação. É o que impede a mesma prova de existir duas
 * vezes: uma no calendário e outra no cronograma.
 */
export function ModalNovoEvento({
  aberto,
  dataInicial,
  aoFechar,
  aoCriar,
}: {
  aberto: boolean;
  dataInicial: string;
  aoFechar: () => void;
  aoCriar: () => void;
}) {
  const [blocos, setBlocos] = useState<Bloco[]>([]);
  const [titulo, setTitulo] = useState('');
  const [tipo, setTipo] = useState<TipoEvento>('outro');
  const [blocoId, setBlocoId] = useState('');
  const [data, setData] = useState(dataInicial);
  const [observacao, setObservacao] = useState('');
  const [peso, setPeso] = useState('');
  const [estimativa, setEstimativa] = useState<Estimativa>(ESTIMATIVA_VAZIA);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setTitulo('');
    setTipo('outro');
    setBlocoId('');
    setData(dataInicial);
    setObservacao('');
    setPeso('');
    setEstimativa(ESTIMATIVA_VAZIA);
    setErro(null);
    api.listarBlocos().then(setBlocos).catch(() => setBlocos([]));
  }, [aberto, dataInicial]);

  const bloco = blocos.find((b) => b.id === blocoId) ?? null;
  const viraAvaliacao = tipo === 'prova' && bloco?.wrapper_academico === 1;

  const salvar = async () => {
    if (!titulo.trim()) return;
    setSalvando(true);
    setErro(null);
    try {
      await apiCalendario.criar({
        titulo,
        tipo,
        bloco_id: blocoId || null,
        data_inicio: data || null,
        observacao,
        // Só chegam ao servidor quando o registro vira avaliação.
        peso: viraAvaliacao ? peso : null,
        tempo_estimado_min: viraAvaliacao ? minutosNumero(estimativa.minutos) : null,
        origem_estimativa: viraAvaliacao && estimativa.minutos ? estimativa.origem : null,
        tipo_tarefa: viraAvaliacao ? estimativa.tipoTarefa.trim() || null : null,
      });
      aoCriar();
      aoFechar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo="Novo evento" largura="max-w-lg">
      <div className="space-y-4">
        <div>
          <label className="rotulo">Nome</label>
          <input className="campo" value={titulo} onChange={(e) => setTitulo(e.target.value)} autoFocus />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="rotulo">Tipo</label>
            <select
              className="campo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoEvento)}
              aria-label="Tipo do evento"
            >
              {TIPOS_EVENTO.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.rotulo}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="rotulo">Data</label>
            <input
              className="campo"
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              aria-label="Data do evento"
            />
          </div>
        </div>

        <div>
          <label className="rotulo">Bloco</label>
          <select
            className="campo"
            value={blocoId}
            onChange={(e) => setBlocoId(e.target.value)}
            aria-label="Bloco do evento"
          >
            <option value="">Sem bloco</option>
            {blocos.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nome}
                {b.wrapper_academico === 1 ? ' (disciplina)' : ''}
              </option>
            ))}
          </select>
        </div>

        {viraAvaliacao ? (
          <div className="surgir space-y-4 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Prova de disciplina é registrada como avaliação de {bloco?.nome}. Ela aparece no painel
              Acadêmico, no calendário e no cronograma — sempre como um registro só.
            </p>
            <div className="sm:max-w-[10rem]">
              <label className="rotulo">Peso</label>
              <input
                className="campo"
                inputMode="decimal"
                value={peso}
                onChange={(e) => setPeso(e.target.value)}
                placeholder="—"
                aria-label="Peso da avaliação"
              />
            </div>
            <CampoEstimativa
              valor={estimativa}
              aoMudar={setEstimativa}
              descricao={`Estudar para ${titulo || 'a avaliação'}`}
              contexto={bloco?.nome}
              rotulo="Tempo estimado de preparação"
            />
          </div>
        ) : (
          <div>
            <label className="rotulo">Observação</label>
            <textarea
              className="campo resize-none"
              rows={2}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
            />
          </div>
        )}

        {tipo === 'prova' && !viraAvaliacao && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Sem uma disciplina associada, a prova fica registrada só no calendário e não entra no
            cronograma.
          </p>
        )}

        {erro && <Aviso tom="atencao">{erro}</Aviso>}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secundario" onClick={aoFechar}>
          Cancelar
        </button>
        <button
          className="btn-primario"
          onClick={() => void salvar()}
          disabled={!titulo.trim() || salvando}
        >
          {viraAvaliacao ? 'Criar avaliação' : 'Criar evento'}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Detalhes de um item do calendário, com as ações cabíveis ao tipo.
 *
 * Excluir aqui é a MESMA ação de excluir pela tela de origem: o item some de
 * verdade. A confirmação diz o que se perde, item por item — e as evidências já
 * registradas ficam, porque são histórico do que aconteceu.
 */
export function ModalItemCalendario({
  item,
  aoFechar,
  aoReagendar,
  aoConcluir,
  aoExcluir,
}: {
  item: ItemCalendario | null;
  aoFechar: () => void;
  aoReagendar: (item: ItemCalendario, data: string) => Promise<void>;
  aoConcluir: (item: ItemCalendario) => Promise<void>;
  aoExcluir: (item: ItemCalendario) => Promise<void>;
}) {
  const [data, setData] = useState(hojeISO());
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [consequencias, setConsequencias] = useState<string[]>([]);

  useEffect(() => {
    if (!item) return;
    setData(item.data);
    setConfirmando(false);
    setConsequencias([]);
  }, [item]);

  const concluido = item?.concluido === 1;
  // A nota já é a confirmação de que a avaliação aconteceu: com nota, não há
  // o que marcar.
  const avaliacaoComNota =
    item?.tipo === 'avaliacao' && item.detalhe?.nota !== null && item.detalhe?.nota !== undefined;

  const pedirConfirmacao = async () => {
    if (!item) return;
    const r = await apiExclusao.consequencias(item.tipo, item.id);
    setConsequencias(r.linhas);
    setConfirmando(true);
  };

  const rotuloConcluir = useMemo(() => {
    if (!item) return 'Concluir';
    // Sem nota, marcar significa: a prova foi feita e o resultado não saiu.
    if (item.tipo === 'avaliacao') return 'Marcar como realizada';
    return 'Concluir';
  }, [item]);

  const executar = async (acao: () => Promise<void>) => {
    setOcupado(true);
    try {
      await acao();
      aoFechar();
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Modal
      aberto={Boolean(item)}
      aoFechar={aoFechar}
      titulo={item?.titulo ?? ''}
      largura="max-w-md"
    >
      {item && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <Etiqueta>{TIPOS[item.tipo].rotulo}</Etiqueta>
            {item.bloco_id && (
              <Link className="hover:underline" to={`/blocos/${item.bloco_id}`}>
                {item.bloco_nome}
              </Link>
            )}
            <span>{formatarData(item.data)}</span>
            {concluido && <Etiqueta>Concluído</Etiqueta>}
          </div>

          {typeof item.detalhe?.observacao === 'string' && item.detalhe.observacao && (
            <p className="text-sm text-zinc-600 dark:text-zinc-300">{item.detalhe.observacao}</p>
          )}
          {item.tipo === 'revisao' && (
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              Revisão {String(item.detalhe?.numero ?? '')} de 3. Reagendar move a data sem avançar o
              número da revisão.
            </p>
          )}

          {/* A nota é dado do usuário: a plataforma exibe, nunca infere. */}
          {avaliacaoComNota && (
            <p className="text-sm">
              Nota <span className="font-medium">{String(item.detalhe?.nota)}</span>
            </p>
          )}
          {item.tipo === 'avaliacao' && !avaliacaoComNota && item.detalhe?.realizada === 1 && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">aguardando nota</p>
          )}

          {/* O vínculo aparece no detalhe do item que realiza a avaliação. */}
          {item.detalhe?.avaliacao != null && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Vale para a avaliação{' '}
              <span className="font-medium">
                {String((item.detalhe.avaliacao as { titulo: string }).titulo)}
              </span>
            </p>
          )}

          <div>
            <label className="rotulo">Nova data</label>
            <input
              className="campo"
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              aria-label="Nova data"
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Mover a data não conta como atraso.
            </p>
          </div>

          {/* Toda exclusão diz o que se perde, antes de acontecer. */}
          {confirmando && (
            <div className="surgir space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              {consequencias.map((l) => (
                <p key={l} className="text-sm text-zinc-600 dark:text-zinc-300">
                  {l}
                </p>
              ))}
              <div className="flex flex-wrap justify-end gap-2">
                <button className="btn-secundario py-1" onClick={() => setConfirmando(false)}>
                  Cancelar
                </button>
                <button
                  className="btn-perigo px-2.5 py-1 text-sm"
                  onClick={() => void executar(() => aoExcluir(item))}
                  disabled={ocupado}
                >
                  Excluir mesmo assim
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {item && (
          <button
            className="btn-perigo mr-auto px-2.5 py-1.5 text-sm"
            onClick={() => void pedirConfirmacao()}
            disabled={ocupado || confirmando}
          >
            Excluir
          </button>
        )}
        <button className="btn-secundario" onClick={aoFechar}>
          Fechar
        </button>
        {item && !concluido && !avaliacaoComNota && (
          <button
            className="btn-secundario"
            onClick={() => void executar(() => aoConcluir(item))}
            disabled={ocupado}
          >
            {rotuloConcluir}
          </button>
        )}
        {item && (
          <button
            className="btn-primario"
            onClick={() => void executar(() => aoReagendar(item, data))}
            disabled={ocupado || data === item.data}
          >
            Reagendar
          </button>
        )}
      </div>
    </Modal>
  );
}
