/**
 * Avaliador de fórmulas da média.
 *
 * As variáveis são as próprias avaliações da disciplina (P1, TRABALHO…), e a
 * fórmula é escrita pelo usuário. Nada é interpretado como código: há um
 * analisador próprio, sem `eval` e sem acesso a nada fora da expressão.
 *
 * Aceita: + - * / ^, parênteses, comparações (> >= < <= = <>) e as funções
 * min, max, media, soma, arred, abs, se(condição; então; senão) e
 * soma_maiores/soma_menores(quantidade; ...).
 * Argumentos podem ser separados por ";" ou ",".
 */

export interface VariavelFormula {
  /** Identificador usado na fórmula, ex.: "P1". */
  nome: string;
  /** Título da avaliação de onde veio. */
  rotulo: string;
  /** Nota informada, ou null quando ainda não há. */
  valor: number | null;
}

export type ResultadoFormula =
  | { ok: true; valor: number }
  | { ok: false; erro: string; faltando?: string[] };

// ---------------------------------------------------------------------------
// Nome de variável a partir do título da avaliação
// ---------------------------------------------------------------------------

/** "Trabalho final" -> "TRABALHO_FINAL"; garante unicidade dentro da lista. */
export function nomeDeVariavel(titulo: string, jaUsados: Set<string>) {
  const base =
    titulo
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // tira acentos
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^(?=\d)/, 'V') || 'AVALIACAO';

  let nome = base;
  let n = 2;
  while (jaUsados.has(nome)) nome = `${base}_${n++}`;
  jaUsados.add(nome);
  return nome;
}

// ---------------------------------------------------------------------------
// Análise léxica
// ---------------------------------------------------------------------------
type Tipo = 'numero' | 'nome' | 'operador' | 'abre' | 'fecha' | 'separador';
interface Token {
  tipo: Tipo;
  texto: string;
  posicao: number;
}

const OPERADORES = ['<=', '>=', '<>', '!=', '==', '+', '-', '*', '/', '^', '<', '>', '='];

function tokenizar(entrada: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < entrada.length) {
    const c = entrada[i];

    if (/\s/.test(c)) {
      i++;
      continue;
    }

    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(entrada[i + 1] ?? ''))) {
      // Aceita vírgula decimal quando não está separando argumentos:
      // trocamos por ponto só quando há dígito dos dois lados.
      let j = i;
      while (j < entrada.length && /[0-9]/.test(entrada[j])) j++;
      if ((entrada[j] === '.' || entrada[j] === ',') && /[0-9]/.test(entrada[j + 1] ?? '')) {
        j++;
        while (j < entrada.length && /[0-9]/.test(entrada[j])) j++;
      }
      tokens.push({ tipo: 'numero', texto: entrada.slice(i, j).replace(',', '.'), posicao: i });
      i = j;
      continue;
    }

    if (/[A-Za-zÀ-ÿ_]/.test(c)) {
      let j = i;
      while (j < entrada.length && /[A-Za-zÀ-ÿ0-9_]/.test(entrada[j])) j++;
      tokens.push({ tipo: 'nome', texto: entrada.slice(i, j), posicao: i });
      i = j;
      continue;
    }

    if (c === '(') {
      tokens.push({ tipo: 'abre', texto: c, posicao: i++ });
      continue;
    }
    if (c === ')') {
      tokens.push({ tipo: 'fecha', texto: c, posicao: i++ });
      continue;
    }
    if (c === ';' || c === ',') {
      tokens.push({ tipo: 'separador', texto: ';', posicao: i++ });
      continue;
    }

    const op = OPERADORES.find((o) => entrada.startsWith(o, i));
    if (op) {
      tokens.push({ tipo: 'operador', texto: op, posicao: i });
      i += op.length;
      continue;
    }

    throw new ErroDeFormula(`Caractere inesperado: "${c}".`);
  }

  return tokens;
}

class ErroDeFormula extends Error {}

// ---------------------------------------------------------------------------
// Funções disponíveis
// ---------------------------------------------------------------------------
/** Soma as `quantidade` maiores (ou menores) notas da lista. */
function somarExtremos(valores: number[], quantidade: number, ordem: 'maiores' | 'menores') {
  // Pedir mais do que existe soma tudo; pedir zero ou menos soma nada.
  const k = Math.min(Math.max(Math.trunc(quantidade), 0), valores.length);
  if (k === 0) return 0;
  const ordenados = [...valores].sort((a, b) => (ordem === 'maiores' ? b - a : a - b));
  return ordenados.slice(0, k).reduce((soma, x) => soma + x, 0);
}

interface Funcao {
  minimo: number;
  /** Mostrado no erro quando faltam argumentos. */
  ajuda?: string;
  calcular: (args: number[]) => number;
}

