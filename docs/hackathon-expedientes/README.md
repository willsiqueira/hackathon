# Hackathon: painel unificado de expedientes

Base de dados **sintética** para prototipar um painel unificado/separado dos gerenciadores de expedientes do Único
(Judicial, Documento e Extrajudicial) e uma nova tela inicial. Arquitetura de referência na AWS:
API Gateway + Lambda + Cognito + DynamoDB.

## Origem dos dados

- **Nenhum dado real.** Etiquetas, números, pessoas, datas e textos são fictícios. Os nomes de servidores são
  claramente inventados ("Ana Exemplo", "Bruno Teste"…) e os e-mails usam `@exemplo.org`.
- Os únicos números reais são os **volumes** de expedientes ativos por setor, gerenciador e caixa. Eles vieram de uma
  consulta agregada (`COUNT`) em homologação, para os setores:
  - `GABSUB3-DVT` (unidade 787, concentrador 2624122)
  - `CIVINT/STIC` (unidade 34325, concentrador 17513136)
- As regras de caixa (a receber, no setor, enviados não recebidos) seguem as consultas reais do Único em
  `src/main/java/br/mp/mpf/unico/gerenciador/*/model/*-consultas.xml`.
- Além dos ativos, o gerador cria expedientes `BAIXADO` (histórico recente, cerca de 35% a mais) para alimentar os
  dashboards.

## Estrutura

```text
_labs/hackathon-expedientes/
├── README.md
├── seed/
│   ├── gerar_seed.py            # gerador (Python 3, só biblioteca padrão; boto3 apenas para --carregar)
│   └── saida/
│       ├── csv/*.csv            # 19 arquivos, um por entidade
│       └── dynamodb/itens.json  # todos os itens em DynamoDB JSON (single-table)
└── prototipo/                   # páginas HTML estáticas que demonstram as funcionalidades
    ├── gerar_dados_js.py        # converte os CSVs em dados/dados.js
    ├── dados/dados.js           # window.DADOS (gerado, ~12 MB)
    ├── assets/                  # estilo.css, app.js (núcleo) e um .js por página
    └── *.html                   # index, painel, expediente, foco, prazos, alertas, indicadores, designacao, lotes
```

## Protótipo estático

HTML, CSS e JavaScript puros, sem dependências nem servidor. Abra `prototipo/index.html` direto no navegador
(`file://`). Se a base for regenerada, rode de novo o conversor:

```bash
cd _labs/hackathon-expedientes/seed && python3 gerar_seed.py
cd ../prototipo && python3 gerar_dados_js.py   # use a mesma --data-referencia do gerador, se mudar
```

O "hoje" do protótipo é a data de referência da base (07/10/2026 17:00). O seletor "Usuário simulado", no topo,
troca a pessoa e o setor. Ações, favoritos, filtros salvos, leituras e preferências ficam no `localStorage` (prefixo
`hx:`). Para zerar, use "Apagar dados locais" na página Lotes.

| Página | Funcionalidades | Tabelas usadas |
| --- | --- | --- |
| `index.html` | Nova tela inicial com widgets configuráveis (visibilidade e ordem): contadores TODOS e por gerenciador, próximo expediente, próximos prazos, alertas não lidos, risco, informes, filtros salvos, estoque | contadores, expedientes, notificacoes, noticias, filtros_salvos, estoque_diario |
| `painel.html` | Painel unificado; caixas; busca; filtros avançados; filtros salvos (base e novos); priorização rápida; colunas, ordem, agrupamento e densidade personalizáveis; favoritos; ações em lote com pré-visualização e desfazer; exportação CSV | expedientes, filtros_salvos, preferencias_usuario, marcadores |
| `expediente.html` | Detalhe, composição da prioridade, risco, prazos, designações, marcadores, anotações e histórico filtrável e exportável | movimentacoes, prazos, designacoes, anotacoes, marcadores_expedientes, notificacoes |
| `foco.html` | Fila "próximo expediente" na ordem do GSI2, com atalhos de teclado (N, P, X, A, D) | expedientes |
| `prazos.html` | Calendário mensal por situação do prazo e exportação iCal (.ics) com lembrete | expedientes, preferencias_usuario |
| `alertas.html` | Central de notificações (filtros, marcar como lidas, simulação em tempo real) e prévia do resumo diário por e-mail (SES) | notificacoes, designacoes, expedientes |
| `indicadores.html` | KPIs, estoque diário, fluxo semanal, pendências, cumprimento de prazos, assuntos e produtividade | estoque_diario, prazos, produtividade_diaria |
| `designacao.html` | Sugestão de designação por carga ÷ capacidade e distribuição balanceada em lote | designacoes, produtividade_diaria, expedientes |
| `lotes.html` | Trilha de lotes da sessão (com desfazer) e histórico do setor | acoes_lote |

