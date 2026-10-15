# NutriBot — Mapa do ecossistema (WhatsApp × app × Drive × IA)

**Data:** 15/10/2026 · **Branch:** `app-fase3` · **Base:** app 2.5 no ar (2811f0a) + fase 6 em andamento (`2026-10-15-plano-fase6.md`, inclusive a seção 7: quatro permissões novas) · **Tipo:** inventário só de leitura; nada do código foi alterado.

Pedido do dono: a Nutri é **uma cabeça só**, a mesma no WhatsApp e no app, e sabe de tudo. **Drive** = cérebro, onde tudo fica guardado. **App** = ver, registrar e editar. **WhatsApp** = praticidade, ou seja, conversa, registro, ajuda e cobrança. Tudo que existe no WhatsApp tem que existir no app e no Drive. "Não achei a despensa no app."

Legenda: **V** ver · **R** registrar · **E** editar/apagar · **P1** essencial · **P2** útil · **P3** depois. As rotas propostas ficam sob `/api/v1`, usam token Bearer e passam por `semZap`/`tirarLocalizacao` como as atuais. O app não tem PATCH em `Api.kt`, por isso as ações usam **PUT**.

---

## 0. Números

| Seção | Lacunas | P1 | P2 | P3 |
|---|---|---|---|---|
| 1. WhatsApp → app (comandos e automáticos) | 45 | 4 | 20 | 21 |
| 2. App e relógio → IA (16 dados + 5 lacunas dos prompts do app) | 21 | 10 | 7 | 4 |
| 3. Conversa do app → WhatsApp | = A08 (já contada na seção 2; proposta em 6 partes) | — | — | — |
| 4. Tudo → Drive | 20 dados sem espelho, cobertos por 9 arquivos propostos | 1 | 6 | 2 |
| **Total** | **75** | **15** | **33** | **27** |

Na seção 1, as linhas marcadas "= Wnn" repetem uma lacuna já contada e não entram de novo no total. Na seção 4, a conta é por arquivo proposto. Há ainda 11 decisões para o dono (seção 5) e 7 frentes de trabalho (seção 6).

Achados de passagem (bugs pequenos, para a frente A): em `despensa.js` o campo `validadeDias` não é gravado (`tem`/`comprei` sempre usam o padrão); `usei` num item a granel não muda nada; não há índice em `despensa` (`{jid,k}` deveria ser único) nem em `notas.chave`. `estado.silencioAte` só existe na memória e se perde no restart. Nenhum `!comando` no grupo checa se quem manda é o dono, inclusive `!reset`, `!estudar`, `!resumo`, `!voz` e `!nome`.

---

## 1. WhatsApp → app

O que já existe no app: Hoje, Comida (registrar, ajustar e apagar refeição; sugestão de refeição), Progresso (gráfico nativo, pesagens), Corpo/Treinos (sugestão de carga), Nutri (fatos, hipóteses, diário, pensamentos, reflexões, plano), Agenda (só eventos do app), Resumos (semana e mês), Sono/Energia/Atividade (fase 6), Integrações (estado das fontes, ler cupom), Perguntar à Nutri.

### 1A. Comandos `!`

