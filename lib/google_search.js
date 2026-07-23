// Cliente para a API de Busca Personalizada do Google (Custom Search JSON API).
// Usado em dois lugares diferentes:
//   1. api/cron/check-updates.js  -> searchForUpdates() - acha publicações
//      OFICIAIS novas (leis, atos normativos) para indexar automaticamente.
//   2. api/chat.js                -> searchWeb() - busca ao vivo, a cada
//      pergunta, para trazer contexto adicional (notícias, discussões,
//      impacto prático) além do que está no texto das leis.
//
// Requer duas credenciais (veja o README, seção "Atualização automática"):
//   GOOGLE_API_KEY  - chave de API criada no Google Cloud Console
//   GOOGLE_CSE_ID   - ID do mecanismo de busca criado em programmablesearchengine.google.com

const GOOGLE_SEARCH_URL = "https://www.googleapis.com/customsearch/v1";

// Consultas pensadas para achar publicações oficiais novas (leis, projetos de
// lei, atos do Comitê Gestor do IBS) em vez de notícias genéricas — reduz o
// risco de indexar conteúdo de opinião/imprensa como se fosse texto legal.
const DEFAULT_QUERIES = [
  "Lei Complementar Reforma Tributária IBS CBS site:planalto.gov.br",
  "Reforma Tributária IBS CBS regulamentação site:in.gov.br",
  "Projeto de Lei Complementar Reforma Tributária site:camara.leg.br",
  "Reforma Tributária IBS CBS site:senado.leg.br",
  "Comitê Gestor do IBS resolução ato normativo site:gov.br",
];

// dateRestrict="d7" limita a resultados indexados pelo Google nos últimos 7
// dias. Rodamos o cron diariamente, mas usamos uma janela maior que 1 dia como
// rede de segurança (caso uma execução falhe, atrase, ou o Google demore a
// indexar uma página recém-publicada).
async function searchForUpdates(apiKey, cseId, { queries = DEFAULT_QUERIES, dateRestrict = "d7" } = {}) {
  const allResults = [];

  for (const q of queries) {
    const url = new URL(GOOGLE_SEARCH_URL);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("cx", cseId);
    url.searchParams.set("q", q);
    if (dateRestrict) url.searchParams.set("dateRestrict", dateRestrict);
    url.searchParams.set("num", "10");

    let data;
    try {
      const res = await fetch(url.toString());
      data = await res.json();
      if (!res.ok) {
        console.error(`Erro na busca do Google para "${q}":`, data);
        continue;
      }
    } catch (err) {
      console.error(`Falha de rede na busca do Google para "${q}":`, err.message);
      continue;
    }

    for (const item of data.items || []) {
      allResults.push({
        title: item.title,
        link: item.link,
        snippet: item.snippet,
        query: q,
      });
    }
  }

  // Remove duplicatas (o mesmo link pode aparecer em mais de uma consulta).
  const seen = new Set();
  return allResults.filter((r) => {
    if (seen.has(r.link)) return false;
    seen.add(r.link);
    return true;
  });
}

// Busca ao vivo para uma pergunta do usuário no chat — usada por api/chat.js
// para trazer contexto adicional além do texto das leis (ex.: notícias sobre
// como empresas estão se preparando, discussões práticas sobre um tema).
// Sem restrição de data e sem reescrever a pergunta com "site:" (usa o
// mecanismo de busca do jeito que você configurou em programmablesearchengine.google.com —
// se ele estiver restrito a sites oficiais, a busca sai restrita também).
async function searchWeb(apiKey, cseId, question, { num = 4 } = {}) {
  const url = new URL(GOOGLE_SEARCH_URL);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cseId);
  url.searchParams.set("q", `Reforma Tributária ${question}`);
  url.searchParams.set("num", String(num));

  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok) {
    throw new Error("Erro da API de busca do Google: " + JSON.stringify(data));
  }

  return (data.items || []).map((item) => ({
    title: item.title,
    link: item.link,
    snippet: item.snippet,
  }));
}

module.exports = { searchForUpdates, searchWeb, DEFAULT_QUERIES };
