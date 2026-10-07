# Requisitos: painel de expedientes do gabinete e nova tela inicial

## Introdução

MVP que reúne numa só tela os expedientes dos gerenciadores Judicial, Documento e Extrajudicial do Único, com foco nos
processos judiciais do gabinete, e uma nova tela inicial com o resumo do dia. Os dados são sintéticos
(`docs/hackathon-expedientes/seed/saida/dynamodb/itens.json`); não há integração com o Único. Ações (receber, designar, arquivar…) só alteram os
dados da própria solução.

Referências, em `docs/hackathon-expedientes/`: `caso-de-uso-hackathon.md` (F1–F10, RN1–RN7),
`instrucoes-hackathon.md` (RF01–RF19 e requisitos não funcionais), `README.md` (dicionário de dados e modelo DynamoDB)
e `criterios-avaliacao-hackathon.html` (critérios da banca).

Data de referência ("hoje"): 07/10/2026 17h (−03:00), configurável por `DATA_REFERENCIA`.

## Glossário

- **Expediente**: processo judicial, documento ou procedimento extrajudicial (`entidade = expedientes`).
- **Caixa**: `A_RECEBER`, `NO_SETOR`, `ENVIADO_NAO_RECEBIDO`, `BAIXADO`.
- **Ativo**: expediente fora da caixa `BAIXADO`.
- **Fila**: expedientes ativos que exigem ação (`A_RECEBER` e `NO_SETOR`), na ordem da RN3.
- **Usuário**: pessoa fictícia de `usuarios.csv`, com perfil `MEMBRO`, `CHEFE` ou `SERVIDOR` e um setor.

## Requisitos

### Requisito 1: autenticação e autorização (RNF Segurança, RN6)

**História:** Como usuário, quero entrar com minha conta fictícia, para ver só o que é do meu setor.

1. QUANDO o usuário não estiver autenticado, O sistema DEVE recusar qualquer chamada à API com HTTP 401.
2. O sistema DEVE autenticar pelo Cognito na AWS e, no modo local de desenvolvimento, por um token assinado emitido
   pelo servidor local.
3. O sistema DEVE obter identidade, setor e perfil das claims do Cognito (`custom:idUsuario`, `custom:siglaSetor` e
   grupo), nunca de parâmetros enviados pela tela, e DEVE recusar com HTTP 403 quando as claims divergirem do cadastro.
4. QUANDO o usuário pedir um expediente de outro setor, O sistema DEVE responder HTTP 403.
5. QUANDO um SERVIDOR pedir um expediente sigiloso (`nivelSigilo > 0`) do qual não é o responsável, O sistema DEVE
   omitir assunto, resumo, número de referência, órgão de origem, anotações e descrições do histórico, informando que
   o conteúdo é restrito.
6. O sistema NÃO DEVE incluir o conteúdo de expedientes sigilosos em exportações CSV e arquivos `.ics`, qualquer que seja
   o perfil.

### Requisito 2: painel unificado ou por gerenciador (F1, RF01, RF02, RN7)

**História:** Como servidor, quero ver os expedientes do gabinete numa lista única, para não abrir três telas.

1. O sistema DEVE listar os expedientes ativos do setor do usuário dos três gerenciadores numa só tabela.
2. O sistema DEVE permitir alternar entre "Todos" e cada gerenciador presente no setor.
3. O sistema DEVE separar os expedientes nas caixas A receber, No setor e Enviados não recebidos, cada uma com contador
   que respeita os demais filtros.
4. O sistema NÃO DEVE exibir expedientes `BAIXADO` no painel nem nos contadores (eles aparecem só nos indicadores).
5. O sistema DEVE paginar a lista e permitir escolher itens por página (10, 25, 50, 100).

### Requisito 3: pesquisa e filtros (F2, RF03)

**História:** Como servidor, quero filtrar por prazo, prioridade, assunto, classe, data e urgência, para achar o que
precisa de ação.

1. O sistema DEVE pesquisar por texto livre em etiqueta, número de referência, assunto, resumo, classe e responsável.
2. O sistema DEVE filtrar por situação do prazo, prioridade, responsável, assunto, classe, tema, situação, marcador,
   período de chegada, período de prazo, tempo parado mínimo e sinalizações (urgente, réu preso, idoso, nova intimação,
   sigiloso, favorito, designado a mim).
3. QUANDO um filtro tiver vários valores, O sistema DEVE aceitar qualquer um deles ("um destes").
4. O sistema DEVE aplicar os filtros no backend.

### Requisito 4: priorização e selos de prazo (F3, RF06, RF07, RN1, RN2, RN3)

**História:** Como membro, quero a lista ordenada por prazo e prioridade, com selo de prazo, para saber o que fazer
primeiro.

1. O sistema DEVE classificar o prazo pelos dias restantes: < 0 vencido; 0 vence hoje; 1 a 3 crítico; 4 a 7 atenção;
   > 7 no prazo.
2. O sistema DEVE calcular a pontuação: prazo (50, 45, 35, 20, 5), urgente +30, nova intimação +10, parado há mais de
   30 dias +10, aguardando assinatura +5; enviados não recebidos valem metade (divisão inteira); máximo 100.
3. O sistema DEVE classificar a prioridade em crítica (≥ 60), alta (≥ 35), média (≥ 20) ou baixa.
4. O sistema DEVE ordenar a fila por data do prazo crescente e, no empate, pela pontuação decrescente; essa é a ordem
   padrão do painel.
5. O sistema DEVE exibir a situação do prazo e a prioridade com texto e cor, sem depender só da cor.
6. O sistema DEVE mostrar a composição da pontuação de cada expediente (por que recebeu aquela prioridade).
7. O sistema DEVE permitir ordenar por qualquer coluna visível.
8. O sistema DEVE calcular o risco de vencimento `min(100, 20 × (tempoParado + 1) ÷ (diasRestantes + 1))` apenas para
   prazos não vencidos (RF08).

