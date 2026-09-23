import { useEffect, useState } from 'react';
import { apiVinculos } from '../api';

/**
 * "Vale para a avaliação": liga uma atividade à avaliação que ela realiza.
 *
 * Um item pertence a no máximo uma avaliação — as que já têm dono aparecem
 * assim mesmo, e o servidor recusa a troca com a explicação.
 */
export function CampoAvaliacao({
  blocoId,
  itemTipo,
  itemId,
  rotulo = 'Vale para a avaliação',
}: {
  blocoId: string;
  itemTipo: 'entregavel' | 'lista_questoes';
  /** Null enquanto o item ainda não existe (formulário de criação). */
  itemId: string | null;
  rotulo?: string;
}) {
  const [avaliacoes, setAvaliacoes] = useState<{ id: string; titulo: string }[]>([]);
  const [escolhida, setEscolhida] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    apiVinculos
      .doBloco(blocoId)
      .then((v) => {
        setAvaliacoes(v.avaliacoes);
        const atual = v.vinculos.find((x) => x.item_tipo === itemTipo && x.item_id === itemId);
        setEscolhida(atual?.avaliacao_id ?? '');
      })
      .catch(() => setAvaliacoes([]));
  }, [blocoId, itemTipo, itemId]);

  const mudar = async (id: string) => {
    setEscolhida(id);
    setErro(null);
    if (!itemId) return;
    try {
      await apiVinculos.definirAvaliacao(itemTipo, itemId, id || null);
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  if (avaliacoes.length === 0) return null;

  return (
    <div>
      <label className="rotulo">{rotulo}</label>
      <select
        className="campo"
        value={escolhida}
        onChange={(e) => void mudar(e.target.value)}
        aria-label={rotulo}
      >
        <option value="">Nenhuma</option>
        {avaliacoes.map((a) => (
          <option key={a.id} value={a.id}>
            {a.titulo || 'Avaliação sem nome'}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Vinculada, a avaliação sai do cronograma como item próprio: o trabalho passa a ser este.
      </p>
      {erro && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{erro}</p>}
    </div>
  );
}
