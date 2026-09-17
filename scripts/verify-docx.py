#!/usr/bin/env python3
"""校验生成的 .docx：结构完整性、内容包含、以及 Word 能否按预期解析。

用法：python scripts/verify-docx.py <文件.docx> [必须包含的关键词...]
"""
import sys
import zipfile
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 2:
        print("用法：python scripts/verify-docx.py <文件.docx> [关键词...]")
        return 2
    path = Path(sys.argv[1])
    if not path.exists():
        print(f"文件不存在：{path}")
        return 1
    keywords = sys.argv[2:]

    problems = []

    with zipfile.ZipFile(path) as z:
        bad = z.testzip()
        if bad is not None:
            problems.append(f"zip 条目损坏：{bad}")
        names = set(z.namelist())
        for required in ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml"]:
            if required not in names:
                problems.append(f"缺少必需部件：{required}")
        if "word/_rels/document.xml.rels" not in names:
            problems.append("缺少 word/_rels/document.xml.rels（样式关系无法解析）")

        doc = z.read("word/document.xml").decode("utf-8")
        styles = z.read("word/styles.xml").decode("utf-8")

        # Word 对 XML 很挑：检查标签配对与命名空间
        if not doc.startswith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'):
            problems.append("document.xml 缺少 XML 声明")
        if 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' not in doc:
            problems.append("document.xml 缺少 w 命名空间")
        if doc.count("<w:body>") != 1 or doc.count("</w:body>") != 1:
            problems.append("w:body 标签数量异常")
        if doc.count("<w:p>") + doc.count("<w:p ") != doc.count("</w:p>"):
            problems.append("w:p 标签不配对")
        if doc.count("<w:tbl>") != doc.count("</w:tbl>"):
            problems.append("w:tbl 标签不配对")
        if doc.count("<w:tr>") != doc.count("</w:tr>"):
            problems.append("w:tr 标签不配对")
        if doc.count("<w:tc>") != doc.count("</w:tc>"):
            problems.append("w:tc 标签不配对")

        # 文中引用的样式必须在 styles.xml 里有定义，否则 Word 会退回默认样式
        for level in range(1, 5):
            if f"w:val=\"Heading{level}\"" in doc and f'w:styleId="Heading{level}"' not in styles:
                problems.append(f"文档用了 Heading{level} 但 styles.xml 未定义")
        for sid in ["Quote", "Code", "ListItem"]:
            if f'w:styleId="{sid}"' in doc and f'w:styleId="{sid}"' not in styles:
                problems.append(f"文档用了 {sid} 但 styles.xml 未定义")

        print(f"文件：{path.name}（{path.stat().st_size/1024:.1f} KB）")
        print(f"  段落 {doc.count('<w:p>')} 个，表格 {doc.count('<w:tbl>')} 个，"
              f"标题 {sum(doc.count(f'w:val=\"Heading{i}\"') for i in range(1,5))} 个，"
              f"代码块段落 {doc.count('w:val=\"Code\"')} 个")

        for kw in keywords:
            if kw in doc:
                print(f"  [OK] 含「{kw}」")
            else:
                problems.append(f"缺少预期内容：「{kw}」")

    print()
    if problems:
        print("发现问题：")
        for p in problems:
            print(f"  [X] {p}")
        return 1
    print("[OK] 结构校验通过（zip 完整、部件齐全、XML 标签配对、样式均已定义）")
    print("  注意：本脚本验证结构与内容，不替代在 Word/WPS 中打开确认渲染效果。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
