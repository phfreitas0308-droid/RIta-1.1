// Divide um texto em blocos menores ("chunks"), por artigo/parágrafo/inciso,
// preservando a referência exata de cada trecho — versão em JavaScript da
// mesma lógica de scripts/chunk_laws.py, usada aqui pelo pipeline de
// atualização automática (api/cron/check-updates.js) para processar
// documentos novos encontrados pela busca do Google, em tempo real dentro da
// função serverless (que roda Node, não Python).
//
// Diferença importante em relação ao chunk_laws.py: documentos "descobertos"
// automaticamente podem não ter a estrutura de "Art. N" de uma lei (podem ser
// uma notícia, um ato/portaria em formato livre, etc.). Por isso,
// chunkGenericDocument() cai para uma divisão por tamanho fixo quando não
// encontra nenhum "Art. N" ou "ANEXO" no texto — em vez de fingir uma
// referência de artigo que não existe.

const MAX_CHUNK_CHARS = 2200;
const HARD_MAX_CHARS = 3200;

const ARTIGO_HEADER_RE = /^[ \t]*["'“]?Art\.\s*(\d+[ºo°]?(?:-[A-Z])?)\./gm;
const ANEXO_HEADER_RE = /^[ \t]*["'“]?ANEXO\s+([IVXLCDM]+(?:-[A-Z])?)\b/gm;
const PARAGRAFO_RE = /(§\s*\d+[ºo°]?(?:-[A-Z])?|Parágrafo único)\.?/g;
const INCISO_RE = /(?:^|\n)[ \t]*([IVXLCDM]{1,6})\s*[-–]\s+/gm;
const ALINEA_RE = /(?:^|\n)[ \t]*([a-z])\)\s+/gm;

const DOT_LEADER_RE = /\.{4,}/g;

function cleanText(text) {
  return text
    .replace(DOT_LEADER_RE, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isNoise(text) {
  const stripped = text.trim().replace(/^[\s.\-–—"'()]+|[\s.\-–—"'()]+$/g, "");
  if (stripped.length < 3) return true;
  if (["VETADO", "REVOGADO", "NR"].includes(stripped.toUpperCase())) return true;
  return false;
}

function normArtigoLabel(raw) {
  return `Art. ${raw}`;
}

function normParagrafoLabel(raw) {
  const trimmed = raw.trim().replace(/\.$/, "");
  if (trimmed.toLowerCase().startsWith("parágrafo")) return "Parágrafo único";
  return trimmed;
}

// Divide um texto em [{ rotulo, trecho }] usando os pontos de match de um
// regex global. O trecho antes do primeiro match ("caput") entra com rótulo null.
function splitByRegex(body, regex) {
  regex.lastIndex = 0;
  const matches = [];
  let m;
  while ((m = regex.exec(body))) {
    matches.push(m);
    if (m.index === regex.lastIndex) regex.lastIndex++; // evita loop infinito em match vazio
  }
  if (matches.length === 0) return [[null, body]];

  const parts = [];
  const head = body.slice(0, matches[0].index).trim();
  if (head && !isNoise(head)) parts.push([null, head]);

  for (let i = 0; i < matches.length; i++) {
    const label = matches[i][1];
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : body.length;
    const piece = body.slice(start, end).trim();
    if (piece && !isNoise(piece)) parts.push([label, piece]);
  }
  return parts;
}

// Rede de segurança final: corta um texto em pedaços de até maxChars,
// tentando quebrar em fronteiras de frase/espaço em vez de no meio de uma palavra.
function hardSplit(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const parts = [];
  let remaining = text;
  while (remaining.length > maxChars) {
    let cut = remaining.lastIndexOf(". ", maxChars);
    if (cut < maxChars * 0.5) cut = remaining.lastIndexOf(" ", maxChars);
    if (cut <= 0) cut = maxChars;
    parts.push(remaining.slice(0, cut + 1).trim());
    remaining = remaining.slice(cut + 1).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function mergeSmallChunks(chunks, minLen = 40) {
  const merged = [];
  for (const c of chunks) {
    const prev = merged[merged.length - 1];
    if (prev && c.texto.length < minLen && prev.lei === c.lei && prev.artigo === c.artigo) {
      prev.texto = (prev.texto.trimEnd() + " " + c.texto.trim()).trim();
    } else {
      merged.push(c);
    }
  }
  return merged;
}

function buildReferencia(lei, { artigoLabel, paragrafoLabel, incisoLabel, alineaLabel, anexoLabel, parte } = {}) {
  const bits = [];
  if (artigoLabel) bits.push(artigoLabel);
  if (anexoLabel) bits.push(`Anexo ${anexoLabel}`);
  if (paragrafoLabel) bits.push(paragrafoLabel);
  if (incisoLabel) bits.push(`inciso ${incisoLabel}`);
  if (alineaLabel) bits.push(`alínea "${alineaLabel}"`);
  let ref = bits.length ? `${bits.join(", ")}, ${lei}` : lei;
  if (parte) ref += ` (parte ${parte})`;
  return ref;
}

function emitArtigoChunks(lei, artigoLabel, body, chunks) {
  for (const [paragrafoRaw, ptxt] of splitByRegex(body, PARAGRAFO_RE)) {
    const paragrafoLabel = paragrafoRaw ? normParagrafoLabel(paragrafoRaw) : null;

    if (ptxt.length <= MAX_CHUNK_CHARS) {
      chunks.push({
        lei,
        artigo: artigoLabel,
        paragrafo: paragrafoLabel,
        referencia: buildReferencia(lei, { artigoLabel, paragrafoLabel }),
        texto: ptxt,
      });
      continue;
    }

    for (const [incisoLabel, itxt] of splitByRegex(ptxt, INCISO_RE)) {
      if (itxt.length <= MAX_CHUNK_CHARS) {
        chunks.push({
          lei,
          artigo: artigoLabel,
          paragrafo: paragrafoLabel,
          referencia: buildReferencia(lei, { artigoLabel, paragrafoLabel, incisoLabel }),
          texto: itxt,
        });
        continue;
      }

      for (const [alineaLabel, atxt] of splitByRegex(itxt, ALINEA_RE)) {
        if (atxt.length <= HARD_MAX_CHARS) {
          chunks.push({
            lei,
            artigo: artigoLabel,
            paragrafo: paragrafoLabel,
            referencia: buildReferencia(lei, { artigoLabel, paragrafoLabel, incisoLabel, alineaLabel }),
            texto: atxt,
          });
        } else {
          hardSplit(atxt, HARD_MAX_CHARS).forEach((part, idx) => {
            chunks.push({
              lei,
              artigo: artigoLabel,
              paragrafo: paragrafoLabel,
              referencia: buildReferencia(lei, { artigoLabel, paragrafoLabel, incisoLabel, alineaLabel, parte: idx + 1 }),
              texto: part,
            });
          });
        }
      }
    }
  }
}

function emitAnexoChunks(lei, anexoLabel, body, chunks) {
  const trimmed = body.trim();
  if (!trimmed || isNoise(trimmed)) return;
  const parts = trimmed.length > MAX_CHUNK_CHARS ? hardSplit(trimmed, MAX_CHUNK_CHARS) : [trimmed];
  const multi = parts.length > 1;
  parts.forEach((part, idx) => {
    chunks.push({
      lei,
      artigo: null,
      paragrafo: null,
      referencia: buildReferencia(lei, { anexoLabel, parte: multi ? idx + 1 : null }),
      texto: part,
    });
  });
}

// Divide um texto de lei (com estrutura "Art. N" / "ANEXO N") em blocos.
function chunkLawText(rawText, lei) {
  const text = cleanText(rawText);

  const boundaries = [];
  ARTIGO_HEADER_RE.lastIndex = 0;
  let m;
  while ((m = ARTIGO_HEADER_RE.exec(text))) {
    boundaries.push({ pos: m.index, kind: "artigo", label: normArtigoLabel(m[1]), bodyStart: ARTIGO_HEADER_RE.lastIndex });
  }
  ANEXO_HEADER_RE.lastIndex = 0;
  while ((m = ANEXO_HEADER_RE.exec(text))) {
    boundaries.push({ pos: m.index, kind: "anexo", label: m[1], bodyStart: ANEXO_HEADER_RE.lastIndex });
  }
  boundaries.sort((a, b) => a.pos - b.pos);

  const chunks = [];
  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    const bodyEnd = i + 1 < boundaries.length ? boundaries[i + 1].pos : text.length;
    const body = text.slice(b.bodyStart, bodyEnd).trim();
    if (!body || isNoise(body)) continue;
    if (b.kind === "artigo") emitArtigoChunks(lei, b.label, body, chunks);
    else emitAnexoChunks(lei, b.label, body, chunks);
  }

  return { chunks: mergeSmallChunks(chunks), estruturado: boundaries.length > 0 };
}

// Ponto de entrada usado pelo cron: tenta dividir como uma lei estruturada
// (Art. N / ANEXO); se o documento não tiver nenhuma dessas marcações (ex.:
// uma notícia, um comunicado em formato livre), cai para divisão por tamanho
// fixo, sem inventar uma referência de artigo que não existe no texto.
function chunkGenericDocument(rawText, label) {
  const { chunks, estruturado } = chunkLawText(rawText, label);
  if (estruturado && chunks.length > 0) return chunks;

  const cleaned = cleanText(rawText);
  if (!cleaned || isNoise(cleaned)) return [];

  const parts = cleaned.length > MAX_CHUNK_CHARS ? hardSplit(cleaned, MAX_CHUNK_CHARS) : [cleaned];
  const multi = parts.length > 1;
  const generic = [];
  parts.forEach((part, idx) => {
    if (isNoise(part)) return;
    generic.push({
      lei: label,
      artigo: null,
      paragrafo: null,
      referencia: multi ? `${label} (parte ${idx + 1})` : label,
      texto: part,
    });
  });
  return mergeSmallChunks(generic);
}

module.exports = { chunkLawText, chunkGenericDocument };
