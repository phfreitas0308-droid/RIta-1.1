// Baixa uma URL (página HTML ou PDF) e extrai o texto puro, para o pipeline de
// atualização automática processar (chunking + embeddings).

const pdfParse = require("pdf-parse");
const cheerio = require("cheerio");

async function fetchAndExtractText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; RITA-bot-atualizacao/1.0)" },
  });
  if (!res.ok) {
    throw new Error(`Falha ao baixar ${url}: HTTP ${res.status}`);
  }

  const contentType = res.headers.get("content-type") || "";
  const buffer = Buffer.from(await res.arrayBuffer());

  if (contentType.includes("pdf") || url.toLowerCase().endsWith(".pdf")) {
    const parsed = await pdfParse(buffer);
    return { text: parsed.text || "", title: null, tipo: "pdf" };
  }

  const html = buffer.toString("utf-8");
  const $ = cheerio.load(html);
  $("script, style, nav, header, footer, noscript").remove();
  const title = $("title").first().text().trim() || null;
  const text = $("body")
    .text()
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, title, tipo: "html" };
}

module.exports = { fetchAndExtractText };
