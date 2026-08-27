"""Extrai as artes do modelo oficial de O.S CONSTRUÇÃO para
backend/templates/artes_construcao/.

As artes deste modelo são FlateDecode (lossless) — a extração direta do
bitstream reproduz exatamente a aparência no modelo oficial.

Uso (manutenção dos modelos):
    python scripts/extrair_artes_construcao.py
"""

import os

import pymupdf

ORIGENS = [
    r"C:\Users\User\Downloads\construção.pdf",
    r"C:\Users\User\Desktop\App_Munaretto\manuais\MODELO O.S\MODELO CONSTRUÇÃO.pdf",
]
DEST = r"C:\Users\User\Desktop\App_Munaretto\backend\templates\artes_construcao"

# (xref, w, h) -> arquivo
ALVOS = {
    "logo": (7, 159, 105),
    "arte_p1": (8, 665, 607),
    "arte_p2": (9, 669, 747),
}

os.makedirs(DEST, exist_ok=True)

origem = next((p for p in ORIGENS if os.path.exists(p)), None)
if not origem:
    raise SystemExit("Nenhum PDF de origem encontrado.")

doc = pymupdf.open(origem)
for nome, (xref, w, h) in ALVOS.items():
    info = doc.extract_image(xref)
    base = pymupdf.Pixmap(doc, xref)
    if info.get("smask"):
        mask = pymupdf.Pixmap(doc, info["smask"])
        base = pymupdf.Pixmap(base, mask)
    caminho = os.path.join(DEST, f"{nome}.png")
    base.save(caminho)
    print(f"Extraido: {nome}.png ({w}x{h}px) -> {caminho}")

print("OK: artes do modelo CONSTRUÇÃO extraídas.")
