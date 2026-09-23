import { useCallback, useEffect, useState } from 'react';
import { apiDocumentos } from '../api';
import type { Documento } from '../lib/documentos';

/** De quanto em quanto tempo a lista é relida enquanto algo está em processamento. */
const INTERVALO_MS = 2000;

/**
 * Documentos do repositório do bloco.
 *
 * Enquanto algum documento está sendo processado no servidor (lendo, dividindo
 * em trechos, indexando), a lista é relida de tempos em tempos para o status
 * andar na tela. Com tudo pronto, para de perguntar.
 */
export function usarDocumentos(blocoId: string) {
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    try {
      setDocumentos(await apiDocumentos.listar(blocoId));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [blocoId]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  // Também enquanto indexa (já pronto): o progresso anda na tela.
  const processando = documentos.some((d) => d.status === 'processando' || d.etapa === 'indexando');
  useEffect(() => {
    if (!processando) return;
    const t = setInterval(() => void recarregar(), INTERVALO_MS);
    return () => clearInterval(t);
  }, [processando, recarregar]);

  return { documentos, carregando, erro, recarregar };
}
