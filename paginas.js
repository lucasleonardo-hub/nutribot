// paginas.js - Páginas públicas do serviço (início e política de privacidade).
// Existem por dois motivos: o Google exige URL de página inicial e de política de privacidade pra publicar o app OAuth
// que dá acesso ao Drive e à Agenda; e é honesto ter escrito, em algum lugar, o que o bot faz com os dados.

const ESTILO = `body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:760px;margin:0 auto;padding:24px 20px 64px;line-height:1.6;color:#1b1b1b;background:#fafafa}
h1{font-size:1.6rem;margin-bottom:.2em}h2{font-size:1.1rem;margin-top:1.8em}
code{background:#eee;padding:1px 5px;border-radius:4px}
a{color:#146c43}ul{padding-left:1.2em}small{color:#666}
.card{background:#fff;border:1px solid #e3e3e3;border-radius:10px;padding:18px 20px;margin:14px 0}`;

// Quem responde pelo bot (aparece no rodapé e na política de privacidade). Sem .env, fica genérico.
const CONTATO_NOME = process.env.CONTATO_NOME || 'o administrador do bot';
const CONTATO_EMAIL = process.env.CONTATO_EMAIL || '(e-mail não informado)';

const molde = (titulo, corpo) =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<title>${titulo}</title><style>${ESTILO}</style></head><body>${corpo}</body></html>`;

export const paginaInicial = () =>
  molde(
    'NutriBot',
    `<h1>NutriBot</h1>
<p>Assistente de nutrição privado, usado por um grupo fechado de amigos no WhatsApp. Não é um produto aberto ao público
e não aceita cadastro: funciona apenas dentro do grupo de quem o instalou.</p>
<div class="card">
  <h2>O que ele faz</h2>
  <ul>
    <li>Lê as mensagens do grupo e analisa fotos e descrições de refeições, estimando calorias e macronutrientes.</li>
    <li>Guarda o histórico alimentar de cada participante e monta resumos diários, semanais e mensais.</li>
    <li>Lê dados de saúde e de treino que o próprio participante conecta (peso, sono, passos, séries e cargas).</li>
    <li>Escreve esses resumos em uma pasta do Google Drive da conta que instalou o bot.</li>
    <li>Quando autorizado, lê a agenda do Google do dono da conta para encaixar as refeições na rotina.</li>
  </ul>
</div>
<p><a href="/privacidade">Política de Privacidade</a></p>
<p><small>Projeto pessoal, sem fins comerciais. Contato: ${CONTATO_EMAIL}</small></p>`
  );

export const paginaPrivacidade = () =>
  molde(
    'NutriBot · Política de Privacidade',
    `<h1>Política de Privacidade</h1>
<p><small>Atualizada em 25 de setembro de 2026.</small></p>

<p>O NutriBot é um assistente de nutrição privado, operado por uma pessoa física para uso de um grupo fechado de
WhatsApp. Não há venda, aluguel ou compartilhamento de dados com terceiros para fins comerciais, publicitários ou de
treinamento de modelos.</p>

<h2>Quais dados são tratados</h2>
<ul>
  <li><strong>Mensagens do grupo</strong>: texto, fotos e áudios enviados no grupo em que o bot está.</li>
  <li><strong>Dados alimentares</strong>: refeições relatadas, estimativas de calorias e macronutrientes.</li>
  <li><strong>Dados de saúde e treino</strong>, apenas quando o próprio participante conecta a fonte: peso, composição
      corporal, sono, passos e treinos de força (séries, cargas e repetições).</li>
  <li><strong>Google Drive</strong>: o bot cria e mantém uma pasta própria com os resumos e anotações, e lê os arquivos
      que o participante deliberadamente coloca na pasta dele.</li>
  <li><strong>Google Agenda</strong>, apenas se autorizado e apenas em modo leitura: título, horário e duração dos
      compromissos, usados para saber quando a pessoa está ocupada e encaixar as refeições na rotina. A agenda de uma
      pessoa nunca é comentada com outra pessoa do grupo.</li>
</ul>

<h2>Como os dados são usados</h2>
<p>Exclusivamente para gerar as respostas, os resumos e o acompanhamento nutricional dentro do próprio grupo. Trechos das
conversas e as imagens de refeição são enviados a provedores de modelos de linguagem (Google Gemini e, em caso de falha,
provedores alternativos) apenas para produzir a resposta daquele momento.</p>

<h2>Onde ficam guardados</h2>
<ul>
  <li>Banco de dados MongoDB Atlas, de acesso restrito ao operador.</li>
  <li>Pasta do Google Drive da conta Google que instalou o bot.</li>
  <li>Servidor de aplicação na Render, sem armazenamento local permanente.</li>
</ul>
<p>Credenciais e chaves de acesso ficam em variáveis de ambiente e nunca no código-fonte.</p>

<h2>Escopos do Google e por que são pedidos</h2>
<ul>
  <li><code>drive</code>: criar e manter a pasta do bot, com os resumos, e ler os documentos que o usuário colocar lá.</li>
  <li><code>calendar.readonly</code>: somente leitura da agenda, para saber os horários ocupados e livres. O bot nunca
      cria, altera ou apaga eventos.</li>
</ul>

<h2>Seus direitos</h2>
<p>Qualquer participante pode, a qualquer momento: pedir ao operador a exclusão dos seus dados; remover o bot do grupo,
o que encerra a coleta; e revogar o acesso do aplicativo à conta Google em
<a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>, o que interrompe imediatamente o
acesso ao Drive e à Agenda.</p>

<h2>Retenção</h2>
<p>Os dados são mantidos enquanto o bot estiver em uso pelo grupo, e apagados a pedido do titular.</p>

<h2>Contato</h2>
<p>Responsável pelo tratamento: ${CONTATO_NOME} — ${CONTATO_EMAIL}</p>

<p><a href="/">Voltar</a></p>`
  );
