#!/usr/bin/env python3
"""把一份受限语法的 Markdown 转成 .docx（**只用 Python 标准库**）。

为什么自己写而不是装 python-docx：
  - 本仓库的硬约束是零依赖、离线可用、跨平台；为一份汇报文档引入包会破坏它
  - .docx 本质是一个 zip，里面是若干 XML；只用到标题/段落/表格/列表，实现量很小
  - 自己实现意味着**产物可复现**：同一份 md 每次生成的 docx 结构完全一致

支持的语法子集（够写汇报，且明确不支持的就报错，不静默丢内容）：
  # / ## / ### / ####     标题（对应 Word 的 Heading 1..4）
  - 项目                   无序列表
  1. 项目                  有序列表
  | a | b |                表格（连续行构成一张表；第一行后跟 |---| 分隔行）
  > 文字                   引用（缩进样式）
  ```...```                代码块（等宽字体）
  **粗体** `等宽`          行内样式
  空行                     段落分隔
  普通文字                 正文段落
"""

from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>"""

RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

DOC_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"""

# 样式：正文用等线/Calibri 兜底，代码用 Consolas；标题做字号与颜色区分
STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/>
<w:sz w:val="21"/><w:szCs w:val="21"/>
</w:rPr></w:rPrDefault></w:docDefaults>
{styles}
</w:styles>"""


def esc(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def runs(text: str, *, mono: bool = False, bold_all: bool = False) -> str:
    """把 **粗体** 与 `等宽` 转成 run 序列。"""
    out = []
    # 先按行内标记切分
    pattern = re.compile(r"(\*\*.+?\*\*|`[^`]+`)")
    for part in pattern.split(text):
        if not part:
            continue
        is_bold = bold_all
        is_mono = mono
        body = part
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            is_bold = True
            body = part[2:-2]
        elif part.startswith("`") and part.endswith("`") and len(part) > 2:
            is_mono = True
            body = part[1:-1]
        props = []
        if is_bold:
            props.append("<w:b/>")
        rfonts = '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Consolas"/>' if is_mono else ""
        out.append(f"<w:r><w:rPr>{rfonts}{''.join(props)}</w:rPr><w:t xml:space=\"preserve\">{esc(body)}</w:t></w:r>")
    return "".join(out) or f"<w:r><w:t xml:space=\"preserve\">{esc(text)}</w:t></w:r>"


def para(text: str = "", *, style: str | None = None, mono: bool = False, bold: bool = False,
         indent: int | None = None, spacing_before: int | None = None) -> str:
    ppr = []
    if style:
        ppr.append(f'<w:pStyle w:val="{style}"/>')
    if indent:
        ppr.append(f'<w:ind w:left="{indent}"/>')
    if spacing_before:
        ppr.append(f'<w:spacing w:before="{spacing_before}"/>')
    ppr_xml = f"<w:pPr>{''.join(ppr)}</w:pPr>" if ppr else ""
    return f"<w:p>{ppr_xml}{runs(text, mono=mono, bold_all=bold)}</w:p>"


def table(rows: list[list[str]], widths: list[int] | None = None) -> str:
    grid = ""
    if widths:
        grid = "<w:tblGrid>" + "".join(f'<w:gridCol w:w="{w}"/>' for w in widths) + "</w:tblGrid>"
    borders = (
        "<w:tblBorders>"
        + "".join(
            f'<w:{side} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
            for side in ("top", "left", "bottom", "right", "insideH", "insideV")
        )
        + "</w:tblBorders>"
    )
    props = f'<w:tblPr><w:tblW w:w="5000" w:type="pct"/>{borders}</w:tblPr>'
    body = []
    for i, row in enumerate(rows):
        cells = []
        for cell in row:
            shade = '<w:shd w:val="clear" w:fill="F2F2F2"/>' if i == 0 else ""
            cells.append(
                "<w:tc><w:tcPr>"
                + (f'<w:tcW w:w="{widths[len(cells)]}" w:type="dxa"/>' if widths else "")
                + shade
                + "</w:tcPr>"
                + para(cell, bold=(i == 0) or None)
                + "</w:tc>"
            )
        body.append("<w:tr>" + "".join(cells) + "</w:tr>")
    return f"<w:tbl>{props}{grid}{''.join(body)}</w:tbl>" + para()


def heading_style(level: int) -> tuple[str, str]:
    style_id = f"Heading{level}"
    sizes = {1: 36, 2: 28, 3: 24, 4: 22}
    colors = {1: "1F3864", 2: "2F5496", 3: "2F5496", 4: "404040"}
    return style_id, f"""<w:style w:type="paragraph" w:styleId="{style_id}"><w:name w:val="heading {level}"/>