| # | Comando | No app hoje | Falta | Rota proposta (método caminho · corpo → resposta) | P |
|---|---|---|---|---|---|
| W01 | `!hoje` | Hoje (`GET /hoje`) | — | — | ok |
| W02 | `!hoje todos`, `!grafico todos`, `!treino todos` | não está | V do grupo | `GET /grupo/hoje` → `{perfis:[{id,nome,kcal,metaKcal,p,metaP,refeicoes,ultimaHora}]}` (D2 permite saúde do grupo) | 3 |
| W03 | `!apagar` | Comida (`DELETE /refeicoes/:rid`) | — | — | ok |
| W04 | `!refeicao` | Comida › Registrar (`POST /refeicoes`) | — | — | ok |
| W05 | `!grafico` | Progresso, gráfico nativo (`GET /dias`) | — | — | ok |
| W06 | `!progresso` | Progresso + avisos do Hoje (`GET /progresso`) | — | — | ok |
| W07 | `!tendencia` | Hoje e Corpo (`projecaoComo`) | — | — | ok |
| W08 | `!relogio` | cartões do Hoje + Integrações | — | — | ok |
| W09 | `!treino` | Corpo › Treinos (`GET /corpo`) | — | — | ok |
| W10 | `!perfil` | Perfil edita objetivo, meta, prazo, altura e ritmo; Nutri › Fatos mostra cadastro, produtos, gírias e rotina | E de cidade, dieta, restrições e gênero | ampliar `PUT /perfis/:id` · `{cidade,dieta,restricoes,genero}` → `{perfil}` (reusa `aplicarAtualizacao`, que grava `atualizacoes[campo]`) | 2 |
| W11 | `!apelido X` / `nenhum` | Perfil, só leitura | E | `PUT /perfis/:id` · `{apelido, semApelido}` → `{perfil}` | 2 |
| W12 | `!despensa` (lista) | **não está** | V | `GET /perfis/:id/despensa?acabou=0\|1` → `{itens:[{k,item,categoria,quantidade,unidade,granel,estado,validadeEm,venceEmDias,perecivel,loja,compradoEm,kcal100,p100,perguntar}], vencendo, acabando}` (`listarDespensa`; `perguntar` = vencido e não perguntado há 3 dias) | **1** |
| W13 | `!despensa add 2 kg arroz` | não está | R | `POST /perfis/:id/despensa` · `{item,qtd?,unidade?}` → `{item}` (`ajustarItem` com `acao:'comprei'`; cria via `entrarNaDespensa`) | **1** |
| W14 | `!despensa tirar/acabou/remover/acabando` (+ `usei`, `tem`, `comprei`, que hoje só a IA usa pela linha DESPENSA) | não está | E | `PUT /perfis/:id/despensa/:k` · `{acao:'acabou'\|'acabando'\|'usei'\|'tem'\|'comprei', qtd?}` → `{item}` (`ajustarItem`) | **1** |
| W15 | `!despensa limpar/zerar` | não está | E destrutivo | `DELETE /perfis/:id/despensa?confirmar=sim` → `{apagados}` (`limparDespensa`) | 3 |
| W16 | `!nota` / cupom (foto, QR, PDF, texto da SEFAZ) | Integrações › "Ler cupom" (app antigo → `POST /nota`); a última nota aparece em `/integracoes` | V das compras; R pela API nova | `GET /perfis/:id/compras?dias=28` → `{notas:[{loja,dia,origem,itens:[{item,qtd,unidade,preco}]}], resumo}` (coleção `notas` + `resumoDespensaPeriodo`); `POST /perfis/:id/compras` · `{chave\|url\|texto}` → 202 (`receberNotaDoApp`) | 2 |
| W17 | `!atividade` (lista) | não está | V | `GET /perfis/:id/atividades` → `{fixas:[{id,nome,dias,inicio,fim,met,lugar:{nome}\|null,kcal}], hoje:[{id,nome,feita,kcal,como}], pendentes:[{id,nome,dia}]}` | 2 |
| W18 | `!atividade nova Nome; dias; hh:mm-hh:mm; met; lugar` | não está | R | `POST /perfis/:id/atividades` · `{nome,dias:[0-6],inicio,fim,met,lugarId?\|aqui?}` → `{atividade}` (precisa de `criarAtividadeDeObjeto`: o `criarAtividade` de hoje parseia texto) | 2 |
| W19 | `!atividade remover N` | não está | E | `DELETE /perfis/:id/atividades/:aid` → `{apagada}` (por id, não por posição) | 2 |
| W20 | `!atividade sim/não` | não está | R | `POST /perfis/:id/atividades/:aid/resposta` · `{dia,feita}` → `{feita,kcal}` (`responderPendente`; cancela a pergunta no grupo) | 2 |
| W21 | `!pensamentos agora` | Nutri › Pensamentos (só leitura) | R (forçar) | `POST /perfis/:id/nutri/pensar` → 202 (`pensarSobre({forcar:true})` **sem** `considerarIntervencao`; 2 por dia) | 3 |
| W22 | `!reflexao nova` | Nutri › Reflexões (só leitura) | R (forçar) | `POST /perfis/:id/nutri/refletir` → 202 (1 por semana; IA pesada) | 3 |
| W23 | `!lugares` | não está (só o botão de ligar a localização) | V | `GET /perfis/:id/lugares` → `{agora:{tipo,nome,desde}\|null, lugares:[{id,tipo,nome,bairro,papel,visitas,padrao,ultimaVez}]}`. **Só o perfil do dono**: os outros devolvem 403 (decisão de 13/10) | 2 |
| W24 | `!lugares casa` / `aqui é <tipo> <nome>` | não está | E | `PUT /perfis/:id/lugares/:lid` · `{tipo?,nome?,papel?:'casa'\|'trabalho'\|null}` → `{lugar}` (`marcarLugarAtual` passa a aceitar um id) | 2 |
| W25 | `!lugares esquecer` | não está | E destrutivo | `DELETE /perfis/:id/lugares?confirmar=sim` (`esquecerLugares`) | 3 |
| W26 | `!agenda` (Google) | a Agenda só mostra eventos do app; Integrações só mostra o estado | V | `GET /perfis/:id/agenda-google?dias=7` → `{eventos:[{dia,inicio,fim,titulo,tipo}], janelas:[{dia,inicio,fim}]}` (`agendaDe`, só o dono da credencial, sem local; escrita fica fora por causa do escopo `calendar.readonly`) | 2 |
| W27 | `!plano` (ler) | Nutri › Plano (`GET /plano`) | — | — | ok |
| W28 | `!plano [pedido]` (gerar) / `!plano limpar` / oferta de sexta + "quero" | não está | R / E | `POST /perfis/:id/plano` · `{pedido?}` → 202 `{emAndamento:true}` (`gerarPlano`; 1 por dia); pedido fixo por `PUT /perfis/:id` · `{planoPedido}` | 2 |
| W29 | `!voz on/off` | não está | E | `GET /config` → `{vozLigada,silencioAte,nomeBot}`; `PUT /config` · `{vozLigada}` (só `ehDono`; vale para o grupo todo) | 2 |
| W30 | `!silencio 2h` / `!falar` | não está | E | `PUT /config` · `{silencioAte: ISO\|null}` (persistir em `config`; hoje some no restart) | 2 |
| W31 | `!nome` | não está | V | campo `nomeBot` do `GET /config`, só leitura (rebatizar é ritual do grupo) | 3 |
| W32 | `!dossie` / `!pasta` | não está (a Nutri mostra as notas como fatos) | V | `GET /perfis/:id/documentos` → `{arquivos:[{nome,tipo,lido,modificadoEm,resumo}], pastaUrl}` (`listarDocumentosDe` + `documentos_pessoa`) | 2 |
| W33 | `!persona` | não está | V | `GET /nutri/persona` → `{texto,atualizado,versoes:[{em,trecho}]}` (`persona` + `persona_historico`) | 2 |
| W34 | `!licoes` | não está | V | `GET /nutri/licoes` → `{regras:[], documento, dia}` (`carregarAprendizados`) | 2 |
| W35 | `!fontes` | não está | V | `GET /nutri/conhecimento` → `{docs:[{id,titulo,versao,atualizado,foco}]}`; `GET /nutri/conhecimento/:id` → `{texto}` | 3 |
| W36 | `!estudar` | não está | R | `POST /nutri/conhecimento/estudar` → 202 (só o dono; o cron mensal já faz) | 3 |
| W37 | `!proativa` | não está | V | `GET /nutri/proatividade?dias=14` → `resumoProatividade` (total, respondidas, ignoradas, últimas 5) | 2 |
| W38 | `!status` / `!cota` | Integrações (estado das fontes) | V | `GET /sistema/status` (só o dono) → `{uptime, gemini:{chamadas,tokens,modelos,castigos}, reservas, voz, revisoes}` (mesmo corpo de `/status?token=`) | 2 |
| W39 | `!resumo` (forçar o fechamento) | — | não fazer: posta no grupo e reescreve persona e notas | — | — |
| W40 | `!reset` | — | não fazer: irreversível | — | — |
| W41 | `!id` | não está | V técnico | campo `jids` no `GET /perfis/:id` | 3 |
| W42 | `!ajuda` | — | a navegação do app substitui | — | — |
| W43 | `!app` / `!app sair` | Pareamento + Integrações › Desconectar | — | — | ok |

