/**
 * Onde o usuário estava na área de Blocos.
 *
 * Duas memórias, com papéis distintos:
 * - `rota` é o lugar exato (uma pasta OU um bloco aberto). É o que o item
 *   "Blocos" da barra lateral usa, para você voltar de onde saiu.
 * - `pasta` é só a pasta. É o que a própria página de Blocos usa quando alguém
 *   chega em `/blocos` sem parâmetro — ali nunca se entra num bloco sozinho.
 */
const CHAVE_ROTA = 'blocos-ultima-rota';
const CHAVE_PASTA = 'blocos-ultima-pasta';

const ler = (chave: string) => {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
};

const gravar = (chave: string, valor: string | null) => {
  try {
    if (valor) localStorage.setItem(chave, valor);
    else localStorage.removeItem(chave);
  } catch {
    // armazenamento indisponível — a memória vale só para esta navegação
  }
};

export const lerRotaBlocos = () => ler(CHAVE_ROTA);
export const guardarRotaBlocos = (rota: string) => gravar(CHAVE_ROTA, rota);
export const esquecerRotaBlocos = () => gravar(CHAVE_ROTA, null);

export const lerUltimaPasta = () => ler(CHAVE_PASTA);
export const guardarUltimaPasta = (id: string | null) => gravar(CHAVE_PASTA, id);
