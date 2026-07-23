// Cliente para a API de Busca Personalizada do Google (Custom Search JSON API),
// usado pelo cron de atualização automática para procurar novidades oficiais
// sobre a Reforma Tributária.
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

module.exports = { searchForUpdates, DEFAULT_QUERIES };