Regras ilustrativas do protótipo, que no backend real precisam ser aplicadas no servidor:

- Um usuário não abre expedientes de outro setor.
- Um SERVIDOR só vê o conteúdo de um sigiloso se for o responsável.
- O `.ics` não inclui o assunto de expedientes sigilosos.
- O risco de vencimento é `min(100, 20 × (tempoParadoDias + 1) ÷ (diasRestantes + 1))` e só vale para prazos ainda
  não vencidos.

Acessibilidade: cada tabela tem `caption`, `th id` e `td headers`; todo campo tem `label`; os diálogos usam `<dialog>`
nativo, que prende o foco e o devolve ao fechar; avisos saem em `aria-live`; cada gráfico tem uma tabela alternativa;
há link "pular para o conteúdo"; nenhum `tabindex` é positivo. Isso passou numa verificação automática (Chromium
headless), mas a validação completa ainda depende de teste manual com leitor de tela.

## Como usar

### Gerar a base

```bash
cd _labs/hackathon-expedientes/seed
python3 gerar_seed.py                                # "hoje" = 07/10/2026 às 17h (dia do evento, padrão)
python3 gerar_seed.py --data-referencia agora        # "hoje" = momento da execução
python3 gerar_seed.py --data-referencia 2026-10-08   # outra data, se o evento mudar
```

- O padrão já é o dia do hackathon, **07/10/2026**. Vencidos, "vence hoje", "novos 24h" e os alertas são calculados
  em relação a essa data. Se a demo mostrar a data do sistema, prefira exibir datas relativas ("vence em 2 dias").
- Com a mesma semente e a mesma data de referência, a base sai idêntica.
- Os arquivos em `saida/` são sobrescritos.

| Opção | Descrição |
| --- | --- |
| `--data-referencia AAAA-MM-DD` ou `agora` | Data usada como "hoje" às 17h (padrão: `2026-10-07`) |
| `--saida PASTA` | Pasta de saída (padrão: `seed/saida`) |
| `--carregar` | Grava os itens no DynamoDB (precisa de credenciais AWS) |
| `--criar-tabela` | Cria a tabela com `GSI1` e `GSI2` antes de carregar |
| `--tabela NOME` / `--regiao REGIAO` | Padrão: `Expedientes` / `us-east-1` |

### Carregar no DynamoDB

**Opção 1: pelo script.** Use com as credenciais do evento exportadas no terminal. Não commite as credenciais.

```bash
export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_SESSION_TOKEN=...
uv run --no-project --with boto3 python gerar_seed.py \
  --carregar --criar-tabela --tabela Expedientes --regiao us-east-1
```

Sem `uv`: `pip install boto3` e depois `python3 gerar_seed.py ... --carregar`.

**Opção 2: Import from S3 (console).**

1. Envie `saida/dynamodb/itens.json` para um bucket S3.
2. No DynamoDB, escolha *Import from S3*, formato **DynamoDB JSON**, sem compressão.
3. Chaves da tabela: `PK` (String) e `SK` (String).
4. Crie os índices globais `GSI1` (`GSI1PK`, `GSI1SK`) e `GSI2` (`GSI2PK`, `GSI2SK`), todos String, com projeção ALL.

O DynamoDB JSON preserva números e booleanos e omite atributos vazios. Por isso é preferível ao CSV para o DynamoDB.

### Usar os CSVs em outro lugar

- **Formato:** UTF-8, separador vírgula, cabeçalho na primeira linha.
- **Datas e horas:** ISO 8601 com fuso de Brasília (`2026-09-18T11:00:14-03:00`). Datas sem hora vêm como
  `2026-10-24`.
- **Booleanos e listas:** booleanos como `true`/`false`. Listas vêm separadas por `;` (ex.: `marcadores`,
  `idsExpedientes`, `colunasVisiveis`).
- **Excel:** use *Dados → De Texto/CSV* para os acentos saírem corretos.
- **Banco relacional (RDS, Aurora, Athena), pandas etc.:** as tabelas se relacionam por `idExpediente`, `idUsuario`,
  `siglaSetor` e `idRotulo`.