<w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="{240 if level<=2 else 180}" w:after="80"/><w:outlineLvl w:val="{level-1}"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="{sizes[level]}"/><w:color w:val="{colors[level]}"/></w:rPr></w:style>"""


def build_styles() -> str:
    extra = [
        heading_style(i)[1] for i in range(1, 5)
    ] + [
        '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/>'
        '<w:pPr><w:ind w:left="360"/><w:spacing w:before="80" w:after="80"/></w:pPr>'
        '<w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style>',
        '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/>'
        '<w:pPr><w:shd w:val="clear" w:fill="F6F6F6"/><w:spacing w:before="0" w:after="0"/>'
        '<w:ind w:left="240"/></w:pPr>'
        '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/></w:rPr></w:style>',
        '<w:style w:type="paragraph" w:styleId="ListItem"><w:name w:val="List Item"/><w:basedOn w:val="Normal"/>'
        '<w:pPr><w:ind w:left="360" w:hanging="180"/><w:spacing w:after="40"/></w:pPr></w:style>',
    ]
    return STYLES.format(styles="".join(extra))


def md_to_document(md: str, *, title: str | None = None) -> str:
    lines = md.split("\n")
    body: list[str] = []
    if title:
        body.append(para(title, style="Heading1"))
    i = 0
    in_code = False
    code_buf: list[str] = []

    def flush_code():
        nonlocal code_buf
        for cl in code_buf:
            body.append(para(cl if cl.strip() else " ", style="Code"))
        body.append(para())
        code_buf = []

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith("```"):
            if in_code:
                flush_code()
                in_code = False
            else:
                in_code = True
            i += 1
            continue
        if in_code:
            code_buf.append(line.rstrip())
            i += 1
            continue

        if not stripped:
            i += 1
            continue

        m = re.match(r"^(#{1,4})\s+(.*)$", stripped)
        if m:
            level = len(m.group(1))
            body.append(para(m.group(2), style=f"Heading{level}"))
            i += 1
            continue

        if stripped.startswith("|") and stripped.endswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                raw = lines[i].strip().strip("|")
                cells = [c.strip() for c in raw.split("|")]
                if not all(re.fullmatch(r":?-{2,}:?", c or "-") for c in cells):
                    rows.append(cells)
                i += 1
            if rows:
                ncol = max(len(r) for r in rows)
                width = int(9000 / ncol)
                body.append(table(rows, [width] * ncol))
            continue

        if stripped.startswith(">"):
            body.append(para(stripped.lstrip("> ").strip(), style="Quote"))
            i += 1
            continue

        m = re.match(r"^[-*]\s+(.*)$", stripped)
        if m:
            body.append(para("• " + m.group(1), style="ListItem"))
            i += 1
            continue

        m = re.match(r"^(\d+)\.\s+(.*)$", stripped)
        if m:
            body.append(para(f"{m.group(1)}. {m.group(2)}", style="ListItem"))
            i += 1
            continue

        body.append(para(stripped))
        i += 1

    if in_code:
        flush_code()

    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body>"
        + "".join(body)
        + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>'
        "</w:body></w:document>"
    )


def write_docx(md_path: Path, out_path: Path, *, title: str | None = None) -> None:
    md = md_path.read_text(encoding="utf-8")
    document = md_to_document(md, title=title)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", RELS)
        z.writestr("word/_rels/document.xml.rels", DOC_RELS)
        z.writestr("word/styles.xml", build_styles())
        z.writestr("word/document.xml", document)
    size_kb = out_path.stat().st_size / 1024
    print(f"已生成 {out_path}（{size_kb:.1f} KB，源：{md_path}）")


def main() -> int:
    if len(sys.argv) < 3:
        print("用法：python scripts/md-to-docx.py <输入.md> <输出.docx> [标题]")
        return 2
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    if not src.exists():
        print(f"输入不存在：{src}")
        return 1
    write_docx(src, dst, title=sys.argv[3] if len(sys.argv) > 3 else None)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
