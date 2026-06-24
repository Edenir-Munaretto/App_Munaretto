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

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