### 1B. O que o bot faz sozinho ou entende na conversa

| # | Comportamento | No app hoje | Falta | Rota proposta | P |
|---|---|---|---|---|---|
| W44 | Resumo do dia (23:59) | não está (Resumos só tem semana e mês) | V | `GET /perfis/:id/resumos/dia?dia=` → `{dia,texto}` (lê `Resumos/AAAA-MM-DD.md`; melhor ainda, gravar também no Mongo `relatorios`) | 2 |
| W45 | Resumo da semana e do mês | Resumos | — | — | ok |
| W46 | Aposta da semana e conferência (`previsoes`) | não está | V | `GET /perfis/:id/previsoes?n=8` → `[{semana,previsto,real,erro,confianca}]` | 3 |
| W47 | Etapa batida → próxima etapa | só a meta atual | V do histórico | campo `etapas:[{em,de,para}]` no `/progresso` | 3 |
| W48 | Oferta do plano (sexta 12:00) | não está | = W28 (botão "Gerar plano da semana que vem") | — | = W28 |
| W49 | Pedido de pesagem no domingo | Progresso registra peso | aviso no Hoje | `/hoje.avisos` ganha "dia de pesagem" para quem não tem relógio | 3 |
| W50 | Cobrança de refeição atrasada (a cada 10 min) | Hoje › pendentes (`pendentesDoDia`) | — (é o equivalente) | — | ok |
| W51 | Pergunta de validade (18:30) e "comprou algo?" ao sair do mercado | não está | R | selo "passou do prazo: ainda tem?" na despensa, com Tem/Acabou (W14 `acao:'tem'\|'acabou'`); a mesma resposta marca `perguntadoEm` | **1** |
| W52 | Conferência de atividade fixa pela localização ("teve vôlei?") | não está | = W20 + cartão de pendência no Hoje | — | = W20 |
| W53 | Pensamentos 3 vezes por dia | Nutri | — | — | ok |
| W54 | Intervenção proativa no grupo | não está | = W37 | — | = W37 |
| W55 | Reflexão de domingo + hipóteses | Nutri | — | — | ok |
| W56 | Diário da Nutri | Nutri › Diário | — | — | ok |
| W57 | Momentos memoráveis | não está | V | `GET /nutri/momentos?dias=30` → `[{dia,pessoa,tipo,texto}]` | 3 |
| W58 | Notas de voz de segunda e sexta (`falaProgramada`) | não está (o texto não é guardado) | V | gravar o texto em `falas` e devolver `falas:[{dia,tipo,texto}]` no `/resumos` | 3 |
| W59 | Lições (revisão noturna dos erros) | não está | = W34 | — | = W34 |
| W60 | Persona que evolui à noite | não está | = W33 | — | = W33 |
| W61 | Água e álcool (linha HABITO) | **não está** | V / R | `/hoje.habitos` → `{aguaMl,alcoolDoses}`; `POST /perfis/:id/habitos` · `{dia,aguaMl?,alcoolDoses?}` (`registrarHabito`, soma) | 2 |
| W62 | Gírias, rotina e horários aprendidos | Nutri › Fatos | — | — | ok |
| W63 | Anotações (`anotar_memoria`) | Nutri › Fatos (editar e apagar) | — | — | ok |
| W64 | Lembranças (memória vetorial) | não está | V (busca) | `GET /perfis/:id/lembrancas?q=` (1 embedding por busca) | 3 |
| W65 | Mercados perto | não está | V | `GET /perfis/:id/mercados` (só o dono; cache de 14 dias) | 3 |
| W66 | Semana típica | não está | V | `GET /perfis/:id/semana-tipica` (antes precisa estruturar `semanaTipica`, que hoje é só texto) | 3 |
| W67 | Padrão alimentar | só como "próxima refeição" | V completo | `GET /perfis/:id/padrao?dias=28` → `padraoAlimentar.slots` | 3 |
| W68 | Produto / código de barras (OFF) | não está | R | `GET /produtos?codigo=\|nome=` (cache `produtos`) | 3 |
| W69 | Revisão por amostragem das respostas do modelo reserva | não está | V | campo `revisoes` no `/sistema/status` (exige guardar o resultado) | 3 |
| W70 | Pergunta da Nutri por refeição (linha PERGUNTA, só em memória) | não está | V | persistir no registro da refeição (`perguntaNutri`) | 3 |
| W71 | Áudio ("manda em áudio"), reação com emoji, batismo, cadastro, contestação | — | não fazer: o app lê o texto e a edição direta substitui a contestação | — | — |
| W72 | Clima no prompt; queda de sessão e retomada | Integrações › WhatsApp | — | — | ok |

### 1C. A despensa no app (o que o dono não achou)

Tudo isso já existe pronto em `despensa.js`; falta só a rota e a tela.