const FUNCOES: Record<string, Funcao> = {
  MIN: { minimo: 1, calcular: (a) => Math.min(...a) },
  MAX: { minimo: 1, calcular: (a) => Math.max(...a) },
  MEDIA: { minimo: 1, calcular: (a) => a.reduce((s, x) => s + x, 0) / a.length },
  SOMA: { minimo: 1, calcular: (a) => a.reduce((s, x) => s + x, 0) },
  ARRED: {
    minimo: 1,
    calcular: ([valor, casas = 0]) => {
      const f = 10 ** Math.trunc(casas);
      return Math.round(valor * f) / f;
    },
  },
  ABS: { minimo: 1, calcular: ([a]) => Math.abs(a) },
  SE: { minimo: 3, calcular: ([cond, entao, senao]) => (cond ? entao : senao) },
  SOMA_MAIORES: {
    minimo: 2,
    ajuda: 'soma_maiores(quantidade; nota1; nota2; …)',
    calcular: ([quantidade, ...valores]) => somarExtremos(valores, quantidade, 'maiores'),
  },
  SOMA_MENORES: {
    minimo: 2,
    ajuda: 'soma_menores(quantidade; nota1; nota2; …)',
    calcular: ([quantidade, ...valores]) => somarExtremos(valores, quantidade, 'menores'),
  },
};

const APELIDOS: Record<string, string> = {
  AVG: 'MEDIA',
  SUM: 'SOMA',
  ROUND: 'ARRED',
  IF: 'SE',
  SOMA_MAX: 'SOMA_MAIORES',
  SOMA_MIN: 'SOMA_MENORES',
  SOMA_TOPO: 'SOMA_MAIORES',
};

export const FUNCOES_DISPONIVEIS = [
  'min',
  'max',
  'media',
  'soma',
  'arred',
  'abs',
  'se',
  'soma_maiores',
  'soma_menores',
];

// ---------------------------------------------------------------------------
// Análise sintática: monta uma árvore (descida recursiva)
//
// A árvore é montada antes de calcular para que `se()` possa avaliar só o ramo
// escolhido — numa regra de substitutiva, o ramo não usado costuma depender de
// uma nota que ainda não existe, e avaliá-lo acusaria falta de nota à toa.
// ---------------------------------------------------------------------------
type No =
  | { t: 'numero'; valor: number }
  | { t: 'variavel'; nome: string; texto: string }
  | { t: 'binario'; op: string; a: No; b: No }
  | { t: 'unario'; op: string; a: No }
  | { t: 'funcao'; nome: string; texto: string; args: No[] };

function analisar(tokens: Token[]): No {
  let pos = 0;
  const atual = () => tokens[pos];
  const consumir = () => tokens[pos++];

  function expressao(): No {
    return comparacao();
  }

  function comparacao(): No {
    const esquerda = soma();
    const t = atual();
    if (t?.tipo === 'operador' && ['<', '>', '<=', '>=', '=', '==', '<>', '!='].includes(t.texto)) {
      consumir();
      return { t: 'binario', op: t.texto, a: esquerda, b: soma() };
    }
    return esquerda;
  }

  function soma(): No {
    let no = produto();
    while (atual()?.tipo === 'operador' && ['+', '-'].includes(atual().texto)) {
      const op = consumir().texto;
      no = { t: 'binario', op, a: no, b: produto() };
    }
    return no;
  }

  function produto(): No {
    let no = potencia();
    while (atual()?.tipo === 'operador' && ['*', '/'].includes(atual().texto)) {
      const op = consumir().texto;
      no = { t: 'binario', op, a: no, b: potencia() };
    }
    return no;
  }

  function potencia(): No {
    const base = unario();
    if (atual()?.tipo === 'operador' && atual().texto === '^') {
      consumir();
      return { t: 'binario', op: '^', a: base, b: potencia() }; // associativo à direita
    }
    return base;
  }

  function unario(): No {
    const t = atual();
    if (t?.tipo === 'operador' && (t.texto === '-' || t.texto === '+')) {
      consumir();
      return { t: 'unario', op: t.texto, a: unario() };
    }
    return primario();
  }

  function primario(): No {
    const t = atual();
    if (!t) throw new ErroDeFormula('A fórmula termina antes do esperado.');

    if (t.tipo === 'numero') {
      consumir();
      return { t: 'numero', valor: Number(t.texto) };
    }

    if (t.tipo === 'abre') {
      consumir();
      const no = expressao();
      if (atual()?.tipo !== 'fecha') throw new ErroDeFormula('Falta fechar um parêntese.');
      consumir();
      return no;
    }

    if (t.tipo === 'nome') {
      consumir();
      const normalizado = t.texto.toUpperCase();
      const nomeFuncao = APELIDOS[normalizado] ?? normalizado;

      if (atual()?.tipo === 'abre') {
        const funcao = FUNCOES[nomeFuncao];
        if (!funcao) throw new ErroDeFormula(`Função desconhecida: "${t.texto}".`);
        consumir();
        const args: No[] = [];
        if (atual()?.tipo !== 'fecha') {
          args.push(expressao());
          while (atual()?.tipo === 'separador') {
            consumir();
            args.push(expressao());
          }
        }
        if (atual()?.tipo !== 'fecha') throw new ErroDeFormula(`Falta fechar o parêntese de "${t.texto}".`);
        consumir();
        if (args.length < funcao.minimo) {
          const quantos = `${funcao.minimo} ${funcao.minimo === 1 ? 'valor' : 'valores'}`;
          throw new ErroDeFormula(
            `"${t.texto}" precisa de pelo menos ${quantos}.` + (funcao.ajuda ? ` Use: ${funcao.ajuda}` : '')
          );
        }
        return { t: 'funcao', nome: nomeFuncao, texto: t.texto, args };
      }

      return { t: 'variavel', nome: normalizado, texto: t.texto };
    }

    throw new ErroDeFormula(`Não esperava "${t.texto}" aqui.`);
  }

  const raiz = expressao();
  if (pos < tokens.length) throw new ErroDeFormula(`Sobrou "${tokens[pos].texto}" no fim da fórmula.`);
  return raiz;
}

