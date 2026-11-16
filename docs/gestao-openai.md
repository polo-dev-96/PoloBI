# Gestão da OpenAI

Monitoramento somente de leitura em `/gestao-openai`, aberto em aba nomeada pelo
símbolo da OpenAI no cabeçalho. A rota é independente de música, narração,
notificações e pausa inteligente. Não há exportação.

## Painel em uma tela

A partir de 1366 × 640 pixels de área útil, o layout ocupa a altura do navegador,
sem rolagem vertical da página, sem escala por zoom e sem esconder painéis.

- Cabeçalho com projeto, período mensal em UTC, filtros de projeto/moeda em
  popover, atualizar, tela cheia e retorno ao dashboard.
- Seis cards: gasto mensal, gasto de hoje (parcial), projeção mensal, tokens de
  entrada, saída e cache. Valores financeiros usam duas casas decimais.
- Quatro gráficos: custos mensais comparados com o mês anterior (34% da largura),
  consumo das últimas três horas (24%) e dois rankings Top 10 (21% cada).
- O primeiro ranking é mensal. O segundo inicia em sete dias e permite 1, 7, 15
  ou 30 dias UTC inclusivos, atravessando meses quando necessário.
- O popover de filtros permite mostrar/ocultar os quatro gráficos. O espaço
  liberado amplia o gráfico de custos ou, quando oculto, o consumo recente.
  Somente rankings visíveis dividem a largura igualmente. Se todos forem
  ocultados, os detalhamentos ocupam a altura livre. A preferência fica salva
  neste navegador; “Mostrar todos” restaura a apresentação completa.
- Três painéis inferiores sempre visíveis: modelos, cobranças e outras
  categorias. Cada tabela calcula quantas linhas cabem com ResizeObserver e tem
  paginação independente. Atualização preserva a página; filtros reiniciam nela.
- Cobranças e valores das outras categorias são ordenados numericamente do maior
  para o menor antes da paginação, inclusive no diálogo ampliado. As métricas
  mantêm seus rótulos e unidades, sem soma ou conversão entre categorias.
- Nomes e números compactos têm o valor completo em tooltip, também por teclado.
  Todos os painéis podem ser ampliados em diálogo. O gráfico mensal oferece
  “Dados”, com a tabela diária; o consumo ampliado oferece os dados por minuto.
- Em celular, zoom ampliado e áreas úteis menores, os painéis se reorganizam com
  rolagem normal para preservar legibilidade. Não há bloqueio global de scroll.

A folha `client/src/styles/openai-monitoring.css` fica restrita à rota e aos seus
popovers/diálogos. São mantidos contraste, foco visível, títulos semânticos,
navegação por teclado e preferência por movimento reduzido.

A identidade visual usa fundo preto, superfícies grafite e textos em cinza/branco.
Vermelho destaca marca, gasto mensal, séries atuais, seleções e primeiro colocado.
Séries de comparação usam cinza e tracejado; a saída de tokens usa linha clara
tracejada. Assim, as séries permanecem distinguíveis além da cor. Filtros,
tooltips, diálogos, foco e carregamento seguem a mesma paleta, sem alterar o
tema das demais telas. A mudança visual foi conferida em quatro resoluções de
desktop e no celular, incluindo filtros, teclado e ampliações, sem novos cortes,
rolagem da página no desktop, erros de JavaScript ou pedidos de áudio.

## Consultas e contratos

Todos os endpoints exigem uma sessão administrativa válida. A Admin Key continua
exclusiva do servidor; não foram alterados o ambiente, banco ou integração Milvus.

| Endpoint | Retorno |
| --- | --- |
| `GET /api/openai/projects` | Projetos ativos e arquivados, com paginação completa |
| `GET /api/openai/report?startDate=...&endDate=...&projectId=...` | Contrato existente: custos e categorias de uso |
| `GET /api/openai/costs?startDate=...&endDate=...&projectId=...` | `OpenAICostReport`, sem consultar categorias desnecessárias |
| `GET /api/openai/recent-usage?projectId=...` | `OpenAIRecentUsage`, janela de três horas calculada no servidor |

Datas financeiras são inclusivas, com limite de 90 dias e sem datas futuras.
`projectId` é opcional. O consumo recente tem início/fim ISO UTC, métricas totais,
estado de disponibilidade e série com início/fim, indicador parcial e métricas
por minuto. A janela móvel pode atravessar a meia-noite; seus limites são parciais.

A referência oficial fornece [custos em buckets diários](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs)
e [consumo de conversações em buckets de um minuto](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/completions).
O gráfico recente mostra requisições ou tokens, sem estimativa financeira por hora.

## Precisão, atualização e disponibilidade

- Datas financeiras, rankings e agregações continuam em UTC. Eixo, tooltip e tabela
  por minuto do consumo recente usam `America/Manaus` (UTC−4), inclusive na virada
  da data. Os timestamps recebidos da API permanecem intactos. A última consulta
  também é mostrada em Manaus.
