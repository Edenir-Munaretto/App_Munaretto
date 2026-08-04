import tkinter as tk
from tkinter import ttk, messagebox
from datetime import datetime
import database
from formatting import date_to_br


class VacationsView:
    def __init__(self, app):
        self.app = app
        self.ferias_entries = {}
        self.ferias_tree = None
        self.search_colab_var = tk.StringVar()

    def show(self):
        self.app.clear_content()

        main_frame = ttk.Frame(self.app.content_frame)
        main_frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=10)
        ttk.Label(main_frame, text="🌴 Gestão de Férias Colaboradores", font=("Segoe UI", 18, "bold"), foreground="#f39c12").pack(pady=(0,15))

        container = tk.Frame(main_frame, bg="white", highlightbackground="#e0e0e0", highlightthickness=1)
        container.pack(fill=tk.BOTH, expand=True)

        form_lf = tk.LabelFrame(container, text=" Cadastrar Novas Férias ", font=("Segoe UI", 10, "bold"), bg="white")
        form_lf.pack(fill=tk.X, padx=20, pady=10)

        fields = [("Nome Colaborador:", "nome"), ("Início :", "inicio"), ("Dias Abono (Máx 10):", "abono"), ("Dias Gozo:", "dias_gozo"), ("Data Limite :", "limite")]
        self.ferias_entries = {}
        for i, (label, key) in enumerate(fields):
            ttk.Label(form_lf, text=label, background="white", font=("Segoe UI", 9, "bold")).grid(row=0, column=i*2, padx=(10,2), pady=10)
            w = 35 if key == "nome" else 15
            entry = tk.Entry(form_lf, font=("Segoe UI", 10), width=w, bg="#CED1D4", relief="flat", highlightthickness=1, highlightbackground="#E0E0E0", highlightcolor=self.app.primary_color)
            entry.grid(row=0, column=i*2+1, padx=(0,10), pady=10, ipady=3)
            self.ferias_entries[key] = entry

        btn_save = tk.Button(form_lf, text="💾 Salvar", command=self.save_vacation, bg=self.app.primary_color, fg="white", relief="flat", padx=10)
        btn_save.grid(row=0, column=8, padx=10)

        rel_frame = ttk.Frame(container, style="White.TFrame")
        rel_frame.pack(fill=tk.X, padx=20, pady=5)

        tk.Button(rel_frame, text="📅 Previsão Próximo Mês", command=self.view_next_month_vacation, bg=self.app.secondary_color, fg="white", relief="flat", padx=15, pady=5).pack(side=tk.LEFT, padx=5)

        search_entry = tk.Entry(rel_frame, textvariable=self.search_colab_var, width=30, bg="#CED1D4", relief="flat", highlightthickness=1, highlightbackground="#E0E0E0", highlightcolor=self.app.primary_color)
        search_entry.pack(side=tk.LEFT, padx=(20,5), ipady=3)
        tk.Button(rel_frame, text="🔍 Buscar Histórico", command=self.view_colab_history, bg="#34495e", fg="white", relief="flat", padx=15, pady=5).pack(side=tk.LEFT)

        self.ferias_tree = ttk.Treeview(container, columns=("ID", "Nome", "Início", "Gozo", "Abono", "Retorno", "Limite", "Status"), show="headings")
        cols = [("ID", 40), ("Nome", 150), ("Início", 100), ("Gozo", 60), ("Abono", 60), ("Retorno", 100), ("Limite", 100), ("Status", 100)]
        for col, width in cols:
            self.ferias_tree.heading(col, text=col)
            self.ferias_tree.column(col, width=width)
        self.ferias_tree.pack(fill=tk.BOTH, expand=True, padx=20, pady=10)

        tk.Button(rel_frame, text="🗑️ Excluir Selecionado", command=self.delete_vacation, bg=self.app.accent_color, fg="white", relief="flat", padx=15, pady=5).pack(side=tk.LEFT, padx=5)

        # Carrega registros iniciais
        self.view_next_month_vacation()

    def delete_vacation(self):
        selection = self.ferias_tree.selection()
        if not selection:
            messagebox.showwarning("Aviso", "Selecione um registro para excluir.")
            return
        item = self.ferias_tree.item(selection[0])
        ferias_id = item['values'][0]
        nome = item['values'][1]
        if messagebox.askyesno("Confirmar", f"Deseja realmente excluir o registro de férias de {nome}?"):
            if database.deletar_ferias(ferias_id):
                messagebox.showinfo("Sucesso", "Registro removido.")
                self.view_colab_history()
            else:
                messagebox.showerror("Erro", "Não foi possível excluir o registro.")
        self.check_vacation_alerts()

    def save_vacation(self):
        nome = self.ferias_entries['nome'].get().strip()
        inicio_input = self.ferias_entries['inicio'].get().strip()
        limite_input = self.ferias_entries['limite'].get().strip()
        dias_gozo_input = self.ferias_entries['dias_gozo'].get().strip()
        try:
            abono = int(self.ferias_entries['abono'].get().strip() or 0)
            dias_gozo = int(dias_gozo_input) if dias_gozo_input else None
            try:
                data_inicio_obj = datetime.strptime(inicio_input, "%d/%m/%Y")
                data_inicio_db = data_inicio_obj.strftime("%Y-%m-%d")
            except ValueError:
                messagebox.showerror("Erro", "Formato da Data de Início inválido. Use DD/MM/AAAA.")
                return
            data_limite_db = ""
            if limite_input:
                try:
                    data_limite_obj = datetime.strptime(limite_input, "%d/%m/%Y")
                    data_limite_db = data_limite_obj.strftime("%Y-%m-%d")
                except ValueError:
                    messagebox.showerror("Erro", "Formato da Data Limite inválido. Use DD/MM/AAAA.")
                    return
            sucesso, mensagem = database.adicionar_ferias(nome, data_inicio_db, abono, data_limite_db, dias_gozo)
            if sucesso:
                messagebox.showinfo("Sucesso", mensagem)
                for entry in self.ferias_entries.values():
                    entry.delete(0, tk.END)
            else:
                messagebox.showerror("Erro", mensagem)
        except ValueError:
            messagebox.showerror("Erro", "Dias de abono e dias de gozo devem ser números inteiros.")
        except Exception as e:
            messagebox.showerror("Erro", f"Ocorreu um erro inesperado: {e}")

    def format_date_br(self, date_str):
        try:
            return datetime.strptime(date_str, "%Y-%m-%d").strftime("%d/%m/%Y")
        except:
            return date_str

    def calculate_current_status(self, data_inicio_db, data_retorno_db):
        try:
            hoje = datetime.now().date()
            inicio = datetime.strptime(data_inicio_db, "%Y-%m-%d").date()
            retorno = datetime.strptime(data_retorno_db, "%Y-%m-%d").date()
            if hoje < inicio:
                return "📅 Agendado"
            elif inicio <= hoje < retorno:
                return "🌴 Em Férias"
            else:
                return "✅ Concluído"
        except:
            return "Indefinido"

    def view_next_month_vacation(self):
        for i in self.ferias_tree.get_children(): self.ferias_tree.delete(i)
        records = database.listar_ferias_proximo_mes()
        for r in records:
            status = self.calculate_current_status(r['data_inicio'], r['data_retorno'])
            self.ferias_tree.insert("", "end", values=(r['id'], r['nome'], self.format_date_br(r['data_inicio']), r['dias_gozo'], r['dias_abono'], self.format_date_br(r['data_retorno']), self.format_date_br(r['data_limite']), status))

    def view_colab_history(self):
        nome = self.search_colab_var.get().strip()
        for i in self.ferias_tree.get_children(): self.ferias_tree.delete(i)
        records = database.buscar_ferias_por_colaborador(nome)
        for r in records:
            status = self.calculate_current_status(r['data_inicio'], r['data_retorno'])
            self.ferias_tree.insert("", "end", values=(r['id'], r['nome'], self.format_date_br(r['data_inicio']), r['dias_gozo'], r['dias_abono'], self.format_date_br(r['data_retorno']), self.format_date_br(r['data_limite']), status))

    def check_vacation_alerts(self):
        dados = database.obter_alertas_ferias()
        hoje = datetime.now()
        alertas = []
        for r in dados:
            try:
                dt_limite = datetime.strptime(r['data_limite'], "%Y-%m-%d")
                dias_restantes = (dt_limite - hoje).days
                if 10 < dias_restantes <= 30:
                    alertas.append(f"⚠️ {r['nome']}: Faltam {dias_restantes} dias para o limite ({self.format_date_br(r['data_limite'])}).")
                elif 0 <= dias_restantes <= 10:
                    alertas.append(f"🚨 URGENTE: {r['nome']} precisa gozar férias até {self.format_date_br(r['data_limite'])}!")
            except:
                continue
        if alertas:
            messagebox.showwarning("Aviso de Prazos de Férias", "\n".join(alertas))
