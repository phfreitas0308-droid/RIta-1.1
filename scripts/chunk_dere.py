# -*- coding: utf-8 -*-
"""
Divide os 7 novos documentos técnicos da DeRE (Declaração de Regimes Específicos)
em blocos ("chunks") no MESMO formato usado por scripts/chunk_laws.py, para que
entrem no pipeline de embeddings/busca (scripts/build_index.js) sem nenhuma
mudança de código no chatbot.

Cada documento tem uma estrutura diferente das leis (não são Art./§), então
usamos uma estratégia de chunking sob medida por tipo de documento:
  - Mensagens de erro (MSxxxx): 1 chunk por código de mensagem.
  - Anexo II - Regras de validação: 1 chunk por nome de regra.
  - Anexo I - Tabelas (Tabela 11 etc.): 1 chunk por grupo de linhas da tabela
    (várias linhas juntas até um teto de tamanho), preservando a qual Tabela
    pertence — para não recriar o bug do "bloco gigante" já corrigido nas leis.
  - Documentos narrativos com seções numeradas (Receita Integra, Histórico de
    Versões, Leiautes, Manual do Usuário): 1 chunk por seção numerada mais
    profunda, com fallback de corte por tamanho fixo se a seção for enorme.

COMO RODAR:
    cd reforma-tributaria-chatbot
    python3 scripts/chunk_dere.py

Lê sources/dere_*.txt e ACRESCENTA os novos blocos a
data/chunks_leis_reforma_tributaria.json (não apaga os blocos das leis já
existentes). Depois, rode `node scripts/build_index.js` de novo.
"""

import json
import re
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SOURCES_DIR = os.path.join(SCRIPT_DIR, "..", "sources")
OUT_PATH = os.path.join(SCRIPT_DIR, "..", "data", "chunks_leis_reforma_tributaria.json")

MAX_CHUNK_CHARS = 2200
HARD_MAX_CHARS = 3200

PAGE_NOISE_RE = re.compile(
    r'^\s*(P[áa]gina\s+\d+\s+de\s+\d+|Vers[ãa]o\s+[\d.]+.*|CGIBS.*|Comit[êe] Gestor.*|'
    r'RECEITA FEDERAL|Minist[ée]rio da Fazenda|serpro\.gov\.br.*)\s*$',
    re.MULTILINE,
)
DOT_LEADER_RE = re.compile(r'\.{4,}')


