"""Relatório do Checklist de Execução da O.S (formato do modelo oficial).

Gera um PDF com:
  1) Capa com os dados da O.S e os membros da equipe (nome + cargo);
  2) Tabela do checklist (Classif, Pergunta, Sim/Não/N/A, Hora);
  3) Páginas de fotos (2 por página) com data/hora e GPS de cada item;
  4) Bloco de assinaturas (Encarregado / Gestor).

O arquivo é montado sob demanda a partir dos dados salvos no banco — o
histórico é o próprio checklist respondido, sem duplicar arquivos.
"""

import logging
import os
import tempfile
from datetime import datetime

from fpdf import FPDF

logger = logging.getLogger(__name__)

LARGURA_PAGINA = 210  # A4
MARGEM = 10

ROTULOS_GRUPOS = {
    1: "1 - PREPARAÇÃO (BASE)",
    2: "2 - CHEGADA AO LOCAL",
    3: "3 - LIBERAÇÃO DA EXECUÇÃO",
    4: "4 - DURANTE A EXECUÇÃO",
    5: "5 - ENCERRAMENTO",
}

ROTULOS_STATUS = {
    "rascunho": "Rascunho",
    "aberta": "Aberta",
    "em_andamento": "Em Andamento",
    "impedida": "Impedida",
    "concluida": "Concluída",
    "cancelada": "Cancelada",
}

ATIVIDADES = {
    "construcao": "CONSTRUÇÃO",
    "manutencao": "MANUTENÇÃO",
    "linha_viva": "LINHA VIVA",
}


def _txt(valor) -> str:
    """Converte para texto seguro (latin-1, como as fontes core do FPDF)."""
    if valor is None:
        return ""
    texto = str(valor).encode("latin-1", "replace").decode("latin-1")
    return texto[:200]


def _fmt_data(valor) -> str:
    if not valor:
        return "-"
    try:
        dt = datetime.fromisoformat(str(valor).replace("Z", "+00:00"))
        return dt.strftime("%d/%m/%Y")
    except ValueError:
        return _txt(valor)


def _fmt_hora(valor) -> str:
    if not valor:
        return "-"
    try:
        dt = datetime.fromisoformat(str(valor).replace("Z", "+00:00"))
        return dt.strftime("%H:%M")
    except ValueError:
        return _txt(valor)[:5]


class _PdfChecklist(FPDF):
    def header(self):
        if self.page_no() == 1:
            return
        self.set_font("Arial", "B", 8)
        self.set_text_color(100, 116, 139)
        self.cell(0, 6, "CHECKLIST DE EXECUÇÃO - ORDEM DE SERVIÇO", ln=True, align="C")
        self.ln(2)

    def footer(self):
        self.set_y(-15)
        self.set_font("Arial", "I", 8)
        self.set_text_color(128, 128, 128)
        self.cell(0, 10, f"Gerado em {datetime.now().strftime('%d/%m/%Y %H:%M')} - Página {self.page_no()}", align="C")


def _marcar(valor) -> str:
    return "X" if valor else ""


def _ext_foto(mime_type) -> str:
    """Extensão compatível com o conteúdo (evita gravar WEBP como .png)."""
    mime = str(mime_type or "").lower()
    if mime == "image/jpeg":
        return ".jpg"
    if mime == "image/png":
        return ".png"
    if mime == "image/webp":
        return ".webp"
    return ".jpg"