## Domínios principais

| Campo | Valores |
| --- | --- |
| `gerenciador` | `JUDICIAL`, `DOCUMENTO`, `EXTRAJUDICIAL` (equivale ao "Procedimento" do Único) |
| `caixa` | `A_RECEBER`, `NO_SETOR`, `ENVIADO_NAO_RECEBIDO`, `BAIXADO` (histórico; filtre `caixa != BAIXADO` no painel) |
| `statusPrazo` | `VENCIDO`, `VENCE_HOJE`, `CRITICO` (1–3 dias), `ATENCAO` (4–7 dias), `NO_PRAZO`, `CUMPRIDO`, `CUMPRIDO_COM_ATRASO` |
| `prioridade` | `CRITICA` (≥60 pontos), `ALTA` (≥35), `MEDIA` (≥20), `BAIXA` |
| `tipoPrazo` | `PROCESSUAL` (judicial), `RESPOSTA` (documento), `TRAMITACAO` (extrajudicial, conforme a classe CNMP) |
| `tipoResponsabilidade` | `TITULAR` (titular do ofício ou setor) ou `DESIGNADO` (designação ativa) |
| `perfil` (usuário) | `MEMBRO`, `CHEFE`, `SERVIDOR` |

A `pontuacaoPrioridade` (0–100) soma estas parcelas:

- Prazo: vencido 50, vence hoje 45, crítico 35, atenção 20, no prazo 5.
- Urgência legal (réu preso, idoso, liminar…): +30.
- Nova intimação: +10.
- Parado há mais de 30 dias: +10.
- Aguardando assinatura: +5.

Se o expediente estiver em "enviado não recebido", o total é dividido por 2. A lista completa de códigos, descrições e
cores está em `catalogos.csv`.

## Arquivos CSV

As quantidades são aproximadas (referência 07/10/2026). Elas variam um pouco com `--data-referencia`, exceto os volumes
ativos por caixa, que são fixos.

| Arquivo | Linhas | Funcionalidade |
| --- | --- | --- |
| `expedientes.csv` | ~4.100 | Painel unificado, filtros, priorização, prazos |
| `movimentacoes.csv` | ~23.500 | Histórico e rastreabilidade |
| `prazos.csv` | ~4.300 | Acompanhamento de prazos |
| `designacoes.csv` | ~2.000 | Designados para mim, carga por servidor |
| `anotacoes.csv` | ~3.900 | Detalhe do expediente |
| `marcadores.csv` | 22 | Marcadores do setor |
| `marcadores_expedientes.csv` | ~1.200 | Filtro por marcador |
| `favoritos.csv` | 30 | Favoritos |
| `notificacoes.csv` | ~7.900 | Alertas e notificações |
| `acoes_lote.csv` | ~50 | Ações em lote |
| `preferencias_usuario.csv` | 48 | Personalização |
| `filtros_salvos.csv` | ~35 | Personalização, pesquisa avançada |
| `contadores.csv` | 7 | Tela inicial, badges |
| `estoque_diario.csv` | 450 | Dashboards (volume e tendência) |
| `produtividade_diaria.csv` | ~1.400 | Dashboards (produtividade) |
| `usuarios.csv` | 14 | Login (Cognito), "meus" |
| `setores.csv` | 2 | Contexto do setor |
| `noticias.csv` | 4 | Informes da tela inicial |
| `catalogos.csv` | 126 | Selects, legendas e cores |

### `expedientes.csv`

Uma linha por expediente, com **o mesmo esquema para os três gerenciadores**.