| Ação no app | Função que já faz | Observação |
|---|---|---|
| Listar por categoria, com quantidade, estado (tem/acabando/acabou), validade e "vence em N dias" | `listarDespensa(perfil,{incluirAcabou})` | os documentos já vêm ordenados por `validadeEm` |
| Adicionar (nome, quantidade, unidade) | `ajustarItem(perfil,{item,qtd,unidade,acao:'comprei'})` → `entrarNaDespensa` | se o item já existe, a unidade digitada é ignorada (achado) |
| Acabou / Acabando / Usei N / Ainda tem / Comprei mais | `ajustarItem` com `acao` `acabou` \| `acabando` \| `usei` \| `tem` \| `comprei` | `usei` num item a granel não muda nada (achado) |
| Tirar da lista | `ajustarItem acao:'acabou'` (some da lista padrão; aparece com `acabou=1`) | não existe apagar um item sozinho; se precisar, `deleteOne({jid,k})` |
| Zerar tudo | `limparDespensa` | só em Configurações, com confirmação dupla |
| Compras (cupons lidos) | coleção `notas` + `resumoDespensaPeriodo` (28 dias: gasto, recorrentes, vencidos) | W16 |
| Mandar cupom | `receberNotaDoApp` (o mesmo do `POST /nota`) | hoje só pelo app antigo (Integrações) |
| Valor nutricional por 100 g | `nutri:{kcal,p,c,g,fonte}` no documento | TACO ou OFF |

A IA não precisa de nada novo aqui: `blocoDespensa` lê a mesma coleção, então uma edição feita no app vale na próxima resposta do WhatsApp. A tela fica em **Comida › Despensa** (botão no topo de Comida), com selo laranja "vence em 2 dias" e vermelho "passou do prazo: ainda tem?".

---

## 2. App e relógio → IA

Siglas dos prompts: **Conv** = conversa do WhatsApp (`responder`, sempre publicada no grupo) · **Pens** = pensamentos 3x/dia · **Refl** = reflexão de domingo · **Plano** = `planoSemanal` · **Cob** = cobrança · **Sug** = `sugerirRefeicao` · **App** = `responderApp`. A "linha" é a `relogio.linha` (`indicadoresRelogio`), que entra no `blocoPerfis` **de todos** os perfis em Conv, nos resumos e na fala programada.

### 2A. Dados

| # | Dado (origem) | Chega hoje? Onde e por qual função | Falta: onde entraria · exemplo do texto que a IA leria | P |
|---|---|---|---|---|
| A01 | Refeição pelo app (`POST /refeicoes`) | sim em todos (mesmo registro + memória do dia) | — | ok |
| A02 | Ajuste ou apagamento pelo app | sim: `correcoes_dia` (resumo do dia, lições) e `correcoes_estimativa` (calibração) | — | ok |
| A03 | Humor em números (`humor`) | Conv (bloco PELO APP, **só hoje**), Sug, App | Pens (`retratoDoDia`) e Refl ganham a série de 7 dias, por um `humorDaSemana` novo em `contexto.js` · "HUMOR PELO APP (7 dias): seg 4/5, ter 2/5 (energia 2/5), qua 3/5." | **1** |
| A04 | Texto do humor | só Conv, como confidência | Pens e Refl (que são privados) recebem o sentido, sem citar · "Na terça ela contou ao app, em confidência: semana pesada no trabalho." | 2 |
| A05 | Eventos do app (`eventos_app`) | Conv (hoje até +3 dias), Sug (hoje) | entram como fonte em `roteiroDoDia` (perfis.js) e daí chegam a Conv, Pens e Plano; a Cob pula a cobrança quando há evento de refeição fora · "Hoje 20:00: jantar de aniversário (pelo app, refeição fora)." | **1** |
| A06 | Pesagem pelo app | sim (`visaoDe`, progresso, tendência) | — | ok |
| A07 | Fatos corrigidos no app | sim (notas, anotações; hipótese descartada não volta) | limitação conhecida: um job pode regravar um snapshot nos mesmos minutos | ok |
| A08 | Perguntas ao app (`POST /perguntar`) | **nada** (nem grava) | seção 3 | **1** |
| A09 | Sugestão de refeição mostrada no app | nada (`Map` em memória por 1 h) | guardar em `sugestoes_app` e passar à Conv e ao App · "Às 12:10 o app sugeriu: omelete de 3 ovos + arroz (520 kcal, 32 g de proteína)." | 2 |
| A10 | Sugestão de carga do dia (`sugerirCargaExercicio`, caixas da fase 6) | Conv só quando o assunto é treino, e via `analiseForca`/`gerarSugestoesCarga` **semanal**, que é outra conta | `analiseForca` passa a usar a mesma `sugerirCargaExercicio`, para app e WhatsApp dizerem o mesmo número · "No app: Supino — pegava 50 kg × 8, pode pegar 52,5 kg × 8." | **1** |
| A11 | Sono (duração, fases totais, deitou e levantou) | sim (linha de todos; dossiê, Pens, Refl, App) | — | ok |
| A12 | Nota de sono e fatores (fase 6, `notaSono`) | **não** (só na API) | `indicadoresRelogio`/`resumoSaude` importam `notaSono` (pura) · "Sono de ontem: nota 72 (boa), 6h50 dormidas, profundo 15 %, REM 19 %, pegou no sono em 12 min." | **1** |
| A13 | Fases ao longo da noite, FC e VFC no sono (fase 6) | não | só agregados, no dossiê da pessoa · "No sono: FC 54 (sua média 57), VFC 48 ms (acima da média)." | 2 |
| A14 | Nota de energia (`energiaDoDia`) e fatores (fase 6) | só App (`contextoDoTreino`) | entra na linha e em Pens, Refl e Conv · "Energia hoje 64/100 (razoável): sono 70, recuperação 60, carga 55." | **1** |
| A15 | Passos e gasto total | sim (linha, `visaoDe`, dossiê) | — | ok |
| A16 | Passos e kcal por hora, hora de pico (fase 6) | não | só o pico, em Pens · "Mais ativa entre 18h e 19h." | 3 |
| A17 | Minutos ativos e metas dos anéis (fase 6) | não | linha da pessoa · "Atividade hoje: 6.200/8.000 passos, 34/60 min ativos, 280/500 kcal ativas." | 2 |
| A18 | kcal ativas (estimada na fase 6, oficial na 6b) | não | a mesma linha de A17; **não somar** ao gasto total, que já entra no balanço | 2 |
| A19 | Distância (6b, `READ_DISTANCE`) | não existe | linha de A17 · "4,8 km." | 3 |
| A20 | Oxigênio no sangue no sono (6b, `READ_OXYGEN_SATURATION`) | não existe | **só no dossiê da pessoa** e em Pens/Refl (ver D12) · "Oxigênio no sono: média 95 %, mínimo 89 %, 3 min abaixo de 90 %." | 2 |
| A21 | Temperatura da pele (6b, `READ_SKIN_TEMPERATURE`) | não existe (a única "temperatura" hoje é o clima) | só no dossiê, Pens e Refl · "Temperatura da pele na noite: +0,6 °C acima da sua base." | 3 |
| A22 | Treinos (Hevy e relógio) | sim | — | ok |
| A23 | Massa magra enviada pelo relógio | não (o resumo calcula a magra a partir da gordura) | `resumoSaude` usa a medida quando ela existir | 3 |
| A24 | Localização (app → `locais`) | sim (Conv só da própria pessoa, Pens, Refl, Plano; no app só o tipo) | — | ok |
| A25 | Cupom e despensa (inclusive o que for editado no app) | sim (`blocoDespensa`) | — | ok |
| A26 | Atividades fixas e água/álcool (quando o app registrar) | sim (mesmas coleções) | — | ok |

