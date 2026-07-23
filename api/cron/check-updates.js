// Pipeline de atualização automática da base de conhecimento da RITA.
//
// Roda periodicamente (configurado em vercel.json > "crons"), sem intervenção
// manual: busca no Google por publicações novas sobre a Reforma Tributária,
// baixa e extrai o texto de cada página/PDF ainda não visto, divide em blocos
// (lib/chunker.js), gera embeddings (OpenAI) e publica no índice automático
// (Vercel Blob) — o chat já passa a usar esse conteúdo na próxima pergunta,
// sem precisar de um novo deploy.
//
// AVISO IMPORTANTE: esse pipeline publica o conteúdo encontrado SEM revisão
// humana antes de entrar na base (foi a opção escolhida ao configurar este
// recurso). Isso significa que, se a busca do Google trouxer uma página que
// não é realmente uma norma oficial (ex.: uma notícia especulativa, um
// rascunho de projeto de lei que ainda pode mudar), esse conteúdo pode acabar
// sendo usado nas respostas da RITA como se fosse texto legal. O changelog em
// /api/changelog existe justamente para você conseguir auditar depois o que
// foi adicionado e quando — vale a pena checar essa página de vez em quando.
//
// Variáveis de ambiente necessárias (veja o README):
//   GOOGLE_API_KEY, GOOGLE_CSE_ID   - busca no Google
//   OPENAI_API_KEY                  - já configurada para o chat normal
//   BLOB_READ_WRITE_TOKEN           - criado automaticamente ao ligar um Blob Store ao projeto
//   CRON_SECRET (opcional, recomendado) - protege este endpoint contra chamadas externas

const { searchForUpdates } = require("../../lib/google_search");
const { fetchAndExtractText } = require("../../lib/fetch_extract");
const { chunkGenericDocument } = require("../../lib/chunker");
const { embedBatch } = require("../../lib/embeddings_client");
const {
  blobConfigured,
  getManifest,
  saveManifest,
  saveDocumentChunks,
  appendChangelog,
} = require("../../lib/blob_store");

const MIN_TEXT_LENGTH = 1500; // descarta páginas claramente curtas/irrelevantes demais para valer a pena indexar
const EMBED_BATCH_SIZE = 100;

function slugify(text) {
  return (
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-+|-+$)/g, "")
      .slice(0, 80) || "documento"
  );
}

module.exports = async function handler(req, res) {
  // Protege o endpoint: a Vercel Cron envia automaticamente um cabeçalho
  // "Authorization: Bearer <CRON_SECRET>" quando essa variável está definida.
  // Sem isso, qualquer pessoa que descobrisse a URL poderia disparar o
  // processo (e gastar sua cota da OpenAI/Google) manualmente.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Não autorizado." });
    }
  }

  if (!blobConfigured()) {
    return res.status(200).json({
      skipped: true,
      motivo:
        "BLOB_READ_WRITE_TOKEN não configurado (ou pacote @vercel/blob ausente) — crie um Blob Store na Vercel e conecte ao projeto para ativar a atualização automática.",
    });
  }

  const googleKey = process.env.GOOGLE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!googleKey || !cseId) {
    return res.status(200).json({ skipped: true, motivo: "GOOGLE_API_KEY e/ou GOOGLE_CSE_ID não configurados." });
  }
  if (!openaiKey) {
    return res.status(200).json({ skipped: true, motivo: "OPENAI_API_KEY não configurada." });
  }

  const manifest = await getManifest();
  const seenUrls = new Set(manifest.seenUrls || []);

  let results;
  try {
    results = await searchForUpdates(googleKey, cseId);
  } catch (err) {
    console.error("Erro na busca do Google:", err);
    return res.status(500).json({ error: "Falha ao buscar atualizações no Google.", detalhe: err.message });
  }

  const novos = results.filter((r) => !seenUrls.has(r.link));
  const processados = [];
  const falhas = [];

  for (const item of novos) {
    seenUrls.add(item.link); // marca como visto mesmo se descartado, pra não tentar de novo toda execução

    try {
      const { text, title } = await fetchAndExtractText(item.link);

      if (!text || text.length < MIN_TEXT_LENGTH) {
        falhas.push({ url: item.link, motivo: "conteúdo muito curto ou não extraído" });
        continue;
      }

      const label = title || item.title || item.link;
      const chunks = chunkGenericDocument(text, label);
      if (chunks.length === 0) {
        falhas.push({ url: item.link, motivo: "nenhum bloco gerado a partir do texto extraído" });
        continue;
      }

      const chunksComEmbedding = [];
      for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
        const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
        const embeddings = await embedBatch(openaiKey, batch.map((c) => c.texto.slice(0, 6000)));
        batch.forEach((c, j) => chunksComEmbedding.push({ ...c, embedding: embeddings[j] }));
      }

      const slug = `${slugify(label)}-${Date.now()}`;
      await saveDocumentChunks(slug, chunksComEmbedding);

      manifest.documentos = manifest.documentos || [];
      manifest.documentos.push({
        slug,
        titulo: label,
        url: item.link,
        chunkCount: chunks.length,
        addedAt: new Date().toISOString(),
      });

      await appendChangelog({
        date: new Date().toISOString(),
        titulo: label,
        url: item.link,
        chunkCount: chunks.length,
      });

      processados.push({ url: item.link, titulo: label, chunkCount: chunks.length });
    } catch (err) {
      console.error(`Erro processando ${item.link}:`, err);
      falhas.push({ url: item.link, motivo: err.message });
    }
  }

  manifest.seenUrls = Array.from(seenUrls);
  manifest.lastRunAt = new Date().toISOString();
  await saveManifest(manifest);

  return res.status(200).json({
    encontrados: results.length,
    novos: novos.length,
    processados,
    falhas,
  });
};
