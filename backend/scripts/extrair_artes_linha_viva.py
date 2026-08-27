"""Extrai as artes do modelo oficial Linha Viva para
backend/templates/artes_linha_viva/.

- logo, arte_p1, banner: extração direta do bitstream (JPEG) — reproduz
  perfeitamente a aparência no modelo (verificado por diff de pixels).
- arte_p2: RENDER da região do PDF oficial na resolução nativa — o renderer
  decodifica o JPEG embutido de forma peculiar; renderizar o clip reproduz
  exatamente o que o modelo exibe.

Uso (manutenção dos modelos):
    python scripts/extrair_artes_linha_viva.py
"""

import os

import pymupdf

ORIGENS = [
    r"C:\Users\User\Downloads\lv.pdf",
    r"C:\Users\User\Desktop\App_Munaretto\manuais\MODELO O.S\MODELO LINHA VIVA.pdf",
]
DEST = r"C:\Users\User\Desktop\App_Munaretto\backend\templates\artes_linha_viva"

# (xref da imagem, w, h) para extração direta
RAW = {
    "logo": (7, 159, 105),
    "arte_p1": (8, 705, 642),
    "banner": (10, 632, 76),
}

# (pagina 1-based, rect em pt, px de largura) para render do clip
# (o renderer decodifica o JPEG embutido de forma peculiar; renderizar o
#  clip reproduz exatamente o que o modelo oficial exibe)
CLIP = {
    "arte_p2": (2, (28.3, 63.7, 580.3, 558.7), 718),
}

os.makedirs(DEST, exist_ok=True)

origem = next((p for p in ORIGENS if os.path.exists(p)), None)
if not origem:
    raise SystemExit("Nenhum PDF de origem encontrado.")

doc = pymupdf.open(origem)

for nome, (xref, w, h) in RAW.items():
    info = doc.extract_image(xref)
    base = pymupdf.Pixmap(doc, xref)
    if info.get("smask"):
        mask = pymupdf.Pixmap(doc, info["smask"])
        pix = pymupdf.Pixmap(base, mask)
    else:
        pix = base
    caminho = os.path.join(DEST, f"{nome}.png")
    pix.save(caminho)
    print(f"Extraido (raw): {nome}.png ({w}x{h}px)")

for nome, (pno, rect, px_largura) in CLIP.items():
    largura_pt = rect[2] - rect[0]
    dpi = px_largura / largura_pt * 72
    zoom = dpi / 72
    pix = doc[pno - 1].get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=pymupdf.Rect(*rect))
    if pix.alpha:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    caminho = os.path.join(DEST, f"{nome}.png")
    pix.save(caminho)
    print(f"Extraido (clip): {nome}.png ({pix.width}x{pix.height}px @ {dpi:.1f}dpi)")

print("OK")
