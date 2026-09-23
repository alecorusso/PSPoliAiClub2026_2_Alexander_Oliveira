import { useEffect, useMemo, useState } from 'react';
import { apiListas } from '../api';
import type { ListaQuestoes, StatusLista } from '../tipos';
import {
  cn,
  formatarData,
  lerGabarito,
  lerQuestoes,
  ROTULO_ORIGEM,
  ROTULO_STATUS_LISTA,
  STATUS_LISTA,
} from '../util';
import { Aviso, Etiqueta, IconeChevron, IconeConversa, IconeLixeira, Modal } from './ui';
import { GeradoAPartirDe } from './GeradoAPartirDe';
import { textoDaOrigem, textoDoApoio } from '../lib/origem';
import { CampoAvaliacao } from './CampoAvaliacao';

/**
 * Visualizador de lista, usado tanto pelas listas do Modo Prova quanto pelos
 * testes teóricos do Modo Projeto.
 * O status é marcado APENAS pelo usuário; a correção pela IA é informativa e
 * nunca altera esse status.
 */
export function VisualizadorLista({
  lista,
  aoFechar,
  aoMudar,
  aoCorrigir,
}: {
  lista: ListaQuestoes | null;
  aoFechar: () => void;
  aoMudar: () => void;
  aoCorrigir: (lista: ListaQuestoes) => Promise<void>;
}) {
  const [mostrarGabarito, setMostrarGabarito] = useState(false);
  const [status, setStatus] = useState<StatusLista>('nao_feita');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  // O gabarito começa sempre recolhido, inclusive ao trocar de lista.
  useEffect(() => {
    if (!lista) return;
    setMostrarGabarito(false);
    setStatus(lista.status);
    setErro(null);
    setExcluindo(false);
  }, [lista?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const questoes = useMemo(() => lerQuestoes(lista?.enunciado ?? null), [lista?.enunciado]);
  // "Baseada nas páginas 112–130 de <livro>": de onde a lista gerada saiu.
  const origemPaginas = useMemo(() => {
    try {
      return lista?.origem_paginas ? textoDaOrigem(JSON.parse(lista.origem_paginas)) : '';
    } catch {
      return '';
    }
  }, [lista?.origem_paginas]);
  const gabarito = useMemo(() => lerGabarito(lista?.gabarito ?? null), [lista?.gabarito]);

  if (!lista) return null;

  const trocarStatus = async (novo: StatusLista) => {
    setStatus(novo);
    setOcupado(true);
    setErro(null);
    try {
      await apiListas.atualizar(lista.id, { status: novo });
      aoMudar();
    } catch (e) {
      setStatus(lista.status);
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const corrigir = async () => {
    setOcupado(true);
    setErro(null);
    try {
      await aoCorrigir(lista);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const excluir = async () => {
    await apiListas.excluir(lista.id);
    aoMudar();
    aoFechar();
  };

  return (
    <Modal aberto aoFechar={aoFechar} titulo={lista.titulo} largura="max-w-3xl">
      {/* Metadados: origem sempre visível */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <Etiqueta>{ROTULO_ORIGEM[lista.origem]}</Etiqueta>
        {lista.topico_titulo && <Etiqueta>{lista.topico_titulo}</Etiqueta>}
        <span>Criada em {formatarData(lista.criado_em)}</span>
        {Array.isArray(questoes) && <span>· {questoes.length} questões</span>}
      </div>

      {/* De quais documentos ela saiu. Some se não veio de documento nenhum. */}
      <div className="-mt-3 mb-4">
        <GeradoAPartirDe tipo="lista_questoes" itemId={lista.id} blocoId={lista.bloco_id} />
        {origemPaginas && <p className="text-xs text-zinc-400 dark:text-zinc-500">{origemPaginas}</p>}
      </div>

      <div className="mb-4 sm:max-w-sm">
        <CampoAvaliacao blocoId={lista.bloco_id} itemTipo="lista_questoes" itemId={lista.id} />
      </div>

      {/* Seletor de status, sempre visível. Só o usuário muda. */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
        <span className="text-sm font-medium">Status</span>
        <div className="flex rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700">
          {STATUS_LISTA.map((s) => (
            <button
              key={s}
              disabled={ocupado}
              onClick={() => void trocarStatus(s)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition disabled:opacity-60',
                status === s
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
              )}
            >
              {ROTULO_STATUS_LISTA[s]}
            </button>
          ))}
        </div>
        <span className="text-xs text-zinc-500 dark:text-zinc-500">Marcado só por você.</span>
      </div>

      {erro && (
        <div className="mb-4">
          <Aviso tom="atencao">{erro}</Aviso>
        </div>
      )}

      {/* Questões, em área de leitura confortável */}
      <div className="max-h-[45vh] overflow-y-auto pr-1">
        {Array.isArray(questoes) ? (
          <ol className="space-y-4">
            {questoes.map((q) => (
              <li key={q.numero} className="flex gap-3">
                <span className="w-6 shrink-0 pt-0.5 text-sm font-semibold text-zinc-400 dark:text-zinc-500">
                  {q.numero}.
                </span>
                <div className="min-w-0">
                  <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{q.enunciado}</p>
                  {/* Em que trecho a questão se apoia — discreto. */}
                  {q.apoio && (
                    <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{textoDoApoio(q.apoio)}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{questoes}</p>
        )}
      </div>

      {/* Gabarito em seção separada, recolhida por padrão */}
      <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        {gabarito == null ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Esta lista não tem gabarito.</p>
        ) : (
          <>
            <button
              className="btn-secundario"
              onClick={() => setMostrarGabarito((v) => !v)}
              aria-expanded={mostrarGabarito}
            >
              <IconeChevron className={cn('h-3.5 w-3.5 transition', mostrarGabarito && 'rotate-90')} />
              {mostrarGabarito ? 'Ocultar gabarito' : 'Mostrar gabarito'}
            </button>

            {mostrarGabarito && (
              <div className="surgir mt-3 max-h-[35vh] overflow-y-auto rounded-lg bg-zinc-50 p-4 dark:bg-zinc-950/40">
                {Array.isArray(gabarito) ? (
                  <ol className="space-y-4">
                    {gabarito.map((g) => (
                      <li key={g.numero} className="flex gap-3">
                        <span className="w-6 shrink-0 pt-0.5 text-sm font-semibold text-zinc-400 dark:text-zinc-500">
                          {g.numero}.
                        </span>
                        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{g.resposta}</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{gabarito}</p>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <button className="btn-perigo" onClick={() => setExcluindo(true)}>
          <IconeLixeira />
          Excluir lista
        </button>
        <button className="btn-primario" onClick={() => void corrigir()} disabled={ocupado}>
          <IconeConversa className="h-4 w-4" />
          Corrigir com a IA
        </button>
      </div>
      <p className="mt-2 text-right text-xs text-zinc-500 dark:text-zinc-500">
        A correção acontece no chat do bloco e não altera o status desta lista.
      </p>

      {excluindo && (
        <div className="surgir mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-900 dark:bg-red-950/30">
          <p className="text-sm text-red-800 dark:text-red-200">
            Excluir "{lista.titulo}"? As evidências já registradas permanecem no log dos tópicos.
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <button className="btn-secundario py-1" onClick={() => setExcluindo(false)}>
              Cancelar
            </button>
            <button className="btn bg-red-600 py-1 text-white hover:bg-red-500" onClick={() => void excluir()}>
              Excluir
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
