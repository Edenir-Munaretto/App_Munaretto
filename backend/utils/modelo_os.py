"""Impressão do modelo de Ordem de Serviço (capa de campo para assinatura).

Preenche os templates DOCX (backend/templates/OS_CONSTRUCAO.docx e
OS_LINHA_VIVA.docx) com os dados da O.S e converte para PDF usando o
mesmo pipeline do módulo de documentos (docx2pdf/LibreOffice/Word COM).
"""

import logging
import os
import tempfile

from docxtpl import DocxTemplate

from utils.document_generator import TEMPLATES_DIR, convert_docx_to_pdf

logger = logging.getLogger(__name__)

LABELS_ATIVIDADE = {
    "construcao": "CONSTRUÇÃO",
    "linha_viva": "LINHA VIVA",
}


def _fmt_data_br(valor) -> str:
    """'YYYY-MM-DD' (ou ISO datetime) -> 'DD/MM/YYYY'. Vazio se nulo."""
    if not valor:
        return ""
    texto = str(valor).strip()
    if len(texto) >= 10:
        try:
            return f"{texto[8:10]}/{texto[5:7]}/{texto[0:4]}"
        except Exception:
            return texto
    return texto


def _fmt_hora(valor) -> str:
    """'HH:MM' (ou ISO datetime) -> 'HH:MM'. Vazio se nulo."""
    if not valor:
        return ""
    texto = str(valor).strip()
    return texto[:5] if len(texto) >= 5 else texto


def _marcar(flag) -> str:
    """Checkbox do modelo: 'X' quando verdadeiro, vazio caso contrário."""
    return "X" if flag else ""


def gerar_modelo_os(
    os_data: dict,
    obra: dict,
    equipe_nome: str | None = None,
    equipe_numero: str | None = None,
    encarregado: str | None = None,
    membros: list | None = None,
    tipo: str = "construcao",
) -> str:
    """Monta o PDF do modelo de O.S e retorna o caminho temporário do arquivo.

    Os campos não preenchidos no cadastro são derivados automaticamente:
    município/local da obra; se ainda assim vazios, ficam em branco no PDF.

    O tipo "linha_viva" é renderizado diretamente em PDF (pymupdf) com a
    geometria exata do modelo oficial; "construcao" usa o pipeline DOCX.
    """
    membros = membros or []
    # O campo "Equipe" do modelo impresso mostra apenas o número da equipe
    equipe_label = equipe_numero or ""

    municipio = os_data.get("municipio") or obra.get("cidade") or ""
    local = os_data.get("local_servico") or obra.get("endereco") or ""

    contexto = {
        "obra": obra.get("nome") or "",
        "agencia": os_data.get("agencia") or "",
        "data": _fmt_data_br(os_data.get("data_abertura") or os_data.get("created_at")),
        "equipe": equipe_label,
        "encarregado": encarregado or "",
        "municipio": municipio or "",
        "servico": os_data.get("descricao_escopo") or "",
        "atividade": LABELS_ATIVIDADE.get(tipo, tipo.upper()),
        "bt": _marcar(os_data.get("bt_energizado")),
        "at": _marcar(os_data.get("at_energizado_bloqueio")),
        "local": local or "",
        "h_desligar": _fmt_hora(os_data.get("hora_desligar")),
        "h_religar": _fmt_hora(os_data.get("hora_religar")),
        "alimentador": os_data.get("alimentador") or "",
        "chave": os_data.get("chave") or "",
        "obs": os_data.get("obs") or "",
        "codigo": os_data.get("codigo") or "",
        "id_obra": os_data.get("obra_id") or "",
        "membros": membros,
    }

    if tipo in ("linha_viva", "construcao"):
        try:
            if tipo == "linha_viva":
                from utils.modelo_os_linha_viva import gerar_pdf_linha_viva as gerar_direto
            else:
                from utils.modelo_os_construcao import gerar_pdf_construcao as gerar_direto

            return gerar_direto(
                codigo=contexto["codigo"],
                data=contexto["data"],
                equipe=contexto["equipe"],
                id_obra=str(contexto["id_obra"]),
                agencia=contexto["agencia"],
                encarregado=contexto["encarregado"],
                obra=contexto["obra"],
                atividade=contexto["atividade"],
                local=contexto["local"],
                municipio=contexto["municipio"],
                servico=contexto["servico"],
                obs=contexto["obs"],
                h_desligar=contexto["h_desligar"],
                h_religar=contexto["h_religar"],
                alimentador=contexto["alimentador"],
                chave=contexto["chave"],
                bt=bool(contexto["bt"]),
                at=bool(contexto["at"]),
                bloqueio=bool(os_data.get("bloqueio")),
                membros=membros,
            )
        except Exception:
            logger.exception("Falha ao gerar PDF %s via pymupdf; usando template DOCX.", tipo.upper())
            # cai no pipeline DOCX abaixo

    template_path = os.path.join(TEMPLATES_DIR, f"OS_{tipo.upper()}.docx")
    if not os.path.exists(template_path):
        template_path = os.path.join(TEMPLATES_DIR, "OS_CONSTRUCAO.docx")
        logger.warning("Template do tipo '%s' não encontrado; usando CONSTRUÇÃO.", tipo)

    temp_dir = tempfile.gettempdir()
    nome_base = f"OS_{tipo.upper()}_{(os_data.get('codigo') or 'os').replace('-', '_')}"
    caminho_docx = os.path.join(temp_dir, f"{nome_base}.docx")

    doc = DocxTemplate(template_path)
    doc.render(contexto)
    doc.save(caminho_docx)

    try:
        caminho_pdf = convert_docx_to_pdf(caminho_docx, temp_dir)
        return caminho_pdf
    finally:
        if os.path.exists(caminho_docx):
            os.remove(caminho_docx)