def _capa(pdf: _PdfChecklist, os_data: dict, obra: dict, equipe_nome: str, equipe_numero: str, encarregado: str, membros: list):
    """Página 1: dados da O.S + membros da equipe."""
    pdf.add_page()
    # Cabeçalho
    pdf.set_fill_color(15, 23, 42)
    pdf.rect(0, 0, LARGURA_PAGINA, 24, "F")
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Arial", "B", 15)
    pdf.cell(0, 10, "ORDEM DE SERVIÇO", ln=True, align="C")
    pdf.set_font("Arial", "", 9)
    pdf.cell(0, 6, "CHECKLIST DE EXECUÇÃO", ln=True, align="C")
    pdf.ln(8)

    cliente = (obra.get("clientes") or {}).get("nome") if isinstance(obra.get("clientes"), dict) else obra.get("clientes")
    cliente = cliente or obra.get("cliente_celesc") or ""
    tipo = os_data.get("tipo") or "construcao"
    servico = (os_data.get("descricao_escopo") or "").strip()
    obs = (os_data.get("obs") or "").strip()
    situacao = ROTULOS_STATUS.get(os_data.get("status"), os_data.get("status", ""))

    def _linha(rotulo, valor, largura_rotulo=38):
        pdf.set_font("Arial", "B", 9)
        pdf.set_text_color(71, 85, 105)
        pdf.cell(largura_rotulo, 6, f"{rotulo}:")
        pdf.set_font("Arial", "", 9)
        pdf.set_text_color(15, 23, 42)
        pdf.multi_cell(0, 6, _txt(valor) or "-")
        pdf.ln(0.5)

    _linha("Equipe", f"{equipe_numero} - {equipe_nome}".strip(" -"))
    _linha("Agência", os_data.get("agencia"))
    _linha("Nr. O.S", os_data.get("codigo"))
    _linha("Encarregado", encarregado)
    _linha("Atividade", ATIVIDADES.get(tipo, tipo.upper()))
    _linha("Situação", situacao)
    _linha("Obra", obra.get("nome"))
    _linha("Cliente", cliente)
    _linha("Serviço a executar", servico)
    _linha("Local", os_data.get("local_servico") or obra.get("endereco"))
    _linha("Município", os_data.get("municipio") or obra.get("cidade"))
    _linha("Alimentador", os_data.get("alimentador"))
    _linha("Chave", os_data.get("chave"))
    _linha("Desligar / Religar", f"{_fmt_hora(os_data.get('hora_desligar'))} / {_fmt_hora(os_data.get('hora_religar'))}")
    _linha("Observações", obs)

    # Caixas BT / AT / Bloqueio
    pdf.ln(2)
    pdf.set_font("Arial", "B", 9)
    pdf.set_text_color(71, 85, 105)
    pdf.cell(0, 6, "Energia:", ln=True)
    pdf.set_font("Arial", "", 9)
    for rotulo, flag in (
        ("BT", os_data.get("bt_energizado")),
        ("AT", os_data.get("at_energizado_bloqueio")),
        ("Bloqueio", os_data.get("bloqueio")),
    ):
        pdf.cell(3, 7, "X" if flag else " ")
        pdf.set_font("Arial", "", 9)
        pdf.set_draw_color(148, 163, 184)
        pdf.cell(1, 7, "", border=0)
        pdf.set_font("Arial", "B", 9)
        pdf.cell(22, 7, f"  {rotulo}")
        pdf.ln(7)
    pdf.ln(2)

    # Membros da equipe
    pdf.set_fill_color(226, 232, 240)
    pdf.set_text_color(15, 23, 42)
    pdf.set_font("Arial", "B", 9)
    pdf.cell(0, 7, " MEMBROS DA EQUIPE", ln=True, fill=True)
    pdf.ln(1)
    if membros:
        pdf.set_font("Arial", "", 9)
        for m in membros:
            nome = m.get("nome") or m.get("funcionarios", {}).get("nome", "-")
            cargo = m.get("cargo") or (m.get("funcionarios", {}).get("cargos", {}) or {}).get("nome", "-")
            pdf.cell(100, 6, f" {_txt(nome)}", border=0)
            pdf.cell(0, 6, _txt(cargo), ln=True)
    else:
        pdf.set_font("Arial", "I", 8)
        pdf.cell(0, 6, "Sem equipe vinculada.", ln=True)
    pdf.ln(2)
    pdf.set_font("Arial", "", 8)
    pdf.cell(0, 5, f"Data de abertura: {_fmt_data(os_data.get('data_abertura'))}", ln=True)
    pdf.cell(0, 5, f"Data de encerramento: {_fmt_data(os_data.get('data_fim'))}", ln=True)