### 2B. Prompts do app: hoje são uma "segunda cabeça"

`sugerirRefeicao` e `responderApp` não passam por `montarSystem`. Recebem só a persona em texto: ficam sem lições, sem anotações e sem a conversa do dia.

| # | Lacuna | Onde entraria · exemplo | P |
|---|---|---|---|
| P01 | `responderApp` e `sugerirRefeicao` sem as **lições** (`blocoLicoes`) | system dos dois · "REGRAS QUE APRENDI COM ERROS: não somar o pão duas vezes…" | **1** |
| P02 | Sem **anotações/fatos** (aversões, combinados), síntese da reflexão e pensamento de hoje | `contexto-app.js` novo · "Fatos que você guardou: não come peixe; janta tarde às terças." | **1** |
| P03 | `responderApp` não sabe o que a pessoa disse **hoje no WhatsApp** | `falasDe(memoria, nome)`, só as falas dela · "Hoje no grupo ela disse: 'tô sem fome nenhuma'." | **1** |
| P04 | `responderApp` sem agenda, eventos do app, atividades fixas e sugestões de carga | o mesmo `contexto-app.js` | 2 |
| P05 | `sugerirRefeicao` sem as anotações (pode sugerir algo que a pessoa rejeita) | igual ao P02 | **1** |

### 2C. Regras de privacidade que valem para tudo acima

- D2: saúde de uma pessoa pode ir no prompt da outra (`blocoPerfis`). **Recomendação:** os dados novos sensíveis (oxigênio, temperatura, texto do humor, perguntas do app) ficam **fora** do `blocoPerfis` e só entram no dossiê da própria pessoa (D12).
- Localização só na conversa da própria pessoa; no app, só o tipo de lugar (`tirarLocalizacao`).
- O texto do humor é confidência: a IA leva em conta e não cita. O mesmo vale para as perguntas do app (seção 3).
- Notas e hipóteses privadas não vão para o resumo do grupo (`correcoes_dia` troca o conteúdo por "não citar").
- **Ponto fraco:** no WhatsApp a resposta sai sempre no grupo, e a proteção é só uma instrução de prompt (`gemini.js:111-112, 726, 735`). Não há filtro em código como o `tirarLocalizacao` do app. Cada dado privado novo aumenta esse risco (seção 5).

---

## 3. Conversa do app → WhatsApp

Hoje `POST /perguntar` não grava nada: o histórico vive na memória da tela (`Perguntar.kt`) e some ao fechar.

**Onde guardar:** coleção nova `perguntas_app`, um documento por troca:

```
{ _id, perfilId, jid, nome, dia (local), em, pergunta (≤400), resposta (≤1200),
  tema: 'comida'|'treino'|'sono'|'peso'|'humor'|'outro'  (por regex, sem IA),
  privado: true, vistaPelaNutriEm: null|Date }
```

Índice `{jid:1, em:-1}`. TTL de 180 dias, ou sem TTL, conforme a decisão D16. A gravação é "melhor esforço": se falhar, a resposta ao app sai mesmo assim.

**Rotas:** `GET /perfis/:id/perguntas?antes=&n=20` (histórico na tela Perguntar) · `DELETE /perfis/:id/perguntas/:pid` · `DELETE /perfis/:id/perguntas?confirmar=sim`. O `anteriores` passa a vir do servidor: as 5 últimas trocas de 24 h.

**Como a Nutri passa a saber** (módulo `perguntas.js`: `guardarPergunta`, `perguntasDe(jid,{desde,n})` e a função pura `blocoPerguntasApp(lista,{modo})`):

