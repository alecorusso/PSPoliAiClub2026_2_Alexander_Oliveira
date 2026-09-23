import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiCronograma } from '../api';
import {
  montarCronograma,
  ORCAMENTO_PADRAO_MIN,
  type DadosCronograma,
  type ItemCronograma,
} from '../lib/cronograma';

/**
 * Busca os dados crus do cronograma e remonta a fila a cada mudança.
 *
 * A fila devolvida é sempre completa: quem corta é a tela. Um ajuste manual não
 * reordena a lista na mão — ele é gravado e a fila é remontada com ele dentro.
 */
export function usarCronograma() {
  const [dados, setDados] = useState<DadosCronograma | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    try {
      setDados(await apiCronograma.dados());
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const fila = useMemo<ItemCronograma[]>(
    () => (dados ? montarCronograma(dados) : []),
    [dados]
  );

  const orcamentoMin = Number(dados?.config?.orcamento_diario_min) || ORCAMENTO_PADRAO_MIN;

  /** Orçamento diário: muda na hora na tela e é gravado em segundo plano. */
  const salvarOrcamento = useCallback(
    async (minutos: number) => {
      setDados((d) =>
        d ? { ...d, config: { ...d.config, orcamento_diario_min: String(minutos) } } : d
      );
      await apiCronograma.salvarConfig({ orcamento_diario_min: minutos });
    },
    []
  );

  const ajustar = useCallback(
    async (item: ItemCronograma, direcao: 'promover' | 'rebaixar', magnitude: number) => {
      await apiCronograma.ajustar(item.tipo, item.id, direcao, magnitude);
      await recarregar();
    },
    [recarregar]
  );

  const restaurar = useCallback(
    async (item: ItemCronograma) => {
      await apiCronograma.removerAjuste(item.tipo, item.id);
      await recarregar();
    },
    [recarregar]
  );

  return { dados, fila, orcamentoMin, carregando, erro, recarregar, salvarOrcamento, ajustar, restaurar };
}
