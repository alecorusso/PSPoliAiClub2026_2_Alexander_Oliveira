import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiDocumentos } from '../api';
import type { TipoUso } from '../lib/documentos';

/**
 * "Gerado a partir de: <documentos>", discreto, no item gerado.
 *
 * Um documento excluído aparece como removido — o item continua intacto, e a
 * procedência não some junto com o arquivo.
 */
export function GeradoAPartirDe({
  tipo,
  itemId,
  blocoId,
}: {
  tipo: TipoUso;
  itemId: string;
  /** Para levar ao repositório, onde o documento vive. */
  blocoId: string;
}) {
  const [usos, setUsos] = useState<
    { documento_id: string; nome_arquivo: string | null; removido: boolean }[]
  >([]);

  useEffect(() => {
    apiDocumentos
      .usosDoItem(tipo, itemId)
      .then(setUsos)
      .catch(() => setUsos([]));
  }, [tipo, itemId]);

  if (usos.length === 0) return null;

  return (
    <p className="text-xs text-zinc-400 dark:text-zinc-500">
      Gerado a partir de:{' '}
      {usos.map((u, i) => (
        <span key={u.documento_id}>
          {i > 0 && ', '}
          {u.removido ? (
            <span title="O documento foi excluído; o que ele gerou continua aqui.">
              documento removido
            </span>
          ) : (
            <Link className="underline-offset-2 hover:underline" to={`/blocos/${blocoId}`}>
              {u.nome_arquivo}
            </Link>
          )}
        </span>
      ))}
    </p>
  );
}