def clean_text(text):
    text = PAGE_NOISE_RE.sub('', text)
    text = DOT_LEADER_RE.sub(' ', text)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n[ \t]+', '\n', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def clean_text_keep_columns(text):
    """Como clean_text, mas preserva os espacos multiplos entre colunas de
    tabelas -- necessarios para detectar onde uma coluna (ex.: nome da regra,
    codigo da tabela) termina e a proxima comeca."""
    text = PAGE_NOISE_RE.sub('', text)
    text = DOT_LEADER_RE.sub(' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def is_noise(text):
    stripped = text.strip(' \n\t.-–—"\'()')
    return len(stripped) < 3


def hard_split(text, max_chars):
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


def mk(lei, artigo, referencia, texto):
    return {"lei": lei, "artigo": artigo, "paragrafo": None, "referencia": referencia, "texto": texto}


# ------------------------------------------------------------------
# 1) Mensagens de erro do sistema (file.pdf) — 1 chunk por código MSxxxx.
#
# O pdftotext -layout intercala as duas colunas da tabela ("Código" e "Texto")
# de um jeito que o código nem sempre fica exatamente no início do texto da
# própria mensagem (por causa do alinhamento vertical da célula). Para não
# perder conteúdo, tratamos o texto ENTRE dois códigos consecutivos como
# pertencente ao código que vem depois (é onde a maior parte do conteúdo de
# cada mensagem aparece, pelas amostras conferidas manualmente).
# ------------------------------------------------------------------
MS_CODE_RE = re.compile(r'^[ \t]*(MS\d{4})[ \t]*(.*)$', re.MULTILINE)
NOISE_LINE_ERR_RE = re.compile(
    r'^\s*(\d+[-.]?\s*Mensagens de erro.*|C[óo]digo da|mensagem|Mensagem|Texto da mensagem)\s*$',
    re.MULTILINE | re.IGNORECASE,
)


def chunk_error_messages(raw):
    lei = "DeRE - Mensagens de Erro do Sistema"
    text = clean_text(raw)
    text = NOISE_LINE_ERR_RE.sub('', text)

    matches = list(MS_CODE_RE.finditer(text))
    chunks = []
    prev_end = 0
    prev_code = None
    for m in matches:
        code = m.group(1)
        seg = text[prev_end:m.start()].strip()
        inline = m.group(2).strip()
        if inline:
            seg = (seg + " " + inline).strip() if seg else inline
        prev_end = m.end()
        if prev_code and seg and not is_noise(seg):
            chunks.append(mk(lei, prev_code, f"{prev_code}, {lei}", seg))
        prev_code = code

    tail = text[prev_end:].strip()
    if prev_code and tail and not is_noise(tail):
        chunks.append(mk(lei, prev_code, f"{prev_code}, {lei}", tail))

    return merge_small(chunks)


def merge_small(chunks, min_len=15):
    merged = []
    for c in chunks:
        if merged and len(c["texto"]) < min_len and merged[-1]["lei"] == c["lei"]:
            merged[-1]["texto"] = (merged[-1]["texto"].rstrip() + " " + c["texto"].strip()).strip()
        else:
            merged.append(c)
    return merged


# ------------------------------------------------------------------
# 2) Anexo II - Regras de validação (file4.pdf) — 1 chunk por nome de regra.
# ------------------------------------------------------------------
RULE_NAME_RE = re.compile(r'^[ \t]{1,4}([A-Z][A-Z0-9_]{2,60})[ \t]{2,}(.*)$', re.MULTILINE)


def _normalize_body(body):
    body = re.sub(r'[ \t]{2,}', ' ', body)
    body = re.sub(r'\n[ \t]+', '\n', body)
    body = re.sub(r'\n{2,}', '\n', body)
    return body.strip()


def chunk_validation_rules(raw):
    lei = "DeRE - Anexo II – Regras de Validação"
    text = clean_text_keep_columns(raw)

    marker = text.find("TABELA DE REGRAS DE VALIDAÇÃO")
    if marker != -1:
        rest = text[marker:]
        first_rule = RULE_NAME_RE.search(rest)
        if first_rule:
            text = rest[first_rule.start():]

    matches = list(RULE_NAME_RE.finditer(text))
    raw_entries = []
    for i, m in enumerate(matches):
        name = m.group(1)
        line_start = text.rfind('\n', 0, m.start()) + 1
        content_col = m.start(2) - line_start
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = (m.group(2) + "\n" + text[start:end]).strip()
        raw_entries.append((name, body, content_col))

    # Nomes de regra muito compridos quebram em 2 linhas no PDF (ex.:
    # "CONFERIR_SALDO_FINAL_NAT_SALDO_FI" + "NAL", ou
    # "EXIGIR_TP_OPER_ALTERACAO_PARA_NOV" + "A_VALIDADE" na linha seguinte).
    # Nesses casos a coluna onde o "conteúdo" começa fica bem menor que o
    # normal (a coluna da tabela é fixa, ~52-55) porque o nome tomou o espaço
    # da própria coluna de conteúdo — sinal de que essa linha é, na verdade,
    # a continuação do nome/corpo da regra anterior, não uma regra nova.
    NORMAL_COL_MIN = 45
    entries = []
    for name, body, content_col in raw_entries:
        if entries and (content_col < NORMAL_COL_MIN or len(name) <= 5):
            prev_name, prev_body = entries[-1]
            entries[-1] = (prev_name + name, prev_body + " " + body)
        else:
            entries.append((name, body))

    chunks = []
    for name, body in entries:
        body = _normalize_body(body)
        if is_noise(body):
            continue
        parts = hard_split(body, HARD_MAX_CHARS) if len(body) > HARD_MAX_CHARS else [body]
        for idx, part in enumerate(parts, start=1):
            ref = f"Regra \"{name}\", {lei}" + (f" (parte {idx})" if len(parts) > 1 else "")
            chunks.append(mk(lei, name, ref, f"Regra {name}: {part}"))

    return merge_small(chunks, min_len=10)




# ------------------------------------------------------------------
# 3) Documentos narrativos com seções numeradas (Receita Integra, Histórico
#    de Versões, Leiautes, Manual do Usuário) — 1 chunk por seção numerada
#    mais profunda (ex.: "1.1.2 Especificação Técnica..."), com corte por
#    tamanho fixo se a seção for grande demais (a mesma rede de segurança
#    usada para os Anexos das leis).
# ------------------------------------------------------------------
CAPITULO_RE = re.compile(
    r'^\s*CAP[ÍI]TULO\s+([IVXLCDM]+)\s*[–\-]?\s*(.*)$', re.MULTILINE
)
HEADING_RE = re.compile(
    r'^\s*(\d{1,2}(?:\.\d{1,2}){0,4})\.?\s+([A-ZÀ-Ü][^\n]{2,130})$', re.MULTILINE
)


TOC_TAIL_RE = re.compile(r'\s\d{1,4}\s*$')


def chunk_numbered_sections(raw, lei, use_capitulos=False, strict_depth1_upper=False):
    text = clean_text(raw)

    boundaries = []  # (pos, kind, label, title, body_start)
    if use_capitulos:
        for m in CAPITULO_RE.finditer(text):
            boundaries.append((m.start(), "capitulo", m.group(1), m.group(2).strip(), m.end()))
    for m in HEADING_RE.finditer(text):
        title = m.group(2).strip()
        if not title or title[-1] in ",;":
            continue
        # linhas do SUMÁRIO/TOC: depois de remover os pontinhos, sobra
        # "Título da seção <número da página>" — descarta (o conteúdo real
        # da seção aparece de novo, mais à frente, no corpo do documento).
        if TOC_TAIL_RE.search(title):
            continue
        label = m.group(1)
        # Em documentos com tabelas hierárquicas (ex.: "Nível 1 DeRE ...",
        # "5  UFsCredenc ..."), um número solto (sem ponto) no início de uma
        # linha de tabela pode parecer o começo de uma seção "N Título".
        # Para esses documentos, só aceitamos títulos de nível 1 (sem ponto)
        # quando estiverem em CAIXA ALTA — como são, de fato, os títulos
        # reais de seção nesses documentos.
        if strict_depth1_upper and "." not in label:
            letters = re.sub(r'[^A-Za-zÀ-ÿ]', '', title)
            if letters and not letters.isupper():
                continue
        boundaries.append((m.start(), "heading", label, title, m.end()))

    boundaries.sort(key=lambda b: b[0])

    chunks = []
    current_capitulo = None
    level_titles = {}  # profundidade -> "N.N Título" do ancestral mais recente
    for i, (pos, kind, label, title, body_start) in enumerate(boundaries):
        if kind == "capitulo":
            current_capitulo = f"Capítulo {label} – {title}" if title else f"Capítulo {label}"
            level_titles = {}
            continue

        depth = label.count(".") + 1
        # esquece títulos de níveis mais profundos que já não fazem mais
        # parte do "caminho" atual (ex.: ao entrar em "1.2", esquece "1.1.3")
        level_titles = {d: t for d, t in level_titles.items() if d < depth}
        level_titles[depth] = f"{label} {title}"

        body_end = len(text)
        for j in range(i + 1, len(boundaries)):
            body_end = boundaries[j][0]
            break

        body = text[body_start:body_end].strip()
        if not body or is_noise(body):
            continue

        breadcrumb = " > ".join(level_titles[d] for d in sorted(level_titles))
        ref_bits = []
        if current_capitulo:
            ref_bits.append(current_capitulo)
        ref_bits.append(f"Seção {breadcrumb}")
        base_ref = ", ".join(ref_bits) + f", {lei}"

        parts = hard_split(body, HARD_MAX_CHARS) if len(body) > HARD_MAX_CHARS else [body]
        for idx, part in enumerate(parts, start=1):
            ref = base_ref + (f" (parte {idx})" if len(parts) > 1 else "")
            chunks.append(mk(lei, label, ref, f"{breadcrumb}: {part}"))

    return merge_small(chunks, min_len=20)


# ------------------------------------------------------------------
# 4) Anexo I - Tabelas (file5.pdf) — a maior fonte nova (86 páginas de
#    tabelas de códigos de domínio, ex.: Tabela 11 - Códigos de Tributação).
#    Cada "Tabela NN" vira sua própria seção; dentro dela, várias linhas de
#    código são agrupadas em blocos de tamanho controlado — a mesma lógica
#    usada para os Anexos das leis, para não recriar o bug do bloco gigante.
# ------------------------------------------------------------------
TABELA_HEADER_RE = re.compile(r'^[ \t]{0,3}(Tabela\s+\d+(?:\.\d+)?)\s*[–\-]\s*(.+)$', re.MULTILINE)
TABELA_REPEAT_RE = re.compile(r'^[ \t]{8,}Tabela\s+\d+(?:\.\d+)?\s*[–\-].*$', re.MULTILINE)
TABELA_COLHEADER_RE = re.compile(
    r'^[ \t]*cod\w*[ \t]+T[íi]tulo[ \t]+Descri[çc][ãa]o[ \t]+Dispositivo Legal[ \t]*$',
    re.MULTILINE | re.IGNORECASE,
)
ROW_START_RE = re.compile(r'^[ \t]{1,4}(\d{2,12})[ \t]{2,}(\S.*)$', re.MULTILINE)


def chunk_table_document(raw, lei):
    text = clean_text_keep_columns(raw)
    text = TABELA_REPEAT_RE.sub('', text)
    text = TABELA_COLHEADER_RE.sub('', text)

    headers = [(m.start(), m.group(1).strip(), m.group(2).strip(), m.end())
               for m in TABELA_HEADER_RE.finditer(text)]
    if not headers:
        return []

    chunks = []
    for i, (pos, num, title, body_start) in enumerate(headers):
        body_end = headers[i + 1][0] if i + 1 < len(headers) else len(text)
        body = text[body_start:body_end]
        table_label = f"{num} – {title}"

        rows = list(ROW_START_RE.finditer(body))
        if not rows:
            # Layout de coluna diferente (não é o padrão "código + 2+
            # espaços + texto" da Tabela 11) — em vez de perder o conteúdo
            # inteiro, cai para o corte por tamanho fixo (mesma rede de
            # segurança usada nos Anexos das leis), sempre com o rótulo da
            # tabela junto, para nunca virar um bloco gigante nem sumir.
            body_clean = _normalize_body(body)
            if is_noise(body_clean):
                continue
            parts = hard_split(body_clean, MAX_CHUNK_CHARS)
            multi = len(parts) > 1
            for idx, part in enumerate(parts, start=1):
                suffix = f" (parte {idx})" if multi else ""
                ref = f"{table_label}{suffix}, {lei}"
                chunks.append(mk(lei, num, ref, f"{table_label}\n{part}"))
            continue

        # Agrupa linhas consecutivas em blocos de até MAX_CHUNK_CHARS, sem
        # nunca deixar uma "Tabela" inteira virar um único bloco gigante.
        groups = []
        current = []
        current_len = 0
        for j, rm in enumerate(rows):
            row_end = rows[j + 1].start() if j + 1 < len(rows) else len(body)
            row_text = (rm.group(1) + " " + rm.group(2) + " " + body[rm.end():row_end]).strip()
            row_text = _normalize_body(row_text)
            if current and current_len + len(row_text) > MAX_CHUNK_CHARS:
                groups.append(current)
                current = []
                current_len = 0
            current.append(row_text)
            current_len += len(row_text) + 1
        if current:
            groups.append(current)

        multi = len(groups) > 1
        for idx, group in enumerate(groups, start=1):
            texto = f"{table_label}\n" + "\n".join(group)
            parts = hard_split(texto, HARD_MAX_CHARS) if len(texto) > HARD_MAX_CHARS else [texto]
            for sub_idx, part in enumerate(parts, start=1):
                suffix = ""
                if multi or len(parts) > 1:
                    suffix = f" (parte {idx}{'.' + str(sub_idx) if len(parts) > 1 else ''})"
                ref = f"{table_label}{suffix}, {lei}"
                chunks.append(mk(lei, num, ref, part))

    return chunks


# ------------------------------------------------------------------
# Documentos e função de chunking usada para cada um.
# ------------------------------------------------------------------
DERE_FILES = [
    ("dere_mensagens_erro.txt", "DeRE - Mensagens de Erro do Sistema", "erros", {}),
    ("dere_receita_integra.txt", "DeRE - Receita Integra (Documentação Técnica)", "secoes",
     {"use_capitulos": False, "strict_depth1_upper": False}),
    ("dere_historico_versoes.txt", "DeRE - Histórico de Versões", "secoes",
     {"use_capitulos": False, "strict_depth1_upper": True}),
    ("dere_anexo2_regras_validacao.txt", "DeRE - Anexo II – Regras de Validação", "regras", {}),
    ("dere_anexo1_tabelas.txt", "DeRE - Anexo I – Tabelas", "tabela", {}),
    ("dere_leiautes.txt", "DeRE - Leiautes", "secoes",
     {"use_capitulos": False, "strict_depth1_upper": True}),
    ("dere_manual_usuario.txt", "DeRE - Manual do Usuário (MOD)", "secoes",
     {"use_capitulos": True, "strict_depth1_upper": True}),
]


def main():
    if not os.path.exists(OUT_PATH):
        print(f"Aviso: {OUT_PATH} não existe ainda — criando do zero só com os documentos DeRE.")
        existing = []
    else:
        with open(OUT_PATH, encoding="utf-8") as f:
            existing = json.load(f)

    # Remove blocos de uma rodada anterior deste mesmo script (se o script
    # for rodado de novo depois de uma atualização dos PDFs da DeRE), para
    # não duplicar — mantém todos os blocos das leis (EC/LC/Glossário) intactos.
    dere_leis = {lei for _, lei, _, _ in DERE_FILES}
    existing = [c for c in existing if c.get("lei") not in dere_leis]

    new_chunks = []
    for fname, lei, kind, kwargs in DERE_FILES:
        path = os.path.join(SOURCES_DIR, fname)
        if not os.path.exists(path):
            print(f"AVISO: {path} não encontrado — pulando '{lei}'.")
            continue
        with open(path, encoding="utf-8") as f:
            raw = f.read()

        if kind == "erros":
            chunks = chunk_error_messages(raw)
        elif kind == "regras":
            chunks = chunk_validation_rules(raw)
        elif kind == "tabela":
            chunks = chunk_table_document(raw, lei)
        else:
            chunks = chunk_numbered_sections(raw, lei, **kwargs)

        lens = [len(c["texto"]) for c in chunks] or [0]
        print(f"{lei}: {len(chunks)} blocos (máx {max(lens)} caracteres, mín {min(lens)})")
        new_chunks.extend(chunks)

    all_chunks = existing + new_chunks
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(all_chunks, f, ensure_ascii=False)

    print(f"\nNovos blocos da DeRE: {len(new_chunks)}")
    print(f"Total geral (leis + DeRE): {len(all_chunks)}")
    print(f"Salvo em: {OUT_PATH}")
    print("\nLembrete: rode 'node scripts/build_index.js' agora para gerar os novos data/index_*.json.")


if __name__ == "__main__":
    main()
