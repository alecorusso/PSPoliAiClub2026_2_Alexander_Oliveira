import { useEffect, useId, useState } from 'react';
import { api } from '../api';
import type { OrigemEstimativa } from '../tipos';

/**
 * Campo de estimativa de tempo com três caminhos de peso visual igual.
 *
 * Nenhum é o padrão: quem sabe quanto tempo leva informa o número, quem não
 * sabe escolhe uma faixa, quem não faz ideia pergunta à IA. A origem é sempre
 * gravada — só 'faixa' e 'exata' alimentam a calibração, porque a estimativa da
 * IA mediria o erro do modelo e não o de quem estuda.
 */

/** Valor representativo de cada faixa, em minutos. */
export const FAIXAS = [
  { rotulo: 'Menos de 1 h', minutos: 45 },
  { rotulo: '1 a 3 h', minutos: 120 },
  { rotulo: '3 a 8 h', minutos: 330 },
  { rotulo: 'Mais de um dia', minutos: 600 },
];

export interface Estimativa {
  /** Minutos, como texto: o campo pode estar vazio. */
  minutos: string;
  origem: OrigemEstimativa | null;
  tipoTarefa: string;
}

export const ESTIMATIVA_VAZIA: Estimativa = { minutos: '', origem: null, tipoTarefa: '' };

export function estimativaDe(
  minutos: number | null,
  origem: OrigemEstimativa | null,
  tipoTarefa: string | null
): Estimativa {
  return {
    minutos: minutos != null ? String(minutos) : '',
    origem,
    tipoTarefa: tipoTarefa ?? '',
  };
}

/** Entregáveis guardam horas; o campo trabalha sempre em minutos. */
export const horasParaMinutos = (h: number | null) => (h != null ? Math.round(h * 60) : null);