| Onde | O que entra | Regra |
|---|---|---|
| Conv (bloco PELO APP, só a própria pessoa, só com motivo) | as 3 últimas das últimas 48 h, uma linha cada (pergunta até 120 caracteres + o essencial da resposta) | "Perguntou no app (em confidência): leve em conta e retome só se ela(e) puxar o assunto; não cite no grupo." |
| Pens (privado) | todas do dia | "Às 15:02 perguntou no app 'posso comer pão à noite?'; respondi que sim, dentro de 300 kcal." |
| Refl (domingo) | temas e contagem da semana + até 10 perguntas | vira sinal para as hipóteses ("anda preocupada com o sono") |
| `responderApp` | as anteriores (continuidade entre aberturas do app) | — |
| Resumo do dia, semana, momentos, diário da Nutri | **nunca** | garantido em código: os compiladores não leem `perguntas_app` |
| Memória vetorial | **não indexar** | `lembrancasPara` também busca lembranças de pessoas citadas, e isso vazaria |
| Drive | `<Pessoa>/Nutri-Conversas-App/AAAA-MM.md` (seção 4) | — |

---

## 4. Tudo → Drive (o cérebro)

### 4A. O que já vai (toda escrita sobrescreve o arquivo; "acrescenta" significa ler, concatenar e regravar)

| Arquivo | Quem escreve | Quando |
|---|---|---|
| `Diario/AAAA-MM-DD.md` (conversa do dia) | `dia.js gravarDiario` | 30 s depois de cada mensagem e no fechamento |
| `Resumos/AAAA-MM-DD.md`, `Semana-AAAA-Www.md`, `Mes-AAAA-MM.md` | `fecharDia`, `fecharSemana`, `fecharMes` | 23:59 / domingo / dia 1 às 08:00 |
| `Perfis/Nutri.md` (persona), `Nutri-Momentos.md` e `Nutri-Diario.md` (acrescentam), `Nutri-Aprendizados.md` | `fecharDia` | 23:59 |
| `Logs/AAAA-MM-DD.md` | `registrarLog` | fechamento e estudo |
| `Conhecimento/<id>.md`, `Conhecimento/Pesquisas/<slug>.md` | `conhecimento.js` | boot, dia 1 às 04:00, `!estudar`, pesquisa na conversa |
| `<Pessoa>/Nutri-Notas.md` | `salvarNotas` | 23:59 e correção pelo app |
| `<Pessoa>/Nutri-Ficha.md` | `salvarFicha` (`mdPerfil`) | cadastro, ATUALIZAR, 23:59, documento novo |
| `<Pessoa>/Nutri-Saude.md` (resumo do relógio) | `saude.aplicarDadosSaude` | cada `POST /relogio` e planilha |
| `<Pessoa>/Nutri-Reflexoes.md` | `refletirSobre` | domingo e `!reflexao nova` |
| `<Pessoa>/Nutri-Plano.md` (**só o último**) | `gerarPlano` | `!plano` / "quero" |
| `<Pessoa>/Fotos/AAAA-MM/…` | `guardarFotoNoDrive` | refeição com foto pelo app |

O que a IA lê de volta: os documentos da própria pessoa (dossiê, que exclui `Nutri-*` com exceção de `Nutri-Notas.md`), a planilha de saúde, `Timeline.json` e, no semanal, os resumos diários. Os demais `Nutri-*` são só espelho, porque a fonte oficial é o Mongo (D4).

### 4B. O que NÃO vai ao Drive (fica só no Mongo, ou nem isso)

Refeições estruturadas (só aparecem como texto no Diário e nos Resumos) · pesagens (com as descartadas) · **humor** · **eventos do app** · **correções do app** · **perguntas ao app** · **sugestões de refeição** (nem no Mongo) · sugestões de carga (`perfis.sugestoesCarga`) e treinos do Hevy · **sono, energia e atividade do dia** como números, com nota e fatores (o `Nutri-Saude.md` é só um resumo sobrescrito) · água e álcool · **despensa** e notas fiscais · histórico de **planos** (sobrescrito) · **pensamentos** · intervenções proativas · hipóteses fechadas (só as da semana) · atividades fixas e o que foi feito · lugares e visitas (a Ficha só tem um resumo) · apostas da semana · histórico da persona e das lições.

### 4C. Estrutura proposta (mesmo estilo: markdown com frontmatter, `tipo:` e tags `nutribot`)

| Arquivo | Conteúdo | Quando é escrito | A IA lê de volta? | P |
|---|---|---|---|---|
| `<Pessoa>/Dias/AAAA-MM/AAAA-MM-DD.md` | **o dia inteiro da pessoa**: refeições (hora, tipo, kcal, macros, descrição, link da foto), correções (app e WhatsApp), pesagens e fonte, sono (nota, fases, FC/VFC, oxigênio, temperatura), energia (nota e fatores), atividade (passos, minutos e kcal ativas, distância, exercícios, atividades fixas feitas), treino do Hevy (kg × reps, sugestão do dia), humor (números; o texto conforme D11), eventos do app, água e álcool, despensa (o que entrou e o que acabou), sugestões de refeição mostradas | no `fecharDia`, para o dia local que fechou de cada pessoa (com fuso próprio quando houver; regravar o dia anterior se chegar dado atrasado do relógio) | não: o Mongo é a fonte. O arquivo serve para o dono ler e de backup | **1** |
| `<Pessoa>/Semanas/AAAA-Www.md` | médias (kcal, proteína, sono, nota de sono, energia, passos, minutos ativos), peso no início e no fim, aposta e conferência, sugestões de carga e resultado, temas das perguntas e humor médio | `fecharSemana` | opcional: a Refl pode ler as 4 últimas no lugar de remontar | 2 |
| `<Pessoa>/Nutri-Despensa.md` | estado atual por categoria (quantidade, estado, validade) + compras dos últimos 28 dias | `fecharDia` (sobrescreve) | não | 2 |
| `<Pessoa>/Nutri-Pensamentos/AAAA-MM.md` | pensamentos do mês, com hora (acrescenta) | `fecharDia` | não | 2 |
| `<Pessoa>/Nutri-Conversas-App/AAAA-MM.md` | perguntas e respostas do app (acrescenta) | `fecharDia` | não | 2 |
| `<Pessoa>/Planos/AAAA-Www.md` | cada plano gerado (o `Nutri-Plano.md` continua sendo o atual) | `fecharSemana`, a partir da coleção `planos` | não | 2 |
| `Nutri-Ficha.md` (já existe) | ganha as seções "Atividades fixas" e "Metas de carga da semana" | quando já é escrito | — | 2 |
| `Perfis/Nutri-Proatividade.md` | quando ela puxou assunto, se responderam (acrescenta) | `fecharDia` | não | 3 |
| `Perfis/Nutri-Historico/` | versões anteriores da persona e das lições | quando mudam | não | 3 |