def _tabela_checklist(pdf: _PdfChecklist, itens: list):
    """Página 2: checklist com Sim/Não/N/A e hora de cada resposta."""
    pdf.add_page()
    pdf.set_fill_color(15, 23, 42)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Arial", "B", 11)
    pdf.cell(0, 9, " CHECKLIST DA O.S.", ln=True, fill=True)
    pdf.ln(1)

    col_larg = {"classif": 16, "pergunta": 108, "sim": 15, "nao": 15, "na": 15, "hora": 26}

    def _cabecalho():
        pdf.set_font("Arial", "B", 8)
        pdf.set_fill_color(15, 23, 42)
        pdf.set_text_color(255, 255, 255)
        pdf.cell(col_larg["classif"], 7, "Classif.", border=1, fill=True)
        pdf.cell(col_larg["pergunta"], 7, "Pergunta", border=1, fill=True)
        pdf.cell(col_larg["sim"], 7, "Sim", border=1, fill=True, align="C")
        pdf.cell(col_larg["nao"], 7, "Não", border=1, fill=True, align="C")
        pdf.cell(col_larg["na"], 7, "N/A", border=1, fill=True, align="C")
        pdf.cell(col_larg["hora"], 7, "Hora Minuto", border=1, fill=True, align="C")
        pdf.ln()
        pdf.set_text_color(15, 23, 42)

    def _linha_item(item):
        resp = item.get("resposta")
        resposta = resp.get("resposta") if resp else None
        pdf.set_font("Arial", "", 8.5)
        pdf.cell(col_larg["classif"], 7, f" {item.get('classificacao', '')}", border=1)
        pergunta = _txt(item.get("pergunta", ""))
        largura = col_larg["pergunta"]
        if len(pergunta) > 70:
            pdf.multi_cell(largura, 7, f" {pergunta}", border=1)
            # Após o multi_cell, x já está no fim da célula (new_x padrão = RIGHT).
            alt = pdf.get_y()
            pdf.set_xy(pdf.get_x(), alt - 7)
        else:
            pdf.cell(largura, 7, f" {pergunta}", border=1)
        for chave in ("sim", "nao", "na"):
            marca = "X" if resposta == chave else ""
            pdf.cell(col_larg[chave], 7, marca, border=1, align="C")
        pdf.cell(col_larg["hora"], 7, _fmt_hora(resp.get("criado_em")) if resp else "", border=1, align="C")
        pdf.ln()

    grupo_atual = None
    for item in itens:
        grupo = item.get("grupo")
        if grupo != grupo_atual:
            grupo_atual = grupo
            pdf.set_font("Arial", "B", 9)
            pdf.set_fill_color(241, 245, 249)
            pdf.set_text_color(71, 85, 105)
            pdf.cell(0, 7, f" {ROTULOS_GRUPOS.get(grupo, f'Grupo {grupo}')}", ln=True, fill=True)
            pdf.set_text_color(15, 23, 42)
            _cabecalho()
        _linha_item(item)

    respondidos = sum(1 for i in itens if i.get("resposta"))
    pdf.ln(2)
    pdf.set_font("Arial", "B", 8)
    pdf.cell(0, 6, f"Perguntas: {len(itens)} | Respondidas: {respondidos}", ln=True)

    # Observação sobre respostas 'Não' (a seleção basta; a justificativa só
    # aparece quando existir — respostas antigas podem ter).
    naos = [i for i in itens if (i.get("resposta") or {}).get("resposta") == "nao"]
    if naos:
        pdf.ln(1)
        pdf.set_font("Arial", "B", 8)
        pdf.set_text_color(185, 28, 28)
        pdf.cell(0, 6, "RESPOSTAS 'NÃO':", ln=True)
        pdf.set_font("Arial", "", 8)
        for i in naos:
            just = (i["resposta"].get("justificativa") or "").strip()
            linha = f"{i['classificacao']} {_txt(i['pergunta'])}"
            if just:
                linha += f" - {_txt(just)}"
            # new_x="LMARGIN": sem isso, com 2+ respostas o x fica na margem
            # direita e o próximo multi_cell(0) fica sem largura (crash).
            pdf.multi_cell(0, 5, linha, new_x="LMARGIN")
        pdf.set_text_color(15, 23, 42)

    # Assinaturas
    pdf.ln(8)
    pdf.set_font("Arial", "", 9)
    y = pdf.get_y()
    larg = (LARGURA_PAGINA - 2 * MARGEM) / 2 - 5
    for titulo in ("ENCARREGADO DA EQUIPE", "GESTOR DE O.S"):
        pdf.line(MARGEM + (0 if titulo.startswith("ENCARREGADO") else larg + 10), y + 12,
                 MARGEM + (larg - 10 if titulo.startswith("ENCARREGADO") else larg + larg), y + 12)
        pdf.set_font("Arial", "B", 8)
        pdf.cell(0, 6, f"  {titulo}  ", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(8)
    pdf.set_y(y + 24)


def _paginas_fotos(pdf: _PdfChecklist, itens: list, baixar_foto):
    """Páginas de fotos em grade 2x2: 4 fotos por página, alinhadas e sem
    espaços vazios — quebra de página apenas quando a grade enche."""
    com_foto = [(i, i["fotos"]) for i in itens if i.get("fotos")]
    if not com_foto:
        return

    COLUNAS = 2
    LINHAS = 2
    FOTOS_POR_PAGINA = COLUNAS * LINHAS
    ESPACO_COLUNAS = 4
    larg_celula = (LARGURA_PAGINA - 2 * MARGEM - ESPACO_COLUNAS * (COLUNAS - 1)) / COLUNAS
    alt_foto = 80
    passo = 100  # imagem + legenda (pergunta + data/GPS)

    def _cabecalho_fotos():
        pdf.add_page()
        pdf.set_fill_color(15, 23, 42)
        pdf.set_text_color(255, 255, 255)
        pdf.set_font("Arial", "B", 11)
        pdf.cell(0, 9, " FOTOS", ln=True, fill=True)
        pdf.ln(2)

    _cabecalho_fotos()
    topo = pdf.get_y()

    for idx, (item, fotos) in enumerate(com_foto):
        posicao = idx % FOTOS_POR_PAGINA
        if posicao == 0 and idx > 0:
            _cabecalho_fotos()
            topo = pdf.get_y()

        coluna = posicao % COLUNAS
        linha = posicao // COLUNAS
        x = MARGEM + coluna * (larg_celula + ESPACO_COLUNAS)
        y = topo + linha * passo

        foto = fotos[0]
        bytes_foto = baixar_foto(foto.get("bucket_key"))
        if bytes_foto:
            try:
                ext = _ext_foto(foto.get("mime_type"))
                caminho = os.path.join(tempfile.gettempdir(), f"os_check_foto_{idx}{ext}")
                with open(caminho, "wb") as f:
                    f.write(bytes_foto)
                pdf.image(caminho, x, y, w=larg_celula, h=alt_foto)
                os.remove(caminho)
            except Exception:
                logger.exception("Erro ao embutir foto do checklist")
        else:
            pdf.rect(x, y, larg_celula, alt_foto)
            pdf.set_font("Arial", "I", 8)
            pdf.text(x + 10, y + 40, "Foto indisponível")

        resp = item.get("resposta") or {}
        pdf.set_font("Arial", "B", 8)
        pdf.set_text_color(15, 23, 42)
        pdf.set_xy(x, y + alt_foto + 2)
        pdf.multi_cell(larg_celula, 4, f"{item.get('classificacao', '')} {_txt(item.get('pergunta', ''))}", align="L")
        pdf.set_font("Arial", "", 7.5)
        pdf.set_text_color(100, 116, 139)
        data = _fmt_data(foto.get("created_at")) + " " + _fmt_hora(foto.get("created_at"))
        gps = resp.get("geolocalizacao") or ""
        pdf.set_xy(x, y + alt_foto + 2 + 9)
        pdf.multi_cell(larg_celula, 4, f"{data}{f'  ·  GPS {gps}' if gps else ''}", align="L")


def gerar_pdf_checklist(
    os_data: dict,
    obra: dict,
    itens: list,
    equipe_nome: str = "",
    equipe_numero: str = "",
    encarregado: str = "",
    membros: list | None = None,
    baixar_foto=None,
) -> str:
    """Monta o PDF do checklist e retorna o caminho temporário do arquivo."""
    pdf = _PdfChecklist(format="A4", unit="mm")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_margins(MARGEM, 18, MARGEM)

    _capa(pdf, os_data, obra, equipe_nome or "", equipe_numero or "", encarregado or "", membros or [])
    _tabela_checklist(pdf, itens)
    _paginas_fotos(pdf, itens, baixar_foto or (lambda chave: None))

    codigo = (os_data.get("codigo") or "os").replace("/", "_")
    caminho = os.path.join(tempfile.gettempdir(), f"OS_CHECKLIST_{codigo}.pdf")
    pdf.output(caminho)
    return caminho