| Grupo | Colunas |
| --- | --- |
| Identificação | `idExpediente`, `gerenciador`, `siglaSetor`, `etiqueta`, `numeroReferencia` (ex.: `HC 1.481.458/DF`), `classe`, `descricaoClasse`, `assunto`, `tema` (área/câmara), `resumo`, `orgaoOrigem`, `tipoEntrada` |
| Localização e fluxo | `caixa`, `situacao` (ex.: `EM_ANALISE`, `MINUTA_EM_ELABORACAO`, `AGUARDANDO_ASSINATURA`), `acaoPendente` (texto para o usuário), `requerAcao` (true em A_RECEBER e NO_SETOR), `setorOrigem`, `setorDestino` |
| Datas | `dataAutuacao` ≤ `dataChegada` ≤ `dataRecebimento` ≤ `dataUltimaMovimentacao`; `diasNoSetor`, `tempoParadoDias` |
| Prazo | `tipoPrazo`, `dataInicioPrazo`, `dataPrazo`, `duracaoPrazoDias`, `diasRestantes` (negativo = vencido; nos baixados é a folga na saída), `statusPrazo` |
| Prioridade | `prioridade`, `pontuacaoPrioridade`, `urgente`, `motivoUrgencia` (`Nenhum` quando não há), `reuPreso`, `idoso`, `novaIntimacao`, `novo` (chegou há menos de 24h) |
| Responsável | `idResponsavel`, `nomeResponsavel`, `tipoResponsabilidade`, `oficioResponsavel`, `designado` |
| Outros | `eletronico`, `nivelSigilo` (0 = público), `sigiloso`, `favorito`, `marcadores` (`;`), `qtdMarcadores`, `qtdAnotacoes`, `qtdMinutasPendentes`, `qtdMovimentacoes` |

Só há dois vazios, ambos intencionais:

- `dataRecebimento`, apenas em `A_RECEBER`, porque o expediente ainda não foi recebido.
- `marcadores`, quando o expediente não tem marcador.

### `movimentacoes.csv`

Linha do tempo de cada expediente, em ordem cronológica. Colunas: `idMovimentacao`, `idExpediente`, `etiqueta`,
`gerenciador`, `siglaSetor`, `dataHora`, `tipoMovimentacao`, `idUsuario` (`EXTERNO` para ações fora do setor),
`nomeUsuario`, `setorOrigem`, `setorDestino`, `descricao`.

Valores de `tipoMovimentacao`:

- Entrada no setor: `CADASTRO`, `ENVIO_AO_SETOR`, `RECEBIMENTO`
- Trabalho no setor: `DESIGNACAO`, `MARCADOR_INCLUIDO`, `ANOTACAO_INCLUIDA`, `MINUTA_CRIADA`, `ASSINATURA`,
  `PRAZO_PRORROGADO`
- Saída: `ENVIO_PELO_SETOR`, `ARQUIVAMENTO`

A última movimentação de cada expediente coincide com `expedientes.dataUltimaMovimentacao`.

### `prazos.csv`

Prazo atual de cada expediente e os prazos anteriores que foram prorrogados. Colunas: `idPrazo`, `idExpediente`,
`etiqueta`, `gerenciador`, `siglaSetor`, `tipoPrazo`, `dataInicio`, `dataPrazo`, `duracaoDias`, `situacao`,
`dataEncerramento`, `diasAtraso`.

- `situacao`: `ABERTO`, `PRORROGADO`, `CUMPRIDO_NO_PRAZO` ou `CUMPRIDO_COM_ATRASO`.
- `dataEncerramento` fica vazio quando o prazo está `ABERTO`.
- `diasAtraso` só é maior que zero em prazo vencido (aberto) ou cumprido com atraso.

### `designacoes.csv`

Colunas: `idDesignacao`, `idExpediente`, `etiqueta`, `gerenciador`, `siglaSetor`, `idUsuarioDesignado`, `nomeDesignado`,
`idUsuarioDesignador`, `nomeDesignador`, `dataDesignacao`, `prazoDevolucao`, `diasParaDevolucao`, `situacao`,
`statusDevolucao`, `dataFim`.

- `situacao`: `ATIVA` ou `ENCERRADA`.
- `statusDevolucao`: `NO_PRAZO` e `VENCIDA` para as ativas; `DEVOLVIDA_NO_PRAZO` e `DEVOLVIDA_COM_ATRASO` para as
  encerradas.
- `dataFim` fica vazio quando a designação está `ATIVA`.

### `anotacoes.csv`

Anotações livres (textos fictícios). Colunas: `idAnotacao`, `idExpediente`, `etiqueta`, `gerenciador`, `siglaSetor`,
`idUsuario`, `nomeUsuario`, `dataHora`, `texto`.

### `marcadores.csv` e `marcadores_expedientes.csv`

- **`marcadores.csv`** traz os marcadores de cada setor por gerenciador. Colunas: `idRotulo`, `siglaSetor`,
  `gerenciador`, `descricao`, `cor` (hexadecimal), `finalizarNaSaida`, `qtdExpedientes`.
- **`marcadores_expedientes.csv`** faz o vínculo entre marcador e expediente (N:N). Colunas: `idRotulo`, `descricao`,
  `cor`, `idExpediente`, `etiqueta`, `gerenciador`, `siglaSetor`, `idUsuario`, `dataInclusao`.

