"""Testes do módulo de certificados (armazenamento no Backblaze B2).

Usa um fake do cliente S3 para validar os fluxos de upload/download/delete
sem depender de rede ou credenciais reais.
"""

from datetime import date

import pytest


def _criar_funcionario(db_fake):
    db_fake._dados["funcionarios"].append(
        {"id": 1, "nome": "João da Silva", "cpf": "12345678901", "ativo": True, "cargo_id": None, "excluido": False}
    )


class FakeS3:
    """Simula as chamadas do boto3 usadas pelo router de certificados."""

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

    monkeypatch.setattr("routers.certificados.get_s3_client", _get_s3_client)
    monkeypatch.setattr("routers.certificados.bucket", _bucket)
    # Também cobre a exclusão feita pelo router sst (delete do registro),
    # que importa storage no momento da chamada.
    monkeypatch.setattr("storage.get_s3_client", _get_s3_client)
    monkeypatch.setattr("storage.bucket", _bucket)
    return fake


@pytest.fixture
def ft_registro(sst_client, db_fake):
    """Cria funcionário, curso e um registro de treinamento realizado."""
    _criar_funcionario(db_fake)
    treino = sst_client.post(
        "/api/sst/treinamentos",
        json={"nome": "NR-10 Básico", "norma": "NR-10", "validade_meses": 12},
    ).json()
    resp = sst_client.post(
        "/api/sst/funcionario-treinamentos",
        json={"funcionario_id": 1, "treinamento_id": treino["id"], "data_realizacao": date.today().isoformat()},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _upload(sst_client, registro_id, nome="certificado.pdf", mime="application/pdf", conteudo=b"%PDF-1.4 teste"):
    return sst_client.post(
        f"/api/certificados/treinamento/{registro_id}",
        files={"arquivo": (nome, conteudo, mime)},
    )


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------
def test_upload_certificado(sst_client, s3_fake, ft_registro):
    resp = _upload(sst_client, ft_registro)
    assert resp.status_code == 201, resp.text
    meta = resp.json()
    assert meta["tipo_registro"] == "treinamento"
    assert meta["registro_id"] == ft_registro
    assert meta["colaborador_id"] == 1
    assert meta["mime_type"] == "application/pdf"
    assert meta["nome_original"] == "certificado.pdf"
    assert meta["tamanho_bytes"] == len(b"%PDF-1.4 teste")
    assert meta["bucket_key"].startswith("documentos/treinamento/1/")
    assert len(s3_fake.put_chamadas) == 1
    assert s3_fake.put_chamadas[0]["Bucket"] == "bucket-teste"


def test_upload_substitui_anterior(sst_client, s3_fake, ft_registro):
    primeiro = _upload(sst_client, ft_registro).json()
    resp = _upload(sst_client, ft_registro, nome="novo.pdf")
    assert resp.status_code == 201, resp.text
    novo = resp.json()
    assert novo["bucket_key"] != primeiro["bucket_key"]
    # Objeto antigo foi removido do B2
    assert primeiro["bucket_key"] in s3_fake.removidos
    # Metadados antigos foram substituídos (apenas 1 registro para o treinamento)
    certs = [c for c in sst_client.get("/api/sst/funcionario-treinamentos").json()]
    assert certs[0]["tem_certificado"] is True
    assert certs[0]["certificado_nome"] == "novo.pdf"


def test_upload_tipo_invalido(sst_client, s3_fake, ft_registro):
    resp = _upload(sst_client, ft_registro, nome="virus.exe", mime="application/x-msdownload", conteudo=b"MZ...")
    assert resp.status_code == 400
    assert len(s3_fake.put_chamadas) == 0


def test_upload_registro_inexistente(sst_client, s3_fake):
    resp = _upload(sst_client, 9999)
    assert resp.status_code == 404


def test_upload_arquivo_vazio(sst_client, s3_fake, ft_registro):
    resp = _upload(sst_client, ft_registro, conteudo=b"")
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Download (presigned URL)
# ---------------------------------------------------------------------------
def test_download_certificado(sst_client, s3_fake, ft_registro):
    _upload(sst_client, ft_registro)
    resp = sst_client.get(f"/api/certificados/treinamento/{ft_registro}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "https://presigned.invalido/" in body["url_temporaria"]
    assert body["validade_segundos"] == 900
    assert body["mime_type"] == "application/pdf"


def test_download_sem_certificado(sst_client, s3_fake, ft_registro):
    resp = sst_client.get(f"/api/certificados/treinamento/{ft_registro}")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------
def test_delete_certificado(sst_client, s3_fake, ft_registro):
    _upload(sst_client, ft_registro)
    resp = sst_client.delete(f"/api/certificados/treinamento/{ft_registro}")
    assert resp.status_code == 200
    assert resp.json()["success"] is True
    # Objeto removido do B2 e metadados apagados
    assert len(s3_fake.removidos) == 1
    assert sst_client.get(f"/api/certificados/treinamento/{ft_registro}").status_code == 404


# ---------------------------------------------------------------------------
# Lista de treinamentos reflete a existência do certificado
# ---------------------------------------------------------------------------
def test_lista_indica_certificado(sst_client, s3_fake, ft_registro):
    resp = sst_client.get("/api/sst/funcionario-treinamentos")
    assert resp.json()[0]["tem_certificado"] is False

    _upload(sst_client, ft_registro)
    resp = sst_client.get("/api/sst/funcionario-treinamentos")
    item = resp.json()[0]
    assert item["tem_certificado"] is True
    assert item["certificado_nome"] == "certificado.pdf"


# ---------------------------------------------------------------------------
# Exclusão do registro de treinamento remove o objeto do B2
# ---------------------------------------------------------------------------
def test_excluir_registro_remove_certificado(sst_client, s3_fake, ft_registro):
    _upload(sst_client, ft_registro)
    resp = sst_client.delete(f"/api/sst/funcionario-treinamentos/{ft_registro}")
    assert resp.status_code == 200
    assert len(s3_fake.removidos) == 1
    # Metadados sumiram do banco (cascade)
    assert sst_client.get(f"/api/certificados/treinamento/{ft_registro}").status_code == 404


# ---------------------------------------------------------------------------
# Documentos de ASO
# ---------------------------------------------------------------------------
@pytest.fixture
def aso_registro(sst_client, db_fake):
    _criar_funcionario(db_fake)
    resp = sst_client.post(
        "/api/sst/aso",
        json={"funcionario_id": 1, "tipo_exame": "periodico", "data_exame": date.today().isoformat()},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _upload_aso(sst_client, registro_id, nome="aso_laudo.pdf", mime="application/pdf", conteudo=b"%PDF-1.4 laudo"):
    return sst_client.post(
        f"/api/certificados/aso/{registro_id}",
        files={"arquivo": (nome, conteudo, mime)},
    )


def test_upload_documento_aso(sst_client, s3_fake, aso_registro):
    resp = _upload_aso(sst_client, aso_registro)
    assert resp.status_code == 201, resp.text
    meta = resp.json()
    assert meta["tipo_registro"] == "aso"
    assert meta["registro_id"] == aso_registro
    assert meta["colaborador_id"] == 1
    assert meta["mime_type"] == "application/pdf"
    assert meta["nome_original"] == "aso_laudo.pdf"
    assert meta["bucket_key"].startswith("documentos/aso/1/")


def test_download_documento_aso(sst_client, s3_fake, aso_registro):
    _upload_aso(sst_client, aso_registro)
    resp = sst_client.get(f"/api/certificados/aso/{aso_registro}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "https://presigned.invalido/" in body["url_temporaria"]
    assert body["validade_segundos"] == 900


def test_delete_documento_aso(sst_client, s3_fake, aso_registro):
    _upload_aso(sst_client, aso_registro)
    resp = sst_client.delete(f"/api/certificados/aso/{aso_registro}")
    assert resp.status_code == 200
    assert len(s3_fake.removidos) == 1
    assert sst_client.get(f"/api/certificados/aso/{aso_registro}").status_code == 404


def test_lista_aso_indica_documento(sst_client, s3_fake, aso_registro):
    resp = sst_client.get("/api/sst/aso")
    assert resp.json()[0]["tem_documento"] is False

    _upload_aso(sst_client, aso_registro)
    resp = sst_client.get("/api/sst/aso")
    item = resp.json()[0]
    assert item["tem_documento"] is True
    assert item["documento_nome"] == "aso_laudo.pdf"


def test_excluir_aso_remove_documento(sst_client, s3_fake, aso_registro):
    _upload_aso(sst_client, aso_registro)
    resp = sst_client.delete(f"/api/sst/aso/{aso_registro}")
    assert resp.status_code == 200
    assert len(s3_fake.removidos) == 1
    assert sst_client.get(f"/api/certificados/aso/{aso_registro}").status_code == 404


def test_treinamento_e_aso_nao_entram_em_conflito(sst_client, s3_fake, ft_registro, aso_registro):
    """O mesmo id numérico pode ter documentos em tipos diferentes."""
    _upload(sst_client, ft_registro)
    resp = _upload_aso(sst_client, aso_registro)
    assert resp.status_code == 201, resp.text
    assert len(s3_fake.put_chamadas) == 2