// ---------------------------------------------------------------------------
// Avaliação da árvore
// ---------------------------------------------------------------------------
function avaliar(no: No, valores: Map<string, number | null>, faltando: Set<string>): number {
  switch (no.t) {
    case 'numero':
      return no.valor;

    case 'variavel': {
      if (!valores.has(no.nome)) {
        throw new ErroDeFormula(`"${no.texto}" não é uma avaliação nem uma função conhecida.`);
      }
      const valor = valores.get(no.nome);
      if (valor === null || valor === undefined) {
        faltando.add(no.nome);
        return 0; // segue avaliando, para reportar de uma vez tudo que falta
      }
      return valor;
    }

    case 'unario': {
      const valor = avaliar(no.a, valores, faltando);
      return no.op === '-' ? -valor : valor;
    }

    case 'binario': {
      const a = avaliar(no.a, valores, faltando);
      const b = avaliar(no.b, valores, faltando);
      switch (no.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/':
          if (b === 0) throw new ErroDeFormula('Divisão por zero.');
          return a / b;
        case '^': return a ** b;
        case '<': return a < b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        case '=':
        case '==': return a === b ? 1 : 0;
        default: return a !== b ? 1 : 0;
      }
    }

    case 'funcao': {
      // `se` é preguiçosa: só o ramo escolhido é avaliado.
      if (no.nome === 'SE') {
        const condicao = avaliar(no.args[0], valores, faltando);
        return avaliar(condicao ? no.args[1] : no.args[2], valores, faltando);
      }
      const args = no.args.map((a) => avaliar(a, valores, faltando));
      return FUNCOES[no.nome].calcular(args);
    }
  }
}

/**
 * Calcula a fórmula com as notas informadas.
 * Variáveis sem nota não são inventadas: a função devolve quais faltam.
 */
export function calcularFormula(formula: string, variaveis: VariavelFormula[]): ResultadoFormula {
  const texto = formula.trim();
  if (!texto) return { ok: false, erro: 'Escreva uma fórmula.' };

  const valores = new Map(variaveis.map((v) => [v.nome.toUpperCase(), v.valor]));
  const faltando = new Set<string>();

  try {
    const tokens = tokenizar(texto);
    if (tokens.length === 0) return { ok: false, erro: 'Escreva uma fórmula.' };

    const valor = avaliar(analisar(tokens), valores, faltando);

    if (faltando.size > 0) {
      const nomes = [...faltando];
      const rotulos = nomes.map((n) => variaveis.find((v) => v.nome.toUpperCase() === n)?.rotulo ?? n);
      return {
        ok: false,
        faltando: nomes,
        erro:
          rotulos.length === 1
            ? `Falta a nota de ${rotulos[0]}.`
            : `Faltam as notas de ${rotulos.slice(0, -1).join(', ')} e ${rotulos[rotulos.length - 1]}.`,
      };
    }

    if (!Number.isFinite(valor)) return { ok: false, erro: 'O resultado não é um número válido.' };
    return { ok: true, valor };
  } catch (e) {
    return { ok: false, erro: e instanceof ErroDeFormula ? e.message : 'Não consegui interpretar a fórmula.' };
  }
}

/** Confere só a escrita, ignorando notas faltantes. Usado enquanto se digita. */
export function validarFormula(formula: string, variaveis: VariavelFormula[]): string | null {
  const texto = formula.trim();
  if (!texto) return null;
  const comValores = variaveis.map((v) => ({ ...v, valor: v.valor ?? 0 }));
  const r = calcularFormula(texto, comValores);
  return r.ok ? null : r.erro;
}
