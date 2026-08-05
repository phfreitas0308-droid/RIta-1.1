"""
Divide os textos das leis da Reforma Tributária em blocos menores ("chunks"),
por artigo/parágrafo/inciso, preservando a referência exata de cada trecho
(ex.: "Art. 47, § 2º, inciso III, LC 214/2025").

COMO RODAR (só é necessário se uma lei for atualizada/nova):
    cd reforma-tributaria-chatbot
    python3 scripts/chunk_laws.py

Lê os textos brutos de sources/*.txt (extraídos dos PDFs/DOCX oficiais com
pdftotext -layout / python-docx) e grava o resultado em
data/chunks_leis_reforma_tributaria.json.

IMPORTANTE: depois de rodar este script, o índice de busca (embeddings) fica
desatualizado — é preciso rodar `node scripts/build_index.js` de novo (com sua
OPENAI_API_KEY) para os arquivos data/index_*.json refletirem os novos blocos.

Nota sobre uma correção importante (v2): os "Anexos" de cada lei (tabelas de
código NCM/SH, listas de produtos da Cesta Básica etc.) vêm depois do último
artigo do texto. Na primeira versão deste script, esse conteúdo não era
reconhecido como uma seção própria e acabava sendo "engolido" pelo último
artigo, virando um único bloco gigantesco (quase 96 mil caracteres, no caso da
LC 214/2025) — o que é praticamente inútil para busca por similaridade (a
"embedding" de um bloco desse tamanho fica genérica demais para representar
qualquer trecho específico). Agora cada Anexo vira sua própria seção,
subdividida em partes de tamanho controlado quando necessário.
"""

import json
import re
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SOURCES_DIR = os.path.join(SCRIPT_DIR, "..", "sources")
OUT_PATH = os.path.join(SCRIPT_DIR, "..", "data", "chunks_leis_reforma_tributaria.json")

LAW_FILES = {
    "ec132.txt": "EC 132/2023",
    "lc214.txt": "LC 214/2025",
    "lc227.txt": "LC 227/2026",
    "decreto_12955.txt": "Decreto 12.955/2026",
}

MAX_CHUNK_CHARS = 2200   # tamanho-alvo antes de subdividir por inciso/alínea
HARD_MAX_CHARS = 3200    # teto rígido — corta em partes de tamanho fixo se necessário

# IMPORTANTE (corrigido em 05/ago, ao adicionar o Decreto 12.955/2026): a
# convenção de redação legislativa brasileira NÃO coloca ponto depois do
# número quando o artigo é de 1 a 9 (ex.: "Art. 1º", "Art. 9º" — sem ponto),
# só a partir do Art. 10 em diante (ex.: "Art. 10.", "Art. 11."). A versão
# antiga deste regex exigia um ponto logo após o número em TODOS os casos —
# isso fazia com que os Arts. 1º a 9º de TODAS as leis (EC 132/2023,
# LC 214/2025, LC 227/2026) nunca fossem reconhecidos como início de artigo e
# ficassem de fora do índice de busca (incluindo dispositivos centrais, como
# o Art. 4º/5º/6º de incidência do IBS/CBS). Agora o ponto é opcional, exigindo
# só que o que vem depois seja um espaço/quebra de linha (para não confundir
# com outra coisa).
ARTIGO_HEADER_RE = re.compile(r'^[ \t]*[\"\'“]?Art\.\s*(\d+[ºo°]?(?:-[A-Z])?)\.?(?=\s)', re.MULTILINE)
ANEXO_HEADER_RE = re.compile(r'^[ \t]*[\"\'“]?ANEXO\s+([IVXLCDM]+(?:-[A-Z])?)\b', re.MULTILINE)
# Exige que o "§ N" esteja no início de uma linha (como já era feito para
# INCISO_RE/ALINEA_RE abaixo). Sem essa âncora, uma frase como "...a
# informação a que se refere o inciso I do § 1º deste artigo..." (uma
# referência textual a OUTRO parágrafo, no meio da frase) era confundida com
# o início de um novo parágrafo — cortando o texto no lugar errado e fazendo
# esse pedaço (que na verdade pertence a outro parágrafo) ficar rotulado como
# se fosse "§ 1º". Foi esse bug que, combinado com a duplicação de
# redação antiga/nova, fez o Art. 32 §1º da LC 214/2025 ficar com uma
# referência correta mas texto errado mesmo depois da primeira correção.
PARAGRAFO_RE = re.compile(r'(?:^|\n)[ \t]*(§\s*\d+[ºo°]?(?:-[A-Z])?|Parágrafo único)\.?')
INCISO_RE = re.compile(r'(?:^|\n)[ \t]*([IVXLCDM]{1,6})\s*[-–]\s+')
ALINEA_RE = re.compile(r'(?:^|\n)[ \t]*([a-z])\)\s+')

