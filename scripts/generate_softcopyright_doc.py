#!/opt/homebrew/bin/python3
from __future__ import annotations

from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parent.parent
DOCS_DIR = ROOT / "docs"
DOCX_PATH = DOCS_DIR / "presales-agent-soft-copyright-source-code-100pages.docx"
TXT_PATH = DOCS_DIR / "presales-agent-soft-copyright-source-code-100pages.txt"

PROJECT_NAME = "售前成本估算 Agent 系统"
LINES_PER_PAGE = 50
TOTAL_PAGES = 100
TOTAL_LINES = LINES_PER_PAGE * TOTAL_PAGES

SOURCE_FILES = [
    "app/api/chat/route.ts",
    "app/api/agent/stream/route.ts",
    "app/api/agent/run/route.ts",
    "app/actions/requirements.ts",
    "app/actions/estimate-references.ts",
    "app/actions/functions.ts",
    "app/actions/elicitation-sessions.ts",
    "lib/agents/graph.ts",
    "lib/agents/state.ts",
    "lib/agents/nodes/analyze.ts",
    "lib/agents/nodes/breakdown.ts",
    "lib/agents/nodes/estimate.ts",
    "lib/agents/nodes/calculate.ts",
    "lib/ai/chat-tools.ts",
    "lib/ai/elicitation/tools.ts",
    "lib/git/parser.ts",
    "lib/git/prescan.ts",
    "lib/git/tools.ts",
    "lib/utils/export.ts",
    "components/quick-estimate/quick-estimate-workspace.tsx",
    "components/project/function-table.tsx",
    "components/project/cost-summary.tsx",
    "components/agent/agent-chat.tsx",
    "app/(dashboard)/projects/[id]/report/page.tsx",
]


def strip_comments(source: str) -> str:
    result: list[str] = []
    i = 0
    in_single = False
    in_double = False
    in_template = False
    in_line_comment = False
    in_block_comment = False
    escape_next = False

    while i < len(source):
        char = source[i]
        next_char = source[i + 1] if i + 1 < len(source) else ""

        if in_line_comment:
            if char == "\n":
                in_line_comment = False
                result.append(char)
            i += 1
            continue

        if in_block_comment:
            if char == "*" and next_char == "/":
                in_block_comment = False
                i += 2
            else:
                if char == "\n":
                    result.append("\n")
                i += 1
            continue

        if escape_next:
            result.append(char)
            escape_next = False
            i += 1
            continue

        if char == "\\" and (in_single or in_double or in_template):
            result.append(char)
            escape_next = True
            i += 1
            continue

        if not in_double and not in_template and char == "'" and not in_single:
            in_single = True
            result.append(char)
            i += 1
            continue
        if in_single and char == "'":
            in_single = False
            result.append(char)
            i += 1
            continue

        if not in_single and not in_template and char == '"' and not in_double:
            in_double = True
            result.append(char)
            i += 1
            continue
        if in_double and char == '"':
            in_double = False
            result.append(char)
            i += 1
            continue

        if not in_single and not in_double and char == "`" and not in_template:
            in_template = True
            result.append(char)
            i += 1
            continue
        if in_template and char == "`":
            in_template = False
            result.append(char)
            i += 1
            continue

        if not in_single and not in_double and not in_template:
            if char == "/" and next_char == "/":
                in_line_comment = True
                i += 2
                continue
            if char == "/" and next_char == "*":
                in_block_comment = True
                i += 2
                continue

        result.append(char)
        i += 1

    return "".join(result)


def sanitize_line(line: str) -> str:
    line = line.rstrip()
    if not line.strip():
        return ""
    cleaned = line.replace("\t", "    ").rstrip()
    return cleaned


