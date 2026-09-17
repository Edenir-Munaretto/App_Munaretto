FROM python:3.11-slim

# Evita que o Python grave arquivos .pyc no disco
ENV PYTHONDONTWRITEBYTECODE 1
# Garante que as saídas do python cheguem ao console em tempo real
ENV PYTHONUNBUFFERED 1

# Instala o LibreOffice headless e fontes essenciais para conversão de PDF
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

# Copia e instala as dependências
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia os arquivos do backend e os templates
COPY . .

# Executa sem privilégios de root (usuário dedicado com home gravável, que o
# LibreOffice precisa para rodar headless).
RUN useradd --create-home --uid 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT','8000') + '/health', timeout=4)"

# Render injeta a porta via variável PORT; fallback para 8000 em dev local.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
