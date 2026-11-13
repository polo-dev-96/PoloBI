# Gestão da OpenAI

Monitoramento somente de leitura em `/gestao-openai`, aberto pelo símbolo da
OpenAI ao lado do botão da Sala de Gestão. A página é independente dos componentes
de música, narração, notificações e pausa inteligente. Não há exportação.

## Apresentação executiva

O layout destaca o realizado e a projeção antes das três métricas de tokens.
O gráfico de custos recebe mais espaço; o ranking e as tabelas usam a mesma
hierarquia de ícones, títulos, identificadores e cores. Os filtros permanecem no
cabeçalho, e o conteúdo ocupa a largura disponível inclusive com zoom reduzido.

A identidade visual fica restrita à rota: `client/src/styles/openai-monitoring.css`
é carregado com a página, sem alterar os estilos do restante do BI. A modernização
visual modifica essa folha, `client/src/pages/gestao-openai.tsx` e
`client/src/components/openai-monitoring.tsx`. Mantém consultas, cálculos e contratos.
Também considera foco visível, regiões de tabela roláveis e redução de movimento.

## Executar e acessar

1. Mantenha `OPENAI_ADMIN_KEY`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` no ambiente do servidor.
2. Reinicie o servidor com `npm run dev`, ou execute `npm run build` e `npm start` em produção.
3. Faça login novamente e clique no símbolo da OpenAI no cabeçalho.

O comando `npm run dev` usa `tsx watch`, reiniciando o servidor quando seus módulos
são alterados. Isso evita a interface nova continuar consultando uma instância
antiga da API. Cada reinício invalida as sessões em memória e exige novo login.
Em produção, `npm run build` precisa ser seguido do reinício de `npm start`.

A chave administrativa nunca é enviada ao navegador. As consultas usam os novos
endpoints autenticados `GET /api/openai/projects` e `GET /api/openai/report`.
O relatório recebe `startDate` e `endDate` no formato `YYYY-MM-DD`, inclusive,
e `projectId` opcional. O intervalo máximo é de 90 dias, sem datas futuras.

## Dados e atualização

- Datas e buckets dos relatórios usam UTC. O horário da última consulta usa Manaus.
- Atualização automática a cada 60 segundos com a aba visível. O servidor compartilha
  consultas em andamento, mantém cache por 60 segundos e limita a quatro chamadas
  simultâneas à OpenAI, incluindo todas as páginas.
- Custos usam soma decimal exata e são separados por moeda, projeto e item de cobrança.
  A exibição usa duas casas decimais, preservando os valores originais.
  Não há conversão cambial ou estimativa de custo por modelo.
- O Top 10 usa os custos líquidos por projeto no período selecionado, separados por
  moeda; cobranças sem projeto atribuído não entram no ranking.
  O ranking cresce junto com o gráfico para manter os dez projetos visíveis.
- O gráfico de custos ocupa aproximadamente 70% da linha no desktop e compara
  cada dia selecionado com o mesmo dia do mês anterior, no mesmo projeto e moeda.
  A linha anterior é tracejada; o tooltip e a tabela diária exibem ambas as datas.
  Dias inexistentes no mês anterior ficam sem ponto, sem repetir o último dia.
  Falhas não são convertidas em zero. Se o intervalo anterior exceder os 90 dias
  permitidos pelo endpoint, a consulta é dividida em partes sem sobreposição.
  O pico positivo do período selecionado tem marcador e resumo de data/valor;
  em empates, destaca o primeiro dia, sem criar pico para períodos zerados.
- Ao lado do pico, a variação mostra aumento, redução ou estabilidade em relação
  aos mesmos dias do mês anterior. Usa somente dias UTC fechados e equivalentes,
  no projeto e moeda selecionados; hoje fica fora para não comparar um dia parcial
  com um dia completo. O tooltip acessível por foco exibe os totais, diferença
  monetária e intervalos. Base zero ou negativa não produz percentual infinito.
  Dados indisponíveis não viram redução de gastos.
- A consulta de custos usa `end_time` na meia-noite UTC seguinte à data final,
  exclusiva, incluindo o bucket parcial de hoje. A referência oficial descreve
  [custos em buckets diários e limite final exclusivo](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs).
  Na verificação real, encerrar em `now()` omitia hoje; consultar até a próxima
  meia-noite retornou os custos já publicados. Consumo mantém o limite até agora.
  Hoje é identificado como parcial no gráfico e tabela; se a OpenAI ainda não
  publicar um valor, aparece como "Em processamento", sem desenhar um zero falso.
- A projeção até o fim do mês usa a média dos dias UTC completos do mês atual,
  incluindo dias sem gasto, multiplicada pelo número real de dias do mês.
  O resultado não fica abaixo do gasto já observado e segue o filtro de projeto.
  O card identifica a estimativa e sua base; não há projeção no primeiro dia.
  Ao consultar outro período, o front-end busca também o mês atual pelo endpoint
  existente; no mês atual, reaproveita a mesma consulta e seu cache.
- Os indicadores principais de tokens são de conversações.
  Tokens em cache já fazem parte da entrada. As outras categorias permanecem separadas.
- Bytes de armazenamento mostram o último dia retornado, sem somar snapshots de dias diferentes.
- Falhas são sinalizadas por fonte. Em falhas de atualização HTTP, os dados da última
  consulta permanecem visíveis com aviso de desatualização. Dados da OpenAI podem ter atraso.

## Sessões

O login mantém suas credenciais e formato de resposta. Tokens aleatórios possuem
validade de 12 horas e são validados no servidor; logout revoga o token e limpa os
relatórios nas outras abas. Sessões ficam em memória: reiniciar o servidor exige
novo login. A implantação atual pressupõe um único processo de servidor; múltiplas
réplicas exigiriam armazenamento compartilhado de sessões e cache.

Corpos das respostas de autenticação e dos relatórios não são registrados no logger HTTP.
Não foram alterados o banco, os contratos Milvus ou o `.env`.

## Arquivos

- Interface e navegação: `client/src/pages/gestao-openai.tsx`,
  `client/src/components/openai-monitoring.tsx`, `client/src/components/openai-cost-chart.tsx`,
  `client/src/components/openai-cost-change.tsx`, `client/src/components/app-header.tsx`
  e `client/src/App.tsx`.
- Consultas e apresentação: `client/src/hooks/api/useOpenAIReport.ts`,
  `client/src/services/openaiReport.ts` e `shared/openai.ts`.
- Integração e sessão: `server/openai.ts`, `server/adminSession.ts`,
  `server/routes.ts`, `server/index.ts` e `client/src/contexts/AuthContext.tsx`.
- Testes: `server/openai.test.ts`, `client/src/services/openaiReport.test.ts`;
  comando `test:openai` adicionado ao `package.json`.

## Validação

```sh
npm run test:openai
npm run test:notifications
npx tsx --test server/satisfactionData.test.ts
npm run check
npm run build
```

Foram verificados os totais financeiros e de consumo contra consultas reais não
agrupadas da OpenAI. Também foram inspecionados layout em desktop, tablet e celular,
ausência de rolagem horizontal da página, ausência de requisições de áudio,
filtros de projeto/período, validação de 90 dias, botão acessível por teclado,
reutilização da aba nomeada, restauração de sessão, sincronização de logout entre
abas e acesso sem login. O cabeçalho foi conferido nas larguras de 320, 390, 768,
1024 e 1536 pixels. A tela também foi conferida até 2300 pixels de largura lógica,
equivalente à redução de zoom para 67%, ocupando toda a largura disponível.
Os filtros ficam no cabeçalho e o gráfico de consumo foi substituído pelo Top 10.
As 12 fontes responderam com sucesso na consulta real.

Resultado: 31 testes da integração e apresentação e 33 testes existentes passaram; build
de produção concluído. Não foram adicionadas dependências.

`npm run check` já falhava antes desta implementação em `server/storage.ts`:
linhas 124, 135, 147–150, 194–195, 230, 233, 236, 239, 247, 274–276, 291 e 312.
Esses erros envolvem tipos de status, IDs e propriedades do contrato de tickets.
Esse arquivo não faz parte da alteração.
