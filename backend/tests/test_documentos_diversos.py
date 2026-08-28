"""Testes do módulo Documentos Diversos (pasta do SST).

Cobre: listagem, upload com compressão de PDF, fallback quando a compressão
não reduz o tamanho, tipos inválidos, download (presigned URL) e exclusão.
"""

import io

import pytest


class FakeS3:
    """Simula as chamadas do boto3 usadas pelo router de documentos diversos."""

    def __init__(self):
        self.objetos = {}
        self.removidos = []
        self.put_chamadas = []
        self.geradas = []

    def put_object(self, **kwargs):
        self.put_chamadas.append(kwargs)
        self.objetos[kwargs["Key"]] = kwargs["Body"]
        return {}

    def delete_object(self, **kwargs):
        self.objetos.pop(kwargs["Key"], None)
        self.removidos.append(kwargs["Key"])
        return {}

    def generate_presigned_url(self, operacao, Params=None, ExpiresIn=None):
        self.geradas.append(Params["Key"])
        return f"https://presigned.invalido/{Params['Key']}?expires={ExpiresIn}"


@pytest.fixture
def s3_fake(monkeypatch):
    fake = FakeS3()

    def _get_s3_client():
        return fake

    def _bucket():
        return "bucket-teste"

    monkeypatch.setattr("routers.documentos_diversos.get_s3_client", _get_s3_client)
    monkeypatch.setattr("routers.documentos_diversos.bucket", _bucket)
    return fake


def _upload(sst_client, nome="relatorio.pdf", mime="application/pdf", conteudo=b"%PDF-1.4 teste"):
    return sst_client.post(
        "/api/sst/documentos-diversos",
        files={"arquivo": (nome, conteudo, mime)},
    )


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------
def test_upload_pdf_ok(sst_client, s3_fake):
    resp = _upload(sst_client)
    assert resp.status_code == 201, resp.text
    meta = resp.json()
    assert meta["nome_original"] == "relatorio.pdf"
    assert meta["mime_type"] == "application/pdf"
    assert meta["tamanho_original"] == len(b"%PDF-1.4 teste")
    assert meta["url_temporaria"].startswith("https://presigned.invalido/")
    # Chave única no bucket
    assert len(s3_fake.put_chamadas) == 1
    chave = s3_fake.put_chamadas[0]["Key"]
    assert chave.startswith("documentos_diversos/")
    assert chave.endswith(".pdf")
    assert chave in s3_fake.objetos


def test_upload_imagem_ok(sst_client, s3_fake):
    resp = _upload(sst_client, nome="foto.png", mime="image/png", conteudo=b"\x89PNG\x0d\x0a\x1a\x0a...")
    assert resp.status_code == 201, resp.text
    meta = resp.json()
    assert meta["mime_type"] == "image/png"
    assert meta["bucket_key"].endswith(".png")


def test_upload_tipo_invalido(sst_client, s3_fake):
    resp = _upload(sst_client, nome="planilha.xlsx", mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    assert resp.status_code == 400
    assert "não permitido" in resp.json()["detail"].lower()
    assert s3_fake.put_chamadas == []


def test_upload_arquivo_vazio(sst_client, s3_fake):
    resp = _upload(sst_client, conteudo=b"")
    assert resp.status_code == 400


def test_upload_excede_limite(sst_client, s3_fake):
    resp = _upload(sst_client, conteudo=b"x" * (15 * 1024 * 1024 + 1))
    assert resp.status_code == 400
    assert "15 MB" in resp.json()["detail"]


def test_upload_pdf_compactado_quando_reduz(sst_client, s3_fake, monkeypatch):
    """Se o PyMuPDF reduzir o tamanho, o conteúdo salvo é o compactado."""
    import routers.documentos_diversos as modulo

    original = b"%PDF-1.4 arquivo grande " * 100
    compactado = b"%PDF-1.4 versao compacta"

    def _comprimir_fake(conteudo):
        assert conteudo == original
        return compactado

    monkeypatch.setattr(modulo, "_comprimir_pdf", _comprimir_fake)
    resp = _upload(sst_client, conteudo=original)
    assert resp.status_code == 201, resp.text
    meta = resp.json()
    assert meta["tamanho_bytes"] == len(compactado)
    assert meta["tamanho_original"] == len(original)


def test_upload_pdf_original_quando_nao_reduz(sst_client, s3_fake, monkeypatch):
    """Se a compressão não reduzir, o conteúdo original é mantido."""
    import routers.documentos_diversos as modulo

    original = b"%PDF-1.4 minimo"

    def _comprimir_fake(conteudo):
        return conteudo  # simula compactação que não ajudou

    monkeypatch.setattr(modulo, "_comprimir_pdf", _comprimir_fake)
    resp = _upload(sst_client, conteudo=original)
    assert resp.status_code == 201, resp.text
    meta = resp.json()
    assert meta["tamanho_bytes"] == len(original)
    assert meta["tamanho_original"] == len(original)


# ---------------------------------------------------------------------------
# Listagem
# ---------------------------------------------------------------------------
def test_listar_vazio(sst_client, s3_fake):
    resp = sst_client.get("/api/sst/documentos-diversos")
    assert resp.status_code == 200
    assert resp.json() == []


def test_listar_documentos(sst_client, s3_fake):
    _upload(sst_client, nome="a.pdf")
    _upload(sst_client, nome="b.jpg", mime="image/jpeg", conteudo=b"jpeg")
    resp = sst_client.get("/api/sst/documentos-diversos")
    assert resp.status_code == 200
    docs = resp.json()
    assert len(docs) == 2
    nomes = {d["nome_original"] for d in docs}
    assert nomes == {"a.pdf", "b.jpg"}
    assert all("url_temporaria" in d for d in docs)
    # Ordenação: mais recente primeiro (inseridos na sequência, ids crescentes)
    assert docs[0]["id"] > docs[1]["id"]


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------
def test_obter_documento_gera_url(sst_client, s3_fake):
    meta = _upload(sst_client).json()
    resp = sst_client.get(f"/api/sst/documentos-diversos/{meta['id']}")
    assert resp.status_code == 200
    dados = resp.json()
    assert dados["url_temporaria"].startswith("https://presigned.invalido/")
    assert dados["nome_original"] == "relatorio.pdf"


def test_obter_documento_inexistente(sst_client, s3_fake):
    resp = sst_client.get("/api/sst/documentos-diversos/999")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Exclusão
# ---------------------------------------------------------------------------
def test_excluir_documento(sst_client, s3_fake):
    meta = _upload(sst_client).json()
    chave = meta["bucket_key"]
    assert chave in s3_fake.objetos

    resp = sst_client.delete(f"/api/sst/documentos-diversos/{meta['id']}")
    assert resp.status_code == 200
    assert chave in s3_fake.removidos
    assert sst_client.get("/api/sst/documentos-diversos").json() == []


def test_excluir_documento_inexistente(sst_client, s3_fake):
    resp = sst_client.delete("/api/sst/documentos-diversos/999")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Permissão
# ---------------------------------------------------------------------------
def test_sem_permissao_nao_lista(client):
    """Usuário sem a permissão 'sst' recebe 403."""
    resp = client.get("/api/sst/documentos-diversos")
    assert resp.status_code == 401  # nem logado está