- O filtro oferece Real (BRL), convertido dos custos USD para apresentação com a
  cotação de venda (`ask`) da [AwesomeAPI](https://docs.awesomeapi.com.br/api-de-moedas).
  A consulta pública é feita diretamente pelo navegador, sem cookies, token ou
  Admin Key, com timeout de 10 segundos. Não exige configuração adicional.
  TanStack Query mantém cache e atualização de cinco minutos com a aba visível;
  retomar o foco consulta quando a cotação estiver vencida. “Atualizar” permite
  consultar imediatamente. O refresh dos dados da OpenAI continua em 60 segundos.
  Cards, projeção, séries atual/anterior, rankings, cobranças e dados diários usam
  a mesma cotação atual; os dados USD originais no cache não são alterados.
  A interface identifica a conversão como referência, mostra fonte, taxa, horário
  da cotação e da consulta, sem incluir impostos ou taxas. Não é câmbio histórico.
  Se a atualização falhar, mantém a taxa anterior com aviso. Sem nenhuma cotação,
  custos em BRL ficam indisponíveis, preservando consumo e a opção USD.
- Atualização automática a cada 60 segundos, somente com a aba visível.
  O servidor compartilha consultas em andamento e mantém cache de 60 segundos.
  Custos são compartilhados entre relatório e consultas isoladas.
- Custos, consumo recente, projetos e categorias usam o mesmo limite de quatro
  chamadas externas simultâneas, com paginação integral e controle de 429.
- Custos usam soma decimal exata; moedas, projetos e itens permanecem separados.
  Os rankings mostram custos líquidos, abatem créditos e excluem itens sem projeto.
- O card de hoje reutiliza o bucket do relatório mensal, sem nova chamada.
  `end_time` dos custos termina na meia-noite seguinte para incluir o bucket atual.
  Ausência de custo publicado aparece como “Em processamento”, sem zero falso.
- O gráfico mensal compara datas equivalentes, sem inventar dias inexistentes.
  Pico destaca o primeiro maior valor positivo; variação considera somente dias
  fechados equivalentes para não comparar hoje parcial com um dia inteiro.
- Projeção usa a média dos dias completos do mês × duração do mês, incluindo dias
  sem gasto. Não fica abaixo do realizado e não é exibida no primeiro dia.
- Cache já faz parte dos tokens de entrada. Outras categorias mantêm suas unidades.
  Armazenamento vetorial representa o último snapshot, sem somar retratos diários.
- Falhas preservam os demais painéis disponíveis. Em falhas de atualização de
  custos isolados ou consumo recente, o TanStack Query mantém o último resultado
  e a interface mostra aviso de desatualização. Falhas não viram pontos zerados.

## Executar e validar

Mantenha as variáveis existentes `OPENAI_ADMIN_KEY`, `ADMIN_EMAIL` e
`ADMIN_PASSWORD`. Execute `npm run dev` ou `npm run build` e `npm start`.
O modo dev usa `tsx watch`; mudanças no servidor exigem novo login porque as
sessões são armazenadas em memória, com validade de 12 horas e revogação no logout.
Produção exige reiniciar o processo após o build. Logout continua sincronizado
entre abas. Chaves, tokens e corpos dos relatórios não são registrados nos logs.

```sh
npm run test:openai
npm run test:notifications
npx tsx --test server/satisfactionData.test.ts
npm run check
npm run build
```

Os testes de integração/apresentação abrangem sessão, filtros, paginação, somas,
cache, concorrência compartilhada, virada UTC, consumo por minuto, falhas parciais
e respostas 401/403/429. Os 45 testes da integração e apresentação passaram; os
33 testes existentes também foram validados na implementação do painel.

Verificado no navegador: 1366×640, 1366×650, 1366×768, 1536×864 e 1920×1080 sem
rolagem da página ou cortes; celular sem transbordamento horizontal; filtros,
paginação, ampliação, silêncio, falha e recuperação do consumo recente.
Valores conferidos contra as respostas reais, incluindo os quatro intervalos do
ranking e o gasto do dia. Confirmados foco/restauração dos diálogos, tooltips por
teclado, todas as categorias, preservação da página, recuperação após falha e um
ciclo automático de 60 segundos com avanço da janela intradiária. Nenhum erro de
JavaScript ou pedido de áudio. Build de produção concluído sem novas dependências.

O controle de visibilidade foi validado nas 16 combinações de gráficos, com
persistência após recarregar, restauração, teclado e redistribuição no desktop e
tablet. Ordenação decrescente conferida com dados reais nas tabelas e diálogos.
Conversão conferida no navegador com cotação real, ausência de credenciais na
consulta externa, ciclo registrado de 300.000 ms, falha/recuperação e preservação
da última taxa. Sem cotação, a interface oferece USD e mantém o consumo visível.
BRL validado em 1366×650, 1536×864 e celular; horários de Manaus conferidos no
gráfico e tabela ampliada. Nenhum erro de JavaScript ou pedido de áudio.

`npm run check` mantém os erros preexistentes em `server/storage.ts`, envolvendo
status, IDs e campos do contrato de tickets (linhas 124, 135, 147–150, 194–195,
230–239, 247, 274–276, 291 e 312). Esse arquivo não faz parte desta mudança.

## Arquivos principais

- `client/src/pages/gestao-openai.tsx` e `client/src/styles/openai-monitoring.css`:
  composição do painel e responsividade.
- `client/src/components/openai-dashboard.tsx`, `openai-recent-chart.tsx`,
  `openai-cost-chart.tsx`, `openai-cost-change.tsx` e `openai-monitoring.tsx`:
  painéis, paginação, tooltips, gráficos e indicadores.
- `client/src/hooks/api/useOpenAIReport.ts` e `client/src/services/openaiReport.ts`:
  consultas autenticadas e cálculos de apresentação.
- `client/src/services/openaiDashboard.ts`: preferências de visibilidade,
  redistribuição dos gráficos e ordenação numérica das tabelas.
- `client/src/hooks/api/useDollarQuote.ts`, `client/src/services/openaiCurrency.ts`
  e `client/src/services/openaiTime.ts`: atualização de câmbio, conversão de
  apresentação e formatação de horários de Manaus.
- `server/openai.ts` e `shared/openai.ts`: integração e contratos compartilhados.
- `server/openai.test.ts` e `client/src/services/openaiReport.test.ts`: testes.