### Requisito 5: tela inicial (F4, RF18, RF19)

**História:** Como usuário, quero uma tela inicial com contadores, próximos prazos e alertas, para começar o dia.

1. O sistema DEVE mostrar contadores do setor para "Todos" e para cada gerenciador: a receber, no setor, enviados não
   recebidos, vencidos, vencem hoje, críticos, urgentes, designados a mim e novos em 24h.
2. O sistema DEVE mostrar os próximos prazos (prazos não vencidos, na ordem da fila), o próximo expediente da fila, os
   alertas não lidos e os informes vigentes.
3. QUANDO o usuário acionar um contador, O sistema DEVE abrir o painel com o filtro correspondente.
4. O sistema DEVE permitir esconder, mostrar e reordenar os widgets, guardando a escolha por usuário.

### Requisito 6: detalhe e histórico (F5, RF13)

**História:** Como servidor, quero abrir um processo e ver o histórico, os prazos e as designações.

1. O sistema DEVE mostrar os dados do expediente, a composição da prioridade, o risco, os prazos, as designações, os
   marcadores, as anotações e as movimentações (quem, quando, de onde, para onde).
2. O sistema DEVE filtrar o histórico por tipo de movimentação e exportá-lo em CSV.

### Requisito 7: ações em lote (F6, RF11, RF12, RN4, RN5)

**História:** Como chefe, quero receber e designar vários processos de uma vez, com prévia e opção de desfazer.

1. O sistema DEVE oferecer em lote: receber, designar, incluir marcador, dar ciência, assinar, movimentar e arquivar.
2. ANTES de executar, O sistema DEVE mostrar uma prévia com os itens que serão alterados e os ignorados, com o motivo.
3. O sistema DEVE aceitar receber só da caixa A receber; designar, incluir marcador, dar ciência, assinar, movimentar e
   arquivar só da caixa No setor.
4. O sistema NÃO DEVE arquivar expediente com minuta pendente.
5. O sistema DEVE aceitar designação feita só por MEMBRO ou CHEFE, e só para usuários ativos do mesmo setor.
6. O sistema DEVE permitir assinar só a perfil MEMBRO e só expedientes aguardando assinatura.
7. O sistema DEVE permitir dar ciência só em judiciais com nova intimação ou aguardando ciência.
8. O sistema DEVE registrar cada lote (quem, quando, parâmetros, resultado) e as movimentações de cada expediente.
9. QUANDO o autor pedir para desfazer um lote, O sistema DEVE restaurar os itens que não mudaram desde o lote e
   informar os que não puderam ser restaurados.
10. O sistema DEVE limitar o lote a 200 expedientes.

### Requisito 8: sugestão de designação (F7, RF14)

**História:** Como chefe, quero que o sistema sugira a quem designar pela carga de cada pessoa.

1. O sistema DEVE calcular, para cada servidor ativo do setor, a carga (designações ativas + 2 × devoluções vencidas) e
   a capacidade (1 + média diária de ações nos últimos 30 dias), com índice = carga ÷ capacidade.
2. O sistema DEVE sugerir a pessoa de menor índice e, num lote, distribuir os itens um a um para quem tiver o menor
   índice naquele momento.

### Requisito 9: personalização e filtros salvos (F8, RF04, RF05)

**História:** Como servidor, quero salvar filtros e escolher colunas e ordenação.

1. O sistema DEVE salvar filtros com nome, marcar um como padrão e compartilhá-lo com o setor.
2. O sistema DEVE listar os filtros próprios e os compartilhados do setor; só o autor altera ou exclui um filtro.
3. O sistema DEVE guardar por usuário as colunas visíveis e sua ordem, a ordenação, itens por página e densidade.

### Requisito 10: modo "próximo processo" (F9, RF09)

1. O sistema DEVE mostrar um expediente por vez, na ordem da fila, com a ação pendente e atalhos para avançar, voltar
   e abrir o detalhe, também pelo teclado.

### Requisito 11: indicadores e alertas (F10, RF15, RF17)

1. O sistema DEVE mostrar estoque atual, vencidos, cumprimento de prazos no período, entradas e saídas diárias e
   produtividade por pessoa, com filtro por período e gerenciador; cada gráfico tem uma tabela alternativa.
2. O sistema DEVE mostrar a produtividade por pessoa só a MEMBRO e CHEFE.
3. O sistema DEVE listar os alertas do usuário com filtro por lidos/não lidos e severidade, e permitir marcá-los como
   lidos.

### Requisito 12: calendário, eventos e resumo diário (RF10, RF15, RF16)

1. O sistema DEVE exportar os prazos em aberto do setor em iCal (`.ics`), com lembrete configurável.
2. QUANDO um expediente for designado, O sistema DEVE publicar um evento de domínio e gerar, de forma desacoplada e
   idempotente, a notificação para a pessoa designada.
3. O sistema DEVE enviar, em dias úteis às 7h, a quem optar, um resumo por e-mail com vencidos, vencem hoje, novos e
   devoluções vencidas, sem assunto nem conteúdo de expedientes.

### Requisito 13: acessibilidade, responsividade e privacidade (RNF)

1. O sistema DEVE ser operável só pelo teclado, com link "pular para o conteúdo" e foco visível.
2. Todo campo DEVE ter `label`; toda tabela DEVE ter `caption`, `th id` e `td headers`.
3. Avisos DEVEM sair em região `aria-live`; erros com `role="alert"`.
4. O layout DEVE funcionar em desktop e em telas estreitas sem perda de função.
5. O sistema DEVE usar só dados sintéticos e não versionar credenciais.
