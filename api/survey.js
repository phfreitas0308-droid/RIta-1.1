// Recebe as respostas da pesquisa de perfil (as 8 perguntas que a RITA faz no
// próprio chat quando o visitante atinge o limite de perguntas da conversa —
// ver index.html, função iniciarPesquisa) e guarda no Vercel Blob, para você
// poder consultar depois em api/survey-log.js.
//
// Se o Blob Store não estiver conectado ao projeto, este endpoint não falha —
// só não guarda nada (o chat continua funcionando normalmente, sem esse
// registro no servidor).

const { blobConfigured, appendSurveyResponse } = require("../lib/blob_store");

// Mesma lista de campos usada no frontend (index.html) — mantém aqui só os
// campos esperados, descartando qualquer coisa extra que venha no corpo da
// requisição, por segurança.
const CAMPOS_ESPERADOS = [
  "nome",
  "cargo",
  "empresa",
  "nivelConhecimento",
  "duvidas",
  "aprofundar",
  "desafio",
  "projetos",
  "regimeEspecificoGeral",
  "creditamento",
  "frequenciaConsulta",
];

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido. Use POST." });
  }

  const { respostas } = req.body || {};
  if (!respostas || typeof respostas !== "object") {
    return res.status(400).json({ error: "Campo 'respostas' é obrigatório." });
  }

  if (blobConfigured()) {
    const entry = { dataHora: new Date().toISOString() };
    for (const campo of CAMPOS_ESPERADOS) {
      const valor = respostas[campo];
      entry[campo] = valor == null ? "" : String(valor).trim().slice(0, 1000);
    }
    try {
      await appendSurveyResponse(entry);
    } catch (err) {
      console.error("Falha ao gravar resposta da pesquisa:", err.message);
      // não retorna erro pro navegador — o chat não deve travar por causa disso
    }
  }

  return res.status(200).json({ ok: true });
};
