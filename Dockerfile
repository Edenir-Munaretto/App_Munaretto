FROM python:3.11-slim

# Evita que o Python grave arquivos .pyc no disco
ENV PYTHONDONTWRITEBYTECODE=1
# Garante que as saídas do python cheguem ao console em tempo real
ENV PYTHONUNBUFFERED=1
# Define o PYTHONPATH para que os módulos do backend sejam encontrados
ENV PYTHONPATH=/app/backend

# Instala o LibreOffice e fontes essenciais para conversão de PDF
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      libreoffice-writer \
      libreoffice-java-common \
      fonts-dejavu-core \
      fonts-dejavu-extra \
      fonts-liberation \
      fonts-liberation2 \
      fonts-croscore \
      fontconfig \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia e instala as dependências do backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia todos os arquivos do projeto
COPY . .

# Executa sem privilégios de root (usuário dedicado com home gravável).
RUN useradd --create-home --uid 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
