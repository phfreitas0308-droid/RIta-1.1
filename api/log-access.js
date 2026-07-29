// Recebe um registro de login (nome/cargo/empresa) vindo do navegador e
// guarda no Vercel Blob, para você poder auditar depois quem acessou o chat
// (veja api/access-log.js). Não tem senha nem controle de permissão — é só
// um registro informativo de "quem entrou e quando".
//
// Se o Blob Store não estiver conectado ao projeto, este endpoint não
// falha — só não guarda nada (o login continua funcionando normalmente no
// navegador, sem esse registro no servidor).

const { blobConfigured, appendAccessLog } = require("../lib/blob_store");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido. Use POST." });
  }

  const { nome, cargo, empresa } = req.body || {};
  if (!nome || typeof nome !== "string" || !nome.trim()) {
    return res.status(400).json({ error: "Campo 'nome' é obrigatório." });
  }

  if (blobConfigured()) {
    const entry = {
      nome: nome.trim().slice(0, 200),
      cargo: (cargo || "").toString().trim().slice(0, 200),
      empresa: (empresa || "").toString().trim().slice(0, 200),
      dataHora: new Date().toISOString(),
    };
    try {
      await appendAccessLog(entry);
    } catch (err) {
      console.error("Falha ao gravar log de acesso:", err.message);
      // não retorna erro pro navegador — o login não deve travar por causa disso
    }
  }

  return res.status(200).json({ ok: true });
};