### `favoritos.csv`

Favoritos do setor. Colunas: `siglaSetor`, `idExpediente`, `etiqueta`, `gerenciador`, `idUsuario`, `nomeUsuario`,
`dataInclusao`.

### `notificacoes.csv`

Alertas por usuário, em ordem cronológica. Colunas: `idNotificacao`, `idUsuario`, `siglaSetor`, `idExpediente`,
`etiqueta`, `gerenciador`, `tipoNotificacao`, `severidade` (`CRITICO`, `ATENCAO`, `INFO`), `titulo`, `mensagem`,
`dataHora`, `lida`, `link`.

| `tipoNotificacao` | Quando é gerada |
| --- | --- |
| `NOVO_EXPEDIENTE` | Expediente chegou ao setor (a receber) |
| `NOVA_INTIMACAO` | Judicial com intimação nova |
| `PRAZO_VENCIDO` / `PRAZO_VENCE_HOJE` / `PRAZO_PROXIMO` | Situação do prazo (próximo = 3 ou 7 dias antes) |
| `DESIGNACAO` / `DEVOLUCAO_VENCIDA` | Expediente designado ao usuário, ou prazo de devolução vencido |
| `ALTERACAO` | Outro usuário incluiu marcador ou anotação, ou prorrogou prazo (últimos 30 dias) |
| `ENVIO_PENDENTE` | Enviado há 5 dias ou mais e ainda não recebido pelo destino |

### `acoes_lote.csv`

Log de operações em lote. Colunas: `idLote`, `siglaSetor`, `idUsuario`, `nomeUsuario`, `tipoAcao`, `parametros`,
`dataHora`, `qtdExpedientes`, `qtdSucesso`, `qtdFalhas`, `resultado`, `gerenciadores` (`;`), `idsExpedientes` (`;`).

- `tipoAcao`: `RECEBER`, `DESIGNAR`, `INCLUIR_MARCADOR`, `MOVIMENTAR`, `DAR_CIENCIA`, `ASSINAR` ou `ARQUIVAR`.
- `resultado`: `SUCESSO` ou `PARCIAL`.

### `preferencias_usuario.csv`

Uma linha por usuário e contexto. `contexto` pode ser `PAINEL_UNIFICADO` ou o nome de um gerenciador do setor.

Colunas: `idUsuario`, `siglaSetor`, `contexto`, `colunasVisiveis` (nomes de colunas de `expedientes`, separados por `;`),
`ordenacaoCampo`, `ordenacaoDirecao`, `itensPorPagina`, `caixaInicial`, `agruparPor`, `densidade`, `tema`,
`notificarPorEmail`, `antecedenciaAlertaPrazoDias`.

### `filtros_salvos.csv`

Colunas: `idFiltro`, `idUsuario`, `siglaSetor`, `nome`, `criterios`, `ordenacao` (`campo:asc|desc`), `padrao`,
`compartilhadoComSetor`, `dataCriacao`.

`criterios` é um JSON cujas chaves são colunas de `expedientes`. Um valor em lista significa "um destes". O sufixo `Min`
indica "maior ou igual a". Exemplo:

```json
{"statusPrazo": ["VENCIDO", "VENCE_HOJE", "CRITICO"]}
{"gerenciador": ["JUDICIAL"], "urgente": true}
{"tempoParadoDiasMin": 30}
```

### `contadores.csv`

Totais atuais por setor e gerenciador, mais uma linha `gerenciador = TODOS` para o painel unificado e a tela inicial.

Colunas: `siglaSetor`, `gerenciador`, `aReceber`, `noSetor`, `enviadosNaoRecebidos`, `designados`, `favoritos`,
`vencidos`, `venceHoje`, `criticos`, `atencao`, `urgentes`, `prioridadeCritica`, `novos24h`, `parados30dias`,
`minutasPendentes`, `baixados30dias`.

Os indicadores de prazo e urgência consideram só os expedientes que exigem ação (A_RECEBER e NO_SETOR).

### `estoque_diario.csv`

Série dos últimos 90 dias por setor e gerenciador. Colunas: `data`, `siglaSetor`, `gerenciador`, `entradas`,
`recebimentos`, `saidas`, `aReceber`, `noSetor`, `vencidos`.

A série é calculada a partir das datas dos expedientes. O último dia coincide com `contadores.csv`.

