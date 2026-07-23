// Endpoint só-leitura para você auditar o que o pipeline de atualização
// automática (api/cron/check-updates.js) já adicionou à base — já que esse
// pipeline publica sem revisão humana antes, esta é a forma de conferir depois
// o que entrou. Acesse https://seu-site.vercel.app/api/changelog no navegador.

const { blobConfigured, getChangelog, getManifest } = require("../lib/blob_store");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (!blobConfigured()) {
    return res.status(200).json({
      ativo: false,
      motivo: "Atualização automática não configurada (BLOB_READ_WRITE_TOKEN ausente).",
    });
  }

  const [changelog, manifest] = await Promise.all([getChangelog(), getManifest()]);

  return res.status(200).json({
    ativo: true,
    ultimaExecucao: manifest.lastRunAt || null,
    totalDocumentosAutomaticos: (manifest.documentos || []).length,
    historico: changelog,
  });
};