def collect_effective_lines() -> list[str]:
    collected: list[str] = []

    for relative_path in SOURCE_FILES:
        source = (ROOT / relative_path).read_text(encoding="utf-8")
        source = strip_comments(source)
        sanitized_lines = [sanitize_line(line) for line in source.splitlines()]
        sanitized_lines = [line for line in sanitized_lines if line]

        if not sanitized_lines:
            continue

        collected.append(f"文件开始 {relative_path}")
        collected.extend(sanitized_lines)
        collected.append(f"文件结束 {relative_path}")

    return collected


def build_page_lines(source_lines: list[str]) -> list[str]:
    code_lines_per_page = LINES_PER_PAGE - 2
    required_code_lines = code_lines_per_page * TOTAL_PAGES

    if len(source_lines) < required_code_lines:
        raise RuntimeError(
            f"有效代码行不足，当前仅有 {len(source_lines)} 行，至少需要 {required_code_lines} 行。"
        )

    trimmed = source_lines[:required_code_lines]
    pages: list[str] = []

    for page_index in range(TOTAL_PAGES):
        start = page_index * code_lines_per_page
        end = start + code_lines_per_page
        page_no = page_index + 1
        pages.append(f"==================== 第 {page_no:03d} 页开始 ====================")
        pages.extend(trimmed[start:end])
        pages.append(f"==================== 第 {page_no:03d} 页结束 ====================")

    if len(pages) != TOTAL_LINES:
        raise RuntimeError(f"分页失败，输出行数异常：{len(pages)}")

    return pages


def paragraph(text: str, style: str | None = None) -> str:
    style_xml = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    safe_text = escape(text)
    return f'<w:p>{style_xml}<w:r><w:t xml:space="preserve">{safe_text}</w:t></w:r></w:p>'


def page_break() -> str:
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'


def build_document_xml(lines: list[str]) -> str:
    body_parts: list[str] = []

    for page_index in range(TOTAL_PAGES):
        page_start = page_index * LINES_PER_PAGE
        page_lines = lines[page_start:page_start + LINES_PER_PAGE]
        for line in page_lines:
            body_parts.append(paragraph(line, "Code"))
        if page_index < TOTAL_PAGES - 1:
            body_parts.append(page_break())

    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
 xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
 xmlns:v="urn:schemas-microsoft-com:vml"
 xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:w10="urn:schemas-microsoft-com:office:word"
 xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
 xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
 xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
 xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
 xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
 mc:Ignorable="w14 wp14">
  <w:body>
    {''.join(body_parts)}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>
"""


def build_styles_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Menlo" w:hAnsi="Menlo" w:eastAsia="Microsoft YaHei" w:cs="Menlo"/>
        <w:sz w:val="16"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Code">
    <w:name w:val="Code"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="0" w:after="0" w:line="220" w:lineRule="exact"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Menlo" w:hAnsi="Menlo" w:eastAsia="Menlo"/>
      <w:sz w:val="16"/>
    </w:rPr>
  </w:style>
</w:styles>
"""


def write_docx(document_xml: str, styles_xml: str) -> None:
    content_types_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>
"""

    rels_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""

    document_rels_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
"""

    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as zip_file:
        zip_file.writestr("[Content_Types].xml", content_types_xml)
        zip_file.writestr("_rels/.rels", rels_xml)
        zip_file.writestr("word/document.xml", document_xml)
        zip_file.writestr("word/styles.xml", styles_xml)
        zip_file.writestr("word/_rels/document.xml.rels", document_rels_xml)

    DOCX_PATH.write_bytes(buffer.getvalue())


def main() -> None:
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    source_lines = collect_effective_lines()
    output_lines = build_page_lines(source_lines)
    TXT_PATH.write_text("\n".join(output_lines) + "\n", encoding="utf-8")
    write_docx(build_document_xml(output_lines), build_styles_xml())

    print(f"project={PROJECT_NAME}")
    print(f"source_lines={len(source_lines)}")
    print(f"output_lines={len(output_lines)}")
    print(f"pages={TOTAL_PAGES}")
    print(f"docx={DOCX_PATH}")
    print(f"txt={TXT_PATH}")


if __name__ == "__main__":
    main()