### `produtividade_diaria.csv`

Ações por servidor e dia, agregadas de `movimentacoes.csv` (só aparecem dias com alguma ação).

Colunas: `data`, `siglaSetor`, `gerenciador`, `idUsuario`, `nomeUsuario`, `recebimentos`, `designacoes`, `marcadores`,
`anotacoes`, `minutas`, `assinaturas`, `prorrogacoes`, `envios`, `arquivamentos`, `prazosCumpridosNoPrazo`,
`prazosCumpridosComAtraso`, `totalAcoes`.

### `usuarios.csv` e `setores.csv`

- **`usuarios.csv`** traz servidores fictícios que podem ser cadastrados no Cognito. Guarde `idUsuario` e `siglaSetor`
  como atributos customizados. Colunas: `idUsuario`, `nome`, `siglaSetor`, `perfil`, `cargo`, `email`, `ativo`,
  `dataUltimoAcesso`.
- **`setores.csv`** tem as colunas `siglaSetor`, `idUnidadeOrganica`, `idConcentrador`, `nome`, `tipoSetor`, `oficio`,
  `gerenciadores` (`;`) e `qtdUsuarios`.

### `noticias.csv`

Informes da tela inicial. Colunas: `idNoticia`, `titulo`, `categoria`, `conteudo`, `prioridade` (1 = maior), `destaque`,
`dataInicioExibicao`, `dataFimExibicao`.

### `catalogos.csv`

Tabela de domínios para selects, legendas e badges. Colunas: `dominio`, `codigo`, `descricao`, `ordem`, `cor`.

Domínios disponíveis:

- Gerais: `GERENCIADOR`, `CAIXA`, `SITUACAO`, `STATUS_PRAZO`, `PRIORIDADE`, `SEVERIDADE`, `TIPO_PRAZO`
- Eventos e ações: `TIPO_MOVIMENTACAO`, `TIPO_NOTIFICACAO`, `TIPO_ACAO_LOTE`
- Por gerenciador: `CLASSE_<GERENCIADOR>`, `ASSUNTO_<GERENCIADOR>`, `TEMA_<GERENCIADOR>`

## Modelo DynamoDB (`dynamodb/itens.json`)

É uma tabela única com os índices `GSI1` e `GSI2`. Cada item tem o atributo `entidade`, com o nome do CSV de origem, e
os mesmos campos do CSV correspondente.

| Padrão de acesso | Chave |
| --- | --- |
| Painel unificado do setor | `GSI1PK = SETOR#<sigla>` e `begins_with(GSI1SK, "ATIVO#")` |
| Aba de um gerenciador/caixa | `GSI1PK = SETOR#<sigla>` e `begins_with(GSI1SK, "ATIVO#JUD#A_RECEBER#")` (`JUD`, `DOC`, `EXT`) |
| Histórico de baixados | `GSI1PK = SETOR#<sigla>` e `begins_with(GSI1SK, "HIST#")` |
| Fila por prazo e prioridade | `GSI2PK = SETOR#<sigla>`: ordenado por data do prazo e, em seguida, pela prioridade maior |
| Detalhe completo do expediente | `PK = EXP#<id>`, que retorna `META`, `MOV#`, `PRZ#`, `DES#`, `ANO#` e `ROT#` |
| Designados para mim | `GSI1PK = USR#<id>` e `begins_with(GSI1SK, "DES#ATIVA#")` |
| Histórico de ações do usuário | `GSI1PK = USR#<id>` e `begins_with(GSI1SK, "MOV#")` |
| Notificações, preferências, filtros, lotes | `PK = USR#<id>` com SK `NOT#`, `PREF#`, `FILTRO#`, `LOTE#` |
| Contadores, estoque, produtividade, marcadores, favoritos | `PK = SETOR#<sigla>` com SK `CONT#`, `EST#`, `PROD#`, `ROT#`, `FAV#` |
| Expedientes de um marcador | `GSI1PK = ROT#<idRotulo>` |
| Informes e catálogos | `PK = NOTICIA`; `PK = CATALOGO#<dominio>` |

## Cuidados

- Só use esta base sintética fora da rede do MPF. **Não exporte dados reais de homologação ou de produção** para contas
  AWS de evento (LGPD e sigilo).
- A pasta `_labs/` não está no `.gitignore` do Único. Não a inclua em commits de branches do sistema.
- Não coloque credenciais AWS em arquivos desta pasta.