Exemplo do frontmatter do arquivo do dia:

```
---
tipo: dia-pessoa
pessoa: "[[Nome]]"
data: 2026-10-15
kcal: 1840
meta_kcal: 1900-2100
proteina_g: 128
peso_kg: 78.4
sono_min: 410
nota_sono: 72
energia: 64
passos: 9120
min_ativos: 48
humor: 4
tags: [nutribot, pessoa, dia]
---
```

Regras: `pessoas.js` precisa continuar ignorando as subpastas `Dias/`, `Semanas/`, `Planos/`, `Nutri-*/` e `Fotos/` no dossiê, senão a IA relê o próprio espelho. Falha no Drive nunca derruba o fechamento do dia (usar `naFilaDoArquivo` e registrar no log). Custo: cerca de 3 pessoas × 3 arquivos por noite + 6 por domingo. É irrelevante para a cota do Drive.

---

## 5. Riscos e decisões do dono

**Custo:**
- **IA:** os botões "pensar agora", "refletir", "gerar plano" e "estudar" chamam IA pesada (plano: até 4 tentativas no modelo principal; reflexão: mais de 3 chamadas). Proposta: só o dono, com limite diário (1 plano, 2 pensamentos, 1 reflexão por semana) e sem falar no grupo.
- **Tokens:** os blocos novos (sono, energia, humor da semana, perguntas) somam uns 300 a 600 tokens por resposta da Conv. O `contexto-app.js` soma de 2 a 3 mil tokens por pergunta no app, que já tem o teto de 20 por hora. Medir com `npm run avaliar` antes e depois.
- **Drive:** barato (seção 4).

**Vazamento no grupo:**
- A resposta do WhatsApp sai sempre no grupo, e a proteção é só uma regra no prompt. Cada dado privado novo (perguntas, texto do humor, oxigênio, temperatura) é um risco a mais.
- Proposta: cenários novos em `avaliacao/cenarios.mjs` ("não cite a pergunta do app", "não fale do oxigênio de outra pessoa") e um filtro em código no caminho do WhatsApp, equivalente ao `tirarLocalizacao`, para o bairro de casa.
- Pontos de vazamento que já existem: `blocoPerfis` leva as notas de todos (que podem citar o bairro); `lembrancasPara` traz as notas de pessoas citadas; `companhiaAtual` põe o nome de quem está a menos de 150 m.

**O que muda no comportamento do WhatsApp:**
- A Nutri passa a conhecer nota de sono e de energia e pode citar números novos no grupo. Proposta: usar no raciocínio e citar só se perguntarem.
- Uma resposta "teve vôlei?" dada no app precisa cancelar a pergunta no grupo.
- Voz e silêncio mudados no app valem para o grupo inteiro.
- Despensa editada no app não avisa o grupo; cupom continua avisando.

| # | Decisão | Recomendação |
|---|---|---|
| D10 | A Nutri do WhatsApp pode **mencionar** no grupo uma pergunta feita no app? | não: só leva em conta e retoma se a pessoa puxar |
| D11 | O texto do humor vai para o arquivo do dia no Drive (pasta da pessoa)? | sim, na pasta da pessoa, marcado como confidência |
| D12 | Oxigênio e temperatura da pele entram no `blocoPerfis` do grupo (D2) ou só no dossiê da pessoa? | só no dossiê da pessoa |
| D13 | Um plano gerado pelo app também é postado no grupo? | não: fica no app e no Drive, e o grupo recebe uma linha "plano novo no app" |
| D14 | Voz, silêncio, estudar e status pelo app: só o aparelho do dono? | sim (`ehDono`) |
| D15 | O app mostra despensa e atividades fixas das outras duas pessoas? | sim (não são sensíveis); lugares continuam só do dono |
| D16 | Perguntas do app: guardar para sempre ou por 180 dias? | para sempre no Drive e 180 dias no Mongo |
| D17 | Arquivo do dia: um por dia (cerca de 1.100 por ano somando as três pessoas) ou um por mês? | um por dia, em subpasta por mês |
| D18 | Fonte única da sugestão de carga: a do dia (`sugerirCargaExercicio`) substitui a semanal no WhatsApp? | sim; a semanal vira "meta da semana" calculada a partir dela |
| D19 | Travar os comandos destrutivos do grupo (`!reset`, `!estudar`, `!nome`, `!voz`) ao admin? | sim (achado: hoje qualquer pessoa pode) |
| D20 | Notas de voz: guardar o texto para o app e o Drive? | sim (barato) |

---

## 6. Plano em frentes (agentes em paralelo, sem conflito de arquivo)

**Pré-requisito:** a fase 6 (frentes S/L/H/T) estar fechada e com commit, porque ela edita `relogio.js`, `api-montadores.js`, `api.js`, os testes e as telas. Depois disso, A, B, C, D, E e F rodam em paralelo. Cada arquivo tem **um único dono**. Arquivos que nenhuma frente lista ficam só para leitura. `GUIA-PASSO-A-PASSO.md`, `package.json` e o contrato `docs/app/…-plano-fase7.md` são da frente I.

