// Roteador da API, independente de transporte (Lambda ou servidor local).
// Toda rota exige identidade; setor e perfil vêm do cadastro do usuário.

import * as expedientes from './handlers/expedientes.js';
import * as ia from './handlers/ia.js';
import * as inicio from './handlers/inicio.js';
import * as lotes from './handlers/lotes.js';
import * as usuario from './handlers/usuario.js';
import { indicadores } from './handlers/indicadores.js';
import { carregarUsuario, type Identidade } from './autenticacao.js';
import { json, respostaArquivo, respostaDeErro, registrarErro, type Arquivo, type Resposta } from './http.js';
import { ErroNaoEncontrado, ErroProibido } from '../dominio/erros.js';
import type { ComStatus, Contexto, Handler } from './contexto.js';
import type { Repositorio } from '../dados/repositorio.js';
import type { PublicadorEventos } from '../eventos/eventos.js';
import { CacheCurto, ModeloDemonstracao, type Ia } from '../servicos/ia.js';

type Metodo = 'GET' | 'POST' | 'PUT' | 'DELETE';

const DEFINICOES: [Metodo, string, Handler][] = [
  ['GET', '/api/me', inicio.me],
  ['GET', '/api/inicio', inicio.inicio],
  ['GET', '/api/resumo-diario', inicio.resumoDiario],
  ['GET', '/api/catalogos', inicio.catalogos],
  ['GET', '/api/usuarios', inicio.usuarios],
  ['GET', '/api/marcadores', inicio.marcadores],
  ['GET', '/api/expedientes', expedientes.listar],
  ['GET', '/api/expedientes/exportar', expedientes.exportar],
  ['GET', '/api/expedientes/:id', expedientes.detalhar],
  ['GET', '/api/expedientes/:id/historico.csv', expedientes.exportarHistorico],
  ['GET', '/api/fila', expedientes.fila],
  ['GET', '/api/prazos.ics', expedientes.calendarioIcs],
  ['POST', '/api/lotes/previa', lotes.previaLote],
  ['POST', '/api/lotes', lotes.executarLote],
  ['GET', '/api/lotes', lotes.listarLotes],
  ['POST', '/api/lotes/:id/desfazer', lotes.desfazerLote],
  ['GET', '/api/designacao/sugestao', lotes.sugestaoDesignacao],
  ['GET', '/api/filtros', usuario.listarFiltros],
  ['POST', '/api/filtros', usuario.criarFiltro],
  ['PUT', '/api/filtros/:id', usuario.atualizarFiltro],
  ['DELETE', '/api/filtros/:id', usuario.excluirFiltro],
  ['GET', '/api/preferencias/:contexto', usuario.obterPreferencias],
  ['PUT', '/api/preferencias/:contexto', usuario.salvarPreferencias],
  ['GET', '/api/notificacoes', usuario.listarNotificacoes],
  ['POST', '/api/notificacoes/lidas', usuario.marcarLidas],
  ['GET', '/api/indicadores', indicadores],
  ['POST', '/api/ia/busca', ia.busca],
  ['POST', '/api/ia/resumo-dia', ia.resumoDia],
];

const ROTAS = DEFINICOES.map(([metodo, padrao, handler]) => {
  const nomes: string[] = [];
  const corpo = padrao.replace(/\./g, '\\.').replace(/:(\w+)/g, (_, nome: string) => {
    nomes.push(nome);
    return '([^/]+)';
  });
  return { metodo, regex: new RegExp(`^${corpo}$`), nomes, handler };
});

function encontrarRota(metodo: string, caminho: string) {
  let caminhoExiste = false;
  for (const rota of ROTAS) {
    const achou = rota.regex.exec(caminho);
    if (!achou) continue;
    caminhoExiste = true;
    if (rota.metodo !== metodo) continue;
    const params = Object.fromEntries(rota.nomes.map((nome, i) => [nome, decodeURIComponent(achou[i + 1])]));
    return { rota, params };
  }
  return caminhoExiste ? 'METODO_NAO_PERMITIDO' : null;
}

const ehArquivo = (r: unknown): r is Arquivo => typeof r === 'object' && r !== null && (r as Arquivo).arquivo === true;
const ehComStatus = (r: unknown): r is ComStatus => typeof r === 'object' && r !== null && (r as ComStatus).comStatus === true;

export interface Requisicao {
  metodo: string;
  caminho: string;
  query?: Record<string, string | undefined>;
  /** Lido só depois da autenticação. */
  corpo?: () => unknown;
  obterIdentidade: () => Identidade | Promise<Identidade>;
}

export interface Dependencias {
  repo: Repositorio;
  relogio: () => Date;
  eventos: PublicadorEventos;
  registrar?: (erro: unknown) => void;
  /** Padrão: modo demonstração (sem rede), para testes e servidor local sem credenciais. */
  ia?: Ia;
}

export function criarApi({
  repo, relogio, eventos, registrar = registrarErro,
  ia: modeloIa = { modelo: new ModeloDemonstracao(), origem: 'demonstracao', cache: new CacheCurto() },
}: Dependencias) {
  return async function tratar(req: Requisicao): Promise<Resposta> {
    try {
      // Identidade antes de qualquer resposta (inclusive 404), para não revelar rotas a anônimos.
      const identidade = await req.obterIdentidade();
      const encontrada = encontrarRota(req.metodo, req.caminho);
      if (!encontrada) throw new ErroNaoEncontrado('Rota não encontrada.');
      if (encontrada === 'METODO_NAO_PERMITIDO') return json(405, { erro: 'METODO_NAO_PERMITIDO', mensagem: 'Método não permitido.' });
      const usuarioAutenticado = await carregarUsuario(repo, identidade);
      const setor = await repo.obterSetor(usuarioAutenticado.siglaSetor);
      if (!setor) throw new ErroProibido('Setor do usuário não cadastrado.');
      const ctx: Contexto = {
        repo, eventos, ia: modeloIa, agora: relogio(), usuario: usuarioAutenticado, setor,
        params: encontrada.params, query: req.query ?? {}, corpo: req.corpo?.(),
      };
      const resultado = await encontrada.rota.handler(ctx);
      if (ehArquivo(resultado)) return respostaArquivo(resultado);
      if (ehComStatus(resultado)) {
        if (resultado.status === 204) return { status: 204, cabecalhos: { 'Cache-Control': 'no-store' }, corpo: '' };
        return json(resultado.status, resultado.corpo);
      }
      return json(200, resultado);
    } catch (erro) {
      return respostaDeErro(erro, registrar);
    }
  };
}
