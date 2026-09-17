"""Ambiente Jinja2 restrito para renderizar templates DOCX/XLSX.

Os templates podem ser enviados por usuários (upload em Documentos). Um
template Jinja2 comum executa expressões arbitrárias no servidor; o
SandboxedEnvironment bloqueia o acesso a atributos internos (``__class__``,
``__globals__`` etc.) e a chamada de objetos não seguros.
"""

from jinja2.sandbox import SandboxedEnvironment


def criar_ambiente_jinja() -> SandboxedEnvironment:
    """Cria um ambiente Jinja2 em sandbox para os templates do docxtpl."""
    return SandboxedEnvironment(autoescape=False)