NOISE_LINE_RE = re.compile(
    r'^[ \t]*(Produção de efeitos|Vigência|Mensagem de veto|\(Promulgação[^\n]*\)|'
    r'\d{1,2}/\d{1,2}/\d{2,4},.*|https?://\S+|Página\s+\d+.*|'
    r'Este texto não substitui.*|Presidência da República|Casa Civil|'
    r'Secretaria Especial para Assuntos Jurídicos|CÂMARA DOS DEPUTADOS|'
    r'Centro de Documentação e Informação)\s*$',
    re.MULTILINE,
)
DOT_LEADER_RE = re.compile(r'\.{4,}')


def clean_text(text: str) -> str:
    text = NOISE_LINE_RE.sub('', text)
    text = text.replace('Produção de efeitos', '')
    text = DOT_LEADER_RE.sub(' ', text)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n[ \t]+', '\n', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def is_noise(text: str) -> bool:
    stripped = text.strip(' \n\t.-–—"\'()')
    if len(stripped) < 3:
        return True
    if stripped.upper() in ('VETADO', 'REVOGADO', 'NR'):
        return True
    return False


def norm_artigo_label(raw: str) -> str:
    return f"Art. {raw}"


def norm_paragrafo_label(raw: str) -> str:
    raw = raw.strip().rstrip('.')
    if raw.lower().startswith('parágrafo'):
        return 'Parágrafo único'
    return raw


def split_by_regex(body: str, pattern: re.Pattern):
    """Divide um texto em (rótulo_ou_None, trecho) usando os pontos de match do padrão.
    O trecho antes do primeiro match (o "caput") entra com rótulo None."""
    matches = list(pattern.finditer(body))
    if not matches:
        return [(None, body)]
    parts = []
    head = body[: matches[0].start()].strip()
    if head and not is_noise(head):
        parts.append((None, head))
    for i, m in enumerate(matches):
        label = m.group(1)
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        piece = body[start:end].strip()
        if piece and not is_noise(piece):
            parts.append((label, piece))
    return parts


def hard_split(text: str, max_chars: int):
    """Rede de segurança final: corta um texto em pedaços de até max_chars,
    tentando quebrar em fronteiras de frase/espaço em vez de no meio de uma palavra."""
    if len(text) <= max_chars:
        return [text]
    parts = []
    remaining = text
    while len(remaining) > max_chars:
        cut = remaining.rfind('. ', 0, max_chars)
        if cut < max_chars * 0.5:
            cut = remaining.rfind(' ', 0, max_chars)
        if cut <= 0:
            cut = max_chars
        parts.append(remaining[:cut + 1].strip())
        remaining = remaining[cut + 1:].strip()
    if remaining:
        parts.append(remaining)
    return parts


REDACAO_LC227_RE = re.compile(
    r'\((?:Reda[cç][aã]o dada|Inclu[ií]d[oa]|Acrescentado)[^)]*Lei Complementar\s*n[ºo°]?\s*227[^)]*\)',
    re.IGNORECASE,
)


