import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, apiAvaliacoes, apiCalendario, apiEntregaveis, apiExclusao, apiListas } from '../api';
import {
  agruparPorData,
  dataVisivel,
  type ItemCalendario,
  type Visao,
} from '../lib/calendario';
import type { ItemCronograma } from '../lib/cronograma';
import { cn, hojeISO } from '../util';
import { Calendario } from '../componentes/Calendario';
import { ListaCronograma } from '../componentes/ListaCronograma';
import { ModalItemCalendario, ModalNovoEvento } from '../componentes/ModaisCalendario';
import { ModalImportarEventos } from '../componentes/ImportarEventos';
import { Carregando, IconeChevron, IconeMais, IconeUpload } from '../componentes/ui';

/**
 * Calendário e cronograma, lado a lado.
 *
 * As duas áreas são separadas de propósito: no calendário não existe arraste —
 * mudar data é decisão consciente, feita pelo modal —, e no cronograma arrastar
 * ajusta a prioridade. O mesmo gesto não pode significar coisas diferentes sem
 * que se veja a fronteira.
 *
 * Elas conversam só por realce: passar o mouse ou clicar de um lado ilumina o
 * outro. Nada desse realce reordena a fila nem muda prioridade.
 */
export function PaginaCalendario() {
  const [itens, setItens] = useState<ItemCalendario[]>([]);
  const [hoje, setHoje] = useState(hojeISO());
  const [carregando, setCarregando] = useState(true);

  const [visao, setVisao] = useState<Visao>('mes');
  const [ancora, setAncora] = useState(hojeISO());
  const [diaSelecionado, setDiaSelecionado] = useState<string | null>(null);

  const [novoEventoEm, setNovoEventoEm] = useState<string | null>(null);
  const [itemAberto, setItemAberto] = useState<ItemCalendario | null>(null);
  const [importando, setImportando] = useState(false);

  // Ligação entre as áreas — só realce.
  const [dataDestacada, setDataDestacada] = useState<string | null>(null);
  const [itemDestacado, setItemDestacado] = useState<string | null>(null);
  // Item sob o cursor no calendário, para realçar o que se liga a ele.
  const [sobOCursor, setSobOCursor] = useState<ItemCalendario | null>(null);

  // Muda quando o cronograma grava algo, para o calendário recarregar (e vice-versa).
  const [versao, setVersao] = useState(0);

  const carregar = useCallback(async () => {
    const d = await apiCalendario.itens();
    setItens(d.itens);
    setHoje(d.hoje);
    setCarregando(false);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar, versao]);

  const porData = useMemo(() => agruparPorData(itens), [itens]);

  /** Dia vazio abre o novo evento; dia com itens filtra o cronograma. */
  const escolherDia = (data: string) => {
    setItemDestacado(null);
    if ((porData.get(data)?.length ?? 0) === 0) {
      setNovoEventoEm(data);
      return;
    }
    setDiaSelecionado((atual) => (atual === data ? null : data));
  };

  const abrirItem = (item: ItemCalendario) => {
    // Clicar num item do calendário realça o mesmo item no cronograma.
    setItemDestacado(`${item.tipo}:${item.id}`);
    setItemAberto(item);
  };

  const mudou = () => setVersao((v) => v + 1);

  // --- ações do modal de item ---
  const reagendar = async (item: ItemCalendario, data: string) => {
    if (item.tipo === 'evento') await apiCalendario.atualizar(item.id, { data_inicio: data });
    else if (item.tipo === 'avaliacao') await apiAvaliacoes.reagendar(item.id, data);
    else if (item.tipo === 'entregavel') await apiEntregaveis.reagendar(item.id, data);
    else if (item.tipo === 'lista') await apiListas.atualizar(item.id, { data_prevista: data });
    else await api.reagendarRevisao(item.id, data);
    mudou();
  };

  const concluir = async (item: ItemCalendario) => {
    // Sem nota, a avaliação é marcada como realizada: a prova aconteceu e o
    // resultado ainda não saiu.
    if (item.tipo === 'avaliacao') await apiAvaliacoes.marcarRealizada(item.id, true);
    else if (item.tipo === 'entregavel') await apiEntregaveis.concluir(item.id, true);
    else if (item.tipo === 'lista') await apiListas.atualizar(item.id, { status: 'completa' });
    else if (item.tipo === 'revisao') await api.concluirRevisao(item.id);
    mudou();
  };

  /** Excluir pelo calendário apaga o item na origem, seja qual for o tipo. */
  const excluir = async (item: ItemCalendario) => {
    await apiExclusao.excluir(item.tipo, item.id);
    mudou();
  };

  // --- ligação vinda do cronograma ---
  const passarNoItem = (item: ItemCronograma | null) => setDataDestacada(item?.prazo ?? null);

  const escolherItemDoCronograma = (item: ItemCronograma) => {
    setItemDestacado(`${item.tipo}:${item.id}`);
    if (!item.prazo) return;
    setDataDestacada(item.prazo);
    // Leva o calendário até a data quando ela está fora da vista.
    if (!dataVisivel(visao, ancora, item.prazo)) setAncora(item.prazo);
  };

  const ligacao = {
    filtroData: diaSelecionado,
    aoLimparFiltroData: () => setDiaSelecionado(null),
    itemDestacado,
    aoPassarNoItem: passarNoItem,
    aoEscolherItem: escolherItemDoCronograma,
  };

  /**
   * Avaliação e atividades que a realizam se realçam uma à outra — o mesmo
   * mecanismo de realce já usado entre o calendário e o cronograma.
   */
  const vinculadosDestacados = useMemo(() => {
    const foco = sobOCursor ?? itens.find((i) => `${i.tipo}:${i.id}` === itemDestacado) ?? null;
    const conjunto = new Set<string>();
    if (!foco) return conjunto;

    if (foco.tipo === 'avaliacao') {
      const vinculados = (foco.detalhe?.itens_vinculados ?? []) as {
        item_tipo: string;
        item_id: string;
      }[];
      for (const v of vinculados) {
        conjunto.add(`${v.item_tipo === 'lista_questoes' ? 'lista' : v.item_tipo}:${v.item_id}`);
      }
      return conjunto;
    }

    const avaliacao = foco.detalhe?.avaliacao as { id: string } | null | undefined;
    if (avaliacao) conjunto.add(`avaliacao:${avaliacao.id}`);
    return conjunto;
  }, [sobOCursor, itemDestacado, itens]);

  const destaques = useMemo(() => {
    const s = new Set<string>();
    if (dataDestacada) s.add(dataDestacada);
    return s;
  }, [dataDestacada]);

  if (carregando) {
    return (
      <div className="px-6 py-6">
        <Carregando />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col lg:flex-row lg:items-stretch">
      {/* Área do calendário */}
      <div className="min-w-0 flex-1 px-6 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">Calendário</h1>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button className="btn-secundario py-1.5" onClick={() => setImportando(true)}>
              <IconeUpload />
              Importar de documento
            </button>
            <button className="btn-primario py-1.5" onClick={() => setNovoEventoEm(diaSelecionado ?? hoje)}>
              <IconeMais />
              Novo evento
            </button>
          </div>
        </div>

        <Calendario
          itens={itens}
          hoje={hoje}
          visao={visao}
          aoMudarVisao={setVisao}
          ancora={ancora}
          aoMudarAncora={setAncora}
          diaSelecionado={diaSelecionado}
          aoEscolherDia={escolherDia}
          aoAbrirItem={abrirItem}
          datasDestacadas={destaques}
          itemDestacado={itemDestacado}
          vinculadosDestacados={vinculadosDestacados}
          aoPassarNoItem={setSobOCursor}
        />
      </div>

      {/* Coluna do cronograma: fundo e borda próprios, porque aqui o arraste
          significa outra coisa. */}
      <ColunaCronograma versao={versao} aoMudar={mudou} ligacao={ligacao} />

      <ModalNovoEvento
        aberto={novoEventoEm !== null}
        dataInicial={novoEventoEm ?? hoje}
        aoFechar={() => setNovoEventoEm(null)}
        aoCriar={mudou}
      />
      <ModalImportarEventos
        aberto={importando}
        itensDoCalendario={itens}
        aoFechar={() => setImportando(false)}
        aoImportar={mudou}
      />
      <ModalItemCalendario
        item={itemAberto}
        aoFechar={() => setItemAberto(null)}
        aoReagendar={reagendar}
        aoConcluir={concluir}
        aoExcluir={excluir}
      />
    </div>
  );
}

/** Coluna fixa no desktop; painel recolhível abaixo do calendário no celular. */
function ColunaCronograma({
  versao,
  aoMudar,
  ligacao,
}: {
  versao: number;
  aoMudar: () => void;
  ligacao: Parameters<typeof ListaCronograma>[0]['ligacao'];
}) {
  const [abertoNoCelular, setAbertoNoCelular] = useState(false);

  return (
    <aside
      aria-label="Cronograma"
      className={cn(
        'shrink-0 border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-900/40',
        'border-t lg:w-96 lg:border-l lg:border-t-0',
        // O calendário é alto: a coluna acompanha a rolagem em vez de sumir.
        'lg:sticky lg:top-0 lg:max-h-screen lg:self-start lg:overflow-y-auto'
      )}
    >
      {/* No celular vira um painel que abre e fecha. */}
      <button
        className="flex w-full items-center gap-2 px-6 py-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 lg:hidden dark:text-zinc-400"
        onClick={() => setAbertoNoCelular((v) => !v)}
        aria-expanded={abertoNoCelular}
      >
        <IconeChevron className={cn('h-3.5 w-3.5 transition', abertoNoCelular && 'rotate-90')} />
        Cronograma
      </button>

      <div className={cn('px-6 pb-6 lg:block lg:pt-6', abertoNoCelular ? 'block' : 'hidden')}>
        <ListaCronograma versao={versao} aoMudar={aoMudar} ligacao={ligacao} />
      </div>
    </aside>
  );
}
