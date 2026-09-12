import { useFoco } from '../estado/foco';
import { useSondagem } from '../estado/sondagem';
import { cn, formatarDuracao, relogio } from '../util';
import { IconeMinimizar, IconeRelogio, IconeX } from './ui';

/**
 * Painel em destaque da sessão de foco, e o resumo mostrado ao encerrar.
 * É apenas um registro de tempo: não há bloqueio de sites, abas ou aplicativos.
 */
export function PainelFoco() {
  const { sessao, pausado, focadoMs, painelVisivel, ultimoResumo, pausar, retomar, encerrar, ocultarPainel, dispensarResumo } =
    useFoco();
  const { ativa: sondagemAtiva, minimizada } = useSondagem();

  // A barra da sondagem minimizada também ocupa o rodapé: o painel sobe.
  const baixo = sondagemAtiva && minimizada ? 'bottom-20' : 'bottom-4';

  if (ultimoResumo) {
    return (
      <div className={cn('surgir fixed left-60 z-30 ml-4 max-w-sm', baixo)}>
        <div className="cartao p-4 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Sessão encerrada</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {formatarDuracao(ultimoResumo.focadoMs)}
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {ultimoResumo.blocoNome ? `Bloco: ${ultimoResumo.blocoNome}. ` : ''}
                {ultimoResumo.pausadoMs > 0
                  ? `Tempo total decorrido: ${formatarDuracao(ultimoResumo.decorridoMs)}, com ${formatarDuracao(ultimoResumo.pausadoMs)} em pausa.`
                  : 'Registrado.'}
              </p>
            </div>
            <button className="btn-sutil px-1.5 py-1" onClick={dispensarResumo} aria-label="Dispensar">
              <IconeX />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!sessao || !painelVisivel) return null;

  return (
    <div className={cn('surgir fixed left-60 z-30 ml-4 w-72', baixo)}>
      <div className="cartao p-4 shadow-xl">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <IconeRelogio className="h-3.5 w-3.5" />
              Sessão de foco{pausado ? ' · em pausa' : ''}
            </p>
            {sessao.bloco_nome && (
              <p className="mt-0.5 truncate text-sm font-medium">{sessao.bloco_nome}</p>
            )}
          </div>
          <button
            className="btn-sutil px-1.5 py-1"
            onClick={ocultarPainel}
            aria-label="Ocultar o painel de foco"
            title="Ocultar (a sessão continua)"
          >
            <IconeMinimizar />
          </button>
        </div>

        <p
          className={cn(
            'mt-2 text-4xl font-semibold tabular-nums',
            pausado && 'text-zinc-400 dark:text-zinc-500'
          )}
        >
          {relogio(focadoMs)}
        </p>

        <div className="mt-3 flex gap-2">
          {pausado ? (
            <button className="btn-secundario flex-1 py-1.5" onClick={retomar}>
              Retomar
            </button>
          ) : (
            <button className="btn-secundario flex-1 py-1.5" onClick={pausar}>
              Pausar
            </button>
          )}
          <button className="btn-primario flex-1 py-1.5" onClick={() => void encerrar()}>
            Encerrar
          </button>
        </div>

        <p className="mt-2.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-500">
          Registro voluntário de tempo. A plataforma não bloqueia sites, abas ou aplicativos.
        </p>
      </div>
    </div>
  );
}
