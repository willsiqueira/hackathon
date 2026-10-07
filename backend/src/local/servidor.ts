// Servidor local de desenvolvimento: mesma API da Lambda, com tabela em memória carregada do itens.json.
// Autenticação local por token HMAC (só para desenvolvimento; a rota de login local não existe na AWS).
//
//   npm start                                  # http://127.0.0.1:3000
//   PORTA=3001 DATA_REFERENCIA=agora npm start
//   TABELA=Expedientes npm start               # usa o DynamoDB (credenciais AWS no ambiente)

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarApi } from '../api/roteador.js';
import { EmissorTokenLocal } from '../api/autenticacao.js';
import { json, lerCorpoJson, MAX_CORPO_BYTES, respostaDeErro, type Resposta } from '../api/http.js';
import { Repositorio } from '../dados/repositorio.js';
import { TabelaMemoria, carregarItensJson } from '../dados/tabela-memoria.js';
import { publicadorEmProcesso } from '../eventos/notificador.js';
import { criarRelogio, DATA_REFERENCIA_BASE } from '../config.js';
import { ErroValidacao } from '../dominio/erros.js';

const raiz = fileURLToPath(new URL('../../..', import.meta.url)); // raiz do repositório
const PORTA = Number(process.env.PORTA ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';
// Base sintética do kit (cópia única em docs/hackathon-expedientes); pode ser trocada por ITENS_JSON.
const ITENS_JSON = process.env.ITENS_JSON ?? join(raiz, 'docs', 'hackathon-expedientes', 'seed', 'saida', 'dynamodb', 'itens.json');
const FRONTEND_DIST = process.env.FRONTEND_DIST ?? join(raiz, 'frontend', 'dist', 'frontend', 'browser');
const SETORES_DEMO = ['GABSUB3-DVT', 'CIVINT/STIC'];

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
};

async function criarRepositorio(): Promise<Repositorio> {
  if (process.env.TABELA) {
    const { TabelaDynamo } = await import('../dados/tabela-dynamo.js');
    console.log(`Usando DynamoDB: tabela ${process.env.TABELA}`);
    return new Repositorio(new TabelaDynamo(process.env.TABELA));
  }
  const inicio = Date.now();
  const tabela = await carregarItensJson(new TabelaMemoria(), ITENS_JSON);
  console.log(`Carregados ${tabela.tamanho} itens de ${ITENS_JSON} em ${Date.now() - inicio} ms`);
  return new Repositorio(tabela);
}

function lerCorpo(req: IncomingMessage): Promise<string> {
  return new Promise((ok, falha) => {
    const partes: Buffer[] = [];
    let tamanho = 0;
    req.on('data', (parte: Buffer) => {
      tamanho += parte.length;
      if (tamanho > MAX_CORPO_BYTES) {
        falha(new ErroValidacao('Corpo da requisição muito grande.'));
        req.destroy();
      } else partes.push(parte);
    });
    req.on('end', () => ok(Buffer.concat(partes).toString('utf8')));
    req.on('error', falha);
  });
}

function enviar(res: ServerResponse, { status, cabecalhos, corpo }: Resposta): void {
  res.writeHead(status, cabecalhos);
  res.end(corpo);
}

async function servirEstatico(res: ServerResponse, caminho: string): Promise<void> {
  const base = resolve(FRONTEND_DIST);
  let alvo = normalize(join(base, decodeURIComponent(caminho)));
  if (alvo !== base && !alvo.startsWith(base + sep)) return enviar(res, { status: 403, cabecalhos: {}, corpo: '' });
  const info = await stat(alvo).catch(() => null);
  if (!info || info.isDirectory()) alvo = join(base, 'index.html'); // rotas da SPA
  res.writeHead(200, {
    'Content-Type': TIPOS[extname(alvo)] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
  });
  res.end(await readFile(alvo));
}

async function principal(): Promise<void> {
  const repo = await criarRepositorio();
  const relogio = criarRelogio(process.env.DATA_REFERENCIA ?? DATA_REFERENCIA_BASE);
  const emissor = new EmissorTokenLocal();
  const tratar = criarApi({ repo, relogio, eventos: publicadorEmProcesso(repo) });
  const temFrontend = existsSync(join(FRONTEND_DIST, 'index.html'));

  const servidor = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const metodo = req.method ?? 'GET';

      // Rotas exclusivas do modo local: lista de usuários fictícios e emissão de token.
      if (url.pathname === '/api/auth/local/usuarios' && metodo === 'GET') {
        const usuarios = [];
        for (const sigla of SETORES_DEMO) {
          for (const u of await repo.listarUsuariosDoSetor(sigla)) {
            usuarios.push({ idUsuario: u.idUsuario, nome: u.nome, perfil: u.perfil, cargo: u.cargo, siglaSetor: u.siglaSetor });
          }
        }
        return enviar(res, json(200, usuarios));
      }
      if (url.pathname === '/api/auth/local' && metodo === 'POST') {
        const corpo = lerCorpoJson(await lerCorpo(req)) as { idUsuario?: unknown } | undefined;
        const usuario = typeof corpo?.idUsuario === 'string' ? await repo.obterUsuario(corpo.idUsuario) : null;
        if (!usuario || usuario.ativo === false) return enviar(res, json(401, { erro: 'NAO_AUTENTICADO', mensagem: 'Usuário inválido.' }));
        return enviar(res, json(200, { token: emissor.emitir(usuario) }));
      }

      if (url.pathname.startsWith('/api/')) {
        const texto = ['POST', 'PUT', 'PATCH'].includes(metodo) ? await lerCorpo(req) : undefined;
        return enviar(res, await tratar({
          metodo,
          caminho: url.pathname,
          query: Object.fromEntries(url.searchParams),
          corpo: () => lerCorpoJson(texto),
          obterIdentidade: () => emissor.identidadeDoCabecalho(req.headers.authorization),
        }));
      }
      if (temFrontend && metodo === 'GET') return await servirEstatico(res, url.pathname);
      return enviar(res, json(404, { erro: 'NAO_ENCONTRADO', mensagem: 'Rota não encontrada.' }));
    } catch (erro) {
      return enviar(res, respostaDeErro(erro));
    }
  });

  servidor.listen(PORTA, HOST, () => {
    console.log(`API local em http://${HOST}:${PORTA}/api (data de referência ${relogio().toISOString()})`);
    if (temFrontend) console.log(`Frontend publicado em http://${HOST}:${PORTA}/`);
  });
}

principal().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