**Contratos fixados antes de começar** (para ninguém esperar ninguém): as rotas e respostas da seção 1; a coleção `perguntas_app` e as assinaturas de `perguntas.js` (seção 3); os campos novos do relógio, que são `atividades[dia].distanciaM`, `atividades[dia].kcalAtivas`, `porHora.kcalAtivas`, `sonos[dia].spo2 {media,min,minutosAbaixo90}` e `sonos[dia].temperatura {media,delta}`.

| Frente | Arquivos exclusivos | Entregas |
|---|---|---|
| **A — API das lacunas** | `api-lacunas.js` (novo: todas as rotas novas das seções 1 e 3), `api-lacunas-montadores.js` (novo, funções puras), `perguntas.js` (novo), `api.js` (1 linha de montagem + gravação no `/perguntar` + `anteriores` vindo do servidor), `api-escrita.js` (`PUT /perfis/:id` ampliado), `despensa.js` (validadeDias, usei a granel), `atividades.js` (`criarAtividadeDeObjeto`), `lugares.js` (marcar por id), `mongo.js` (índices `despensa {jid,k}` único, `notas.chave`, `perguntas_app`; `silencioAte` em `config`), `estado.js`, `test/api-lacunas.test.mjs`, `test/perguntas.test.mjs` | W10–W38, W44, W46, W57, W58 (leitura), W61, as rotas da seção 3; todas as ações de config com `ehDono` |
| **B — Contexto da IA** | `gemini.js`, `mensagens.js`, `perfis.js`, `contexto.js`, `pensamentos.js`, `reflexao.js`, `cobranca.js`, `saude.js` (só `indicadoresRelogio` e `resumoSaude`), `comandos.js` (entradas do plano e trava do admin em D19), `contexto-app.js` (novo: contexto único de `sugerirRefeicao` e `responderApp`), `avaliacao/cenarios.mjs`, `test/contexto-ia.test.mjs` | A03–A05, A09–A21 e A23 (os textos), P01–P05, perguntas do app em Conv, Pens e Refl (importa `perguntas.js` pelo contrato), cenários de privacidade; `npm run avaliar` sem regressão |
| **C — Drive** | `dia.js`, `drive-pessoa.js` (novo: montadores puros `mdDiaPessoa`, `mdSemanaPessoa`, `mdDespensa`, `mdPensamentos`, `mdConversasApp`, `mdPlanoSemana`), `drive.js` (`mdPerfil` com atividades fixas e metas de carga), `pessoas.js` (excluir as subpastas novas do dossiê), `test/drive-pessoa.test.mjs` | tudo da seção 4C; fechamento resistente a falha do Drive; gravar o texto da fala programada (`falas`, D20) |
| **D — Coletor (4 permissões)** | `android/.../legado/Leitor.kt`, `AndroidManifest.xml`, `relogio.js` (`normalizarEnvio`), `api-montadores.js` (`montarSono` com `spo2`, `temperatura` e os 2 fatores; `montarAtividade` com `distanciaKm` e kcal ativas oficiais), `dados/Modelos.kt` (só campos opcionais), `ui/telas/SonoDia.kt`, `ui/telas/Atividade.kt`, `ui/telas/Integracoes.kt` (botão de permissões), `test/relogio-envio.test.mjs`, `test/api-fase6.test.mjs` | seção 7 do plano da fase 6, com conferência do recurso de temperatura; envio antigo (Relógio 1.6) continua aceito; linha escondida quando falta o dado |
| **E — Telas: Comida e Hoje** | `ui/telas/Comida.kt`, `ui/telas/Hoje.kt`, `ui/telas/despensa/*` (novo: `Despensa.kt`, `Compras.kt`, `DespensaVM.kt`), `dados/ModelosDespensa.kt` (novo) | **Despensa** (lista por categoria, selos de validade, Acabou/Acabando/Usei/Tem/Comprei, adicionar, "ainda tem?"), Compras (cupons e enviar cupom), cartão de água e álcool no Hoje, cartão "teve vôlei?" no Hoje. Usa `Api.get/post/put/delete` sem mexer em `Api.kt` nem em `AppVM.kt` |
| **F — Telas: menu, Nutri e configurações** | `ui/App.kt`, `ui/AppVM.kt`, `ui/telas/Nutri.kt`, `ui/telas/Perguntar.kt`, `ui/telas/Perfil.kt`, `ui/telas/Agenda.kt`, `ui/telas/Resumos.kt`, novos `ui/telas/Lugares.kt`, `ui/telas/AtividadesFixas.kt`, `ui/telas/Configuracoes.kt`, `dados/ModelosNutriExtra.kt` | menu do nome com Lugares (só o dono), Atividades fixas e Configurações (voz, silêncio, nome, saúde do bot); Nutri com abas Lições, Quem ela é, Base de conhecimento, Quando ela puxou assunto, Documentos e Momentos; Perguntar com o histórico do servidor; Perfil com apelido, cidade, dieta e restrições; Agenda com eventos do Google; Resumos com o resumo do dia e as falas; botões "gerar plano" e "pensar agora" |
| **I — Integração** (depois de A a F) | `GUIA-PASSO-A-PASSO.md`, `package.json`, contrato da fase 7 | trocar `contextoSugestao` de `api.js` pelo `contexto-app.js` (uma linha, combinada com A); compilar o APK; `npm test` + `npm run avaliar`; conferir as rotas contra as telas |
| **R / F — Revisão e correção** | — | revisão adversarial focada em vazamento no grupo e no custo; corrigir só o que for confirmado |

**Ordem e dependências:**
- A, B, C e D são servidor e não compartilham arquivo.
- E e F programam contra o contrato com JSON de exemplo e não dependem de A estar pronto.
- B e C importam `perguntas.js` só pela assinatura. Se A atrasar, usam um stub no teste.
- D é a única frente que mexe em `api-montadores.js` e em `relogio.js` nesta rodada.
- Dois agentes compilando o Gradle ao mesmo tempo corrompem `compileReleaseKotlin`, então só a frente I compila o APK.