def dedupe_superseded_redacao(chunks):
    """O texto de LC 214/2025 (extraído da página de texto compilado do
    planalto.gov.br) mostra, lado a lado, a redação ORIGINAL de um artigo/
    parágrafo/inciso e, logo em seguida, a redação NOVA dada pela LC 227/2026
    (marcada com "(Redação dada pela Lei Complementar nº 227, de 2026)" ou
    "(Incluído pela Lei Complementar nº 227, de 2026)"). Como as duas versões
    têm exatamente a mesma referência (ex.: "Art. 32, § 1º, LC 214/2025"),
    sem essa deduplicação as DUAS ficavam indexadas como se fossem igualmente
    válidas — a busca podia trazer ora uma, ora outra, e o chatbot chegou a
    citar uma regra que já não está mais em vigor (ver conversa de 31/jul).

    Só descarta uma versão anterior quando existe, mais adiante no mesmo
    artigo, uma OUTRA versão com a MESMA referência que carrega literalmente
    a marca "(...pela Lei Complementar nº 227...)" — ou seja, só age quando
    tem certeza de que é o caso "redação antiga x redação nova da própria
    LC 214/2025", nunca em cima de uma coincidência genérica de referência
    (ex.: o texto de LC 214/2025 também contém, na parte de disposições
    finais, trechos entre aspas de OUTRAS leis sendo alteradas por ela —
    esse é um problema diferente, ainda não corrigido; ver nota no README)."""
    marked_last_index = {}
    for i, c in enumerate(chunks):
        if REDACAO_LC227_RE.search(c["texto"]):
            marked_last_index[c["referencia"]] = i

    drop = set()
    for i, c in enumerate(chunks):
        ref = c["referencia"]
        if ref in marked_last_index and i < marked_last_index[ref]:
            drop.add(i)

    return [c for i, c in enumerate(chunks) if i not in drop]


def merge_small_chunks(chunks, min_len=40):
    """Alguns cortes por inciso/alínea deixam sobras pequenas demais (poucos
    caracteres) — geralmente o final de uma enumeração que não tinha outro
    marcador para ser separado corretamente. Em vez de virarem chunks
    praticamente vazios (ruins para busca por embeddings), essas sobras são
    grudadas de volta no chunk anterior do mesmo artigo."""
    merged = []
    for c in chunks:
        if (
            merged
            and len(c["texto"]) < min_len
            and merged[-1]["lei"] == c["lei"]
            and merged[-1]["artigo"] == c["artigo"]
        ):
            merged[-1]["texto"] = (merged[-1]["texto"].rstrip() + " " + c["texto"].strip()).strip()
        else:
            merged.append(c)
    return merged


def build_referencia(lei, artigo_label=None, paragrafo_label=None, inciso_label=None,
                      alinea_label=None, anexo_label=None, parte=None):
    bits = []
    if artigo_label:
        bits.append(artigo_label)
    if anexo_label:
        bits.append(f"Anexo {anexo_label}")
    if paragrafo_label:
        bits.append(paragrafo_label)
    if inciso_label:
        bits.append(f"inciso {inciso_label}")
    if alinea_label:
        bits.append(f"alínea \"{alinea_label}\"")
    ref = ", ".join(bits) + f", {lei}"
    if parte:
        ref += f" (parte {parte})"
    return ref


def emit_artigo_chunks(lei, artigo_label, body, chunks):
    for paragrafo_label, ptxt in split_by_regex(body, PARAGRAFO_RE):
        paragrafo_label = norm_paragrafo_label(paragrafo_label) if paragrafo_label else None

        if len(ptxt) <= MAX_CHUNK_CHARS:
            chunks.append({
                "lei": lei,
                "artigo": artigo_label,
                "paragrafo": paragrafo_label,
                "referencia": build_referencia(lei, artigo_label, paragrafo_label),
                "texto": ptxt,
            })
            continue

        # Parágrafo/caput grande demais: tenta subdividir por inciso.
        for inciso_label, itxt in split_by_regex(ptxt, INCISO_RE):
            if len(itxt) <= MAX_CHUNK_CHARS:
                chunks.append({
                    "lei": lei,
                    "artigo": artigo_label,
                    "paragrafo": paragrafo_label,
                    "referencia": build_referencia(lei, artigo_label, paragrafo_label, inciso_label),
                    "texto": itxt,
                })
                continue

            # Inciso ainda grande: tenta subdividir por alínea.
            for alinea_label, atxt in split_by_regex(itxt, ALINEA_RE):
                if len(atxt) <= HARD_MAX_CHARS:
                    chunks.append({
                        "lei": lei,
                        "artigo": artigo_label,
                        "paragrafo": paragrafo_label,
                        "referencia": build_referencia(lei, artigo_label, paragrafo_label, inciso_label, alinea_label),
                        "texto": atxt,
                    })
                else:
                    # Rede de segurança final: corta em partes de tamanho fixo.
                    for idx, part in enumerate(hard_split(atxt, HARD_MAX_CHARS), start=1):
                        chunks.append({
                            "lei": lei,
                            "artigo": artigo_label,
                            "paragrafo": paragrafo_label,
                            "referencia": build_referencia(lei, artigo_label, paragrafo_label, inciso_label, alinea_label, parte=idx),
                            "texto": part,
                        })