export const minutosNumero = (m: string) => {
  const n = Number(m);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

export const minutosParaHoras = (m: string) => {
  const n = minutosNumero(m);
  return n != null ? Math.round((n / 60) * 100) / 100 : null;
};

/** "2 h 30 min" — o usuário pensa em horas, o cálculo trabalha em minutos. */
export function textoDuracao(minutos: number) {
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

type Caminho = 'ia' | 'faixa' | 'exata';

const CAMINHO_DA_ORIGEM: Record<OrigemEstimativa, Caminho> = {
  llm: 'ia',
  faixa: 'faixa',
  exata: 'exata',
};

export function CampoEstimativa({
  valor,
  aoMudar,
  descricao,
  contexto,
  rotulo = 'Tempo estimado',
}: {
  valor: Estimativa;
  aoMudar: (v: Estimativa) => void;
  /** O que a IA precisa ler para estimar: título e descrição da tarefa. */
  descricao: string;
  /** Onde a tarefa vive, para a IA situar o pedido. Ex.: nome do bloco. */
  contexto?: string | null;
  rotulo?: string;
}) {
  const [caminho, setCaminho] = useState<Caminho | null>(
    valor.origem ? CAMINHO_DA_ORIGEM[valor.origem] : null
  );
  const [consultando, setConsultando] = useState(false);
  const [erroIA, setErroIA] = useState<string | null>(null);
  const [tipos, setTipos] = useState<string[]>([]);
  const idTipos = useId();

  useEffect(() => {
    api
      .tiposTarefa()
      .then(setTipos)
      .catch(() => setTipos([]));
  }, []);

  const trocar = (parcial: Partial<Estimativa>) => aoMudar({ ...valor, ...parcial });

  const escolherCaminho = (novo: Caminho) => {
    setErroIA(null);
    setCaminho((atual) => (atual === novo ? null : novo));
    // Trocar de caminho reclassifica a origem do que já está no campo.
    if (novo === 'exata' && valor.minutos) trocar({ origem: 'exata' });
  };

  const perguntarIA = async () => {
    const texto = descricao.trim();
    if (!texto) {
      setErroIA('Escreva o nome da tarefa antes de pedir a estimativa.');
      return;
    }
    setConsultando(true);
    setErroIA(null);
    try {
      const r = await api.estimarTempo(texto, valor.tipoTarefa || null, contexto ?? null);
      // Falha da IA nunca bloqueia: os outros dois caminhos continuam ali.
      if (r.minutos == null) setErroIA(r.erro ?? 'Não foi possível estimar agora.');
      else trocar({ minutos: String(r.minutos), origem: 'llm' });
    } catch (e) {
      setErroIA((e as Error).message);
    } finally {
      setConsultando(false);
    }
  };

  const classeEscolha = (ativo: boolean) =>
    ativo
      ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-500/10 dark:text-indigo-300'
      : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800';

  const botao = (id: Caminho, texto: string) => (
    <button
      type="button"
      onClick={() => escolherCaminho(id)}
      aria-pressed={caminho === id}
      className={'rounded-lg border px-3 py-2 text-sm transition ' + classeEscolha(caminho === id)}
    >
      {texto}
    </button>
  );

  const emMinutos = minutosNumero(valor.minutos);

  return (
    <div className="space-y-2">
      <span className="rotulo block">{rotulo}</span>

      {/* Os três caminhos têm o mesmo peso: nenhum é o recomendado. */}
      <div className="grid gap-2 sm:grid-cols-3">
        {botao('ia', 'Sugerir com IA')}
        {botao('faixa', 'Escolher faixa')}
        {botao('exata', 'Informar tempo exato')}
      </div>

      {caminho === 'ia' && (
        <div className="surgir space-y-2">
          <button className="btn-secundario" onClick={() => void perguntarIA()} disabled={consultando}>
            {consultando ? 'Estimando…' : 'Pedir estimativa'}
          </button>
          {erroIA && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {erroIA} Você pode escolher uma faixa ou informar o tempo.
            </p>
          )}
        </div>
      )}

      {caminho === 'faixa' && (
        <div className="surgir grid gap-2 sm:grid-cols-4">
          {FAIXAS.map((f) => {
            const ativo = valor.origem === 'faixa' && valor.minutos === String(f.minutos);
            return (
              <button
                key={f.rotulo}
                type="button"
                onClick={() => trocar({ minutos: String(f.minutos), origem: 'faixa' })}
                aria-pressed={ativo}
                className={'rounded-lg border px-2 py-1.5 text-xs transition ' + classeEscolha(ativo)}
              >
                {f.rotulo}
              </button>
            );
          })}
        </div>
      )}

      {/* O resultado é sempre editável, venha de onde vier. */}
      {(caminho !== null || valor.minutos !== '') && (
        <div className="surgir flex items-center gap-2">
          <input
            className="campo w-28"
            type="number"
            min={0}
            step={5}
            aria-label="Minutos estimados"
            value={valor.minutos}
            onChange={(e) =>
              trocar({
                minutos: e.target.value,
                // Mexer no número à mão deixa de ser faixa e passa a ser tempo
                // informado; o que veio da IA só perde o rótulo se for editado.
                origem: e.target.value
                  ? valor.minutos === e.target.value
                    ? valor.origem
                    : 'exata'
                  : null,
              })
            }
          />
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            minutos{emMinutos != null && emMinutos >= 60 ? ` · ${textoDuracao(emMinutos)}` : ''}
          </span>
        </div>
      )}

      {valor.origem === 'llm' && valor.minutos !== '' && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Estimativa aproximada, ajuste se necessário.
        </p>
      )}

      <div>
        <label className="rotulo">Tipo de tarefa</label>
        <input
          className="campo"
          list={idTipos}
          value={valor.tipoTarefa}
          onChange={(e) => trocar({ tipoTarefa: e.target.value })}
          placeholder="Ex.: lista, relatório, implementação"
        />
        <datalist id={idTipos}>
          {tipos.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>
    </div>
  );
}