def emit_anexo_chunks(lei, anexo_label, body, chunks):
    body = body.strip()
    if not body or is_noise(body):
        return
    parts = hard_split(body, MAX_CHUNK_CHARS) if len(body) > MAX_CHUNK_CHARS else [body]
    multi = len(parts) > 1
    for idx, part in enumerate(parts, start=1):
        chunks.append({
            "lei": lei,
            "artigo": None,
            "paragrafo": None,
            "referencia": build_referencia(lei, anexo_label=anexo_label, parte=idx if multi else None),
            "texto": part,
        })


def chunk_law(fname, lei):
    with open(os.path.join(SOURCES_DIR, fname), encoding="utf-8") as f:
        raw = f.read()
    text = clean_text(raw)

    boundaries = []
    for m in ARTIGO_HEADER_RE.finditer(text):
        boundaries.append((m.start(), "artigo", norm_artigo_label(m.group(1)), m.end()))
    for m in ANEXO_HEADER_RE.finditer(text):
        boundaries.append((m.start(), "anexo", m.group(1), m.end()))
    boundaries.sort(key=lambda b: b[0])

    chunks = []
    for i, (_, kind, label, body_start) in enumerate(boundaries):
        body_end = boundaries[i + 1][0] if i + 1 < len(boundaries) else len(text)
        body = text[body_start:body_end].strip()
        if not body or is_noise(body):
            continue
        if kind == "artigo":
            emit_artigo_chunks(lei, label, body, chunks)
        else:
            emit_anexo_chunks(lei, label, body, chunks)

    chunks = dedupe_superseded_redacao(chunks)
    return merge_small_chunks(chunks)


def chunk_glossario():
    lei = "Glossário da Reforma Tributária"
    with open(os.path.join(SOURCES_DIR, "glossario.txt"), encoding="utf-8") as f:
        lines = [l.strip() for l in f if l.strip()]

    # Pula as 3 primeiras linhas de cabeçalho; a última linha é "Fontes: ...".
    body_lines = lines[3:]
    if body_lines and body_lines[-1].lower().startswith("fontes:"):
        body_lines = body_lines[:-1]

    chunks = []
    # Cada termo ocupa 3 linhas: título, definição, "Base legal: ...".
    for i in range(0, len(body_lines) - 2, 3):
        titulo = body_lines[i]
        definicao = body_lines[i + 1]
        fonte_line = body_lines[i + 2]
        texto = f"{titulo}: {definicao}\n{fonte_line}"
        chunks.append({
            "lei": lei,
            "artigo": None,
            "paragrafo": None,
            "referencia": f"{titulo}, {lei}",
            "texto": texto,
        })
    return chunks


def main():
    all_chunks = []
    for fname, lei in LAW_FILES.items():
        law_chunks = chunk_law(fname, lei)
        print(f"{lei}: {len(law_chunks)} chunks")
        all_chunks.extend(law_chunks)

    gloss_chunks = chunk_glossario()
    print(f"Glossário: {len(gloss_chunks)} chunks")
    all_chunks.extend(gloss_chunks)

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(all_chunks, f, ensure_ascii=False)

    lens = [len(c["texto"]) for c in all_chunks]
    print(f"\nTotal: {len(all_chunks)} chunks")
    print(f"Tamanho médio: {sum(lens)/len(lens):.0f} caracteres")
    print(f"Maior chunk: {max(lens)} caracteres")
    print(f"Menor chunk: {min(lens)} caracteres")
    print(f"Salvo em: {OUT_PATH}")
    print("\nLembrete: rode 'node scripts/build_index.js' agora para regenerar o índice de busca.")


if __name__ == "__main__":
    main()
