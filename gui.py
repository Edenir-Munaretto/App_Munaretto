import tkinter as tk
from tkinter import ttk, messagebox, filedialog, simpledialog
import database
import documents
import google_drive
import os
import webbrowser
import gerador_relatorio
from datetime import datetime

class AppMunaretto:
    def __init__(self, root):
        self.root = root
        
        # Inicializa o banco de dados no novo local (Google Drive) antes de carregar a UI
        database.inicializar_banco()
        
        self.root.title("Gerenciador de Contratos - App Munaretto")
        self.root.geometry("1200x900")  # Janela maior
        self.root.minsize(1000, 800)  # Tamanho mínimo maior
        self.root.configure(bg="#f0f2f5")

        # Estilo moderno
        style = ttk.Style()
        style.configure("TButton", font=("Segoe UI", 10), padding=10)
        style.configure("TLabel", font=("Segoe UI", 11), background="#f0f2f5")
        style.configure("TFrame", background="#f0f2f5")
        style.configure("Treeview", font=("Segoe UI", 9), rowheight=25)
        style.configure("Treeview.Heading", font=("Segoe UI", 10, "bold"))

        # Cores do tema
        self.primary_color = "#1877f2"
        self.secondary_color = "#42b883"
        self.accent_color = "#e74c3c"
        self.bg_color = "#f0f2f5"
        self.card_color = "#ffffff"

        self.setup_ui()
        self.load_clients()

    def setup_ui(self):
        # Frame principal
        main_frame = ttk.Frame(self.root)
        main_frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=20)

        # Título
        title_frame = ttk.Frame(main_frame, style="TFrame")
        title_frame.pack(fill=tk.X, pady=(0, 20))

        title_label = ttk.Label(
            title_frame,
            text="📄 Gerenciador de Contratos",
            font=("Segoe UI", 24, "bold"),
            foreground=self.primary_color
        )
        title_label.pack()

        subtitle_label = ttk.Label(
            title_frame,
            text="App Munaretto - Gestão profissional de documentos",
            font=("Segoe UI", 12),
            foreground="#666666"
        )
        subtitle_label.pack(pady=(5, 0))

        # Frame de botões principais
        buttons_frame = ttk.Frame(main_frame, style="TFrame")
        buttons_frame.pack(fill=tk.X, pady=(0, 20))

        # Grid de botões
        button_configs = [
            ("👤 Cadastrar Cliente", self.show_client_form, self.primary_color),
            ("📋 Listar Clientes", self.show_clients_list, self.primary_color),
            ("📄 Gerar Documento", self.show_document_generator, self.secondary_color),
            ("🌴 Gestão Férias", self.show_history, "#f39c12"),
            ("📊 Gestão Usinas", self.show_fluxo_caixa, "#e74c3c"),
            ("📤 Importar Modelo", self.import_template, "#9b59b6"),
        ]

        for i, (text, command, color) in enumerate(button_configs):
            btn = tk.Button(
                buttons_frame,
                text=text,
                command=command,
                font=("Segoe UI", 11, "bold"),
                bg=color,
                fg="white",
                relief="flat",
                padx=20,
                pady=12,
                cursor="hand2"
            )
            btn.grid(row=i//3, column=i%3, padx=10, pady=10, sticky="ew")

            # Hover effect
            btn.bind("<Enter>", lambda e, b=btn: b.configure(bg=self.adjust_color(color, -20)))
            btn.bind("<Leave>", lambda e, b=btn, c=color: b.configure(bg=c))

        # Configurar grid
        for i in range(3):
            buttons_frame.grid_columnconfigure(i, weight=1)

        # Frame de conteúdo
        self.content_frame = ttk.Frame(main_frame, style="TFrame")
        self.content_frame.pack(fill=tk.BOTH, expand=True)

        # Frame inicial
        self.show_welcome()

    def adjust_color(self, color, amount):
        """Ajusta a intensidade de uma cor."""
        if color.startswith("#"):
            r = int(color[1:3], 16) + amount
            g = int(color[3:5], 16) + amount
            b = int(color[5:7], 16) + amount
            r = max(0, min(255, r))
            g = max(0, min(255, g))
            b = max(0, min(255, b))
            return f"#{r:02x}{g:02x}{b:02x}"
        return color

    def clear_content(self):
        """Limpa o frame de conteúdo."""
        for widget in self.content_frame.winfo_children():
            widget.destroy()

    def show_welcome(self):
        """Mostra tela de boas-vindas."""
        self.clear_content()

        welcome_frame = ttk.Frame(self.content_frame, style="TFrame")
        welcome_frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=20)

        # Card de boas-vindas
        card = tk.Frame(welcome_frame, bg=self.card_color, relief="flat", bd=1)
        card.pack(fill=tk.BOTH, expand=True)

        # Sombra
        card.configure(highlightbackground="#e0e0e0", highlightthickness=1)

        welcome_label = ttk.Label(
            card,
            text="🏠 Bem-vindo ao App Munaretto!",
            font=("Segoe UI", 18, "bold"),
            foreground=self.primary_color,
            background=self.card_color
        )
        welcome_label.pack(pady=(30, 10))

        desc_label = ttk.Label(
            card,
            text="Gerencie seus contratos e documentos de forma profissional.\n"
                 "Cadastre clientes, gere documentos personalizados e mantenha\n"
                 "tudo organizado com backup automático.",
            font=("Segoe UI", 11),
            background=self.card_color,
            justify="center"
        )
        desc_label.pack(pady=(0, 30))

        # Estatísticas rápidas
        stats_frame = ttk.Frame(card, style="TFrame")
        stats_frame.pack(fill=tk.X, padx=40, pady=(0, 30))

        try:
            client_count = len(database.listar_clientes())
            doc_count = len(os.listdir(documents.OUTPUT_DIR)) if os.path.exists(documents.OUTPUT_DIR) else 0
        except:
            client_count = 0
            doc_count = 0

        stats = [
            (f"👥 {client_count}", "Clientes\nCadastrados"),
            (f"📄 {doc_count}", "Documentos\nGerados"),
            ("⚡ Rápido", "Processamento\nInstantâneo")
        ]

        for i, (number, label) in enumerate(stats):
            stat_frame = ttk.Frame(stats_frame, style="TFrame")
            stat_frame.pack(side=tk.LEFT, expand=True)

            num_label = ttk.Label(
                stat_frame,
                text=number,
                font=("Segoe UI", 20, "bold"),
                foreground=self.primary_color,
                background=self.card_color
            )
            num_label.pack()

            text_label = ttk.Label(
                stat_frame,
                text=label,
                font=("Segoe UI", 9),
                background=self.card_color,
                justify="center"
            )
            text_label.pack()

    def show_client_form(self):
        """Mostra formulário de cadastro de cliente com fundo branco e campos coloridos."""
        self.clear_content()

        # --- Configuração de Estilos ---
        style = ttk.Style()
        # Estilo para os frames ficarem com fundo branco
        style.configure("White.TFrame", background="white")

        # Container Principal (Fundo da página)
        form_frame = ttk.Frame(self.content_frame)
        form_frame.pack(fill=tk.BOTH, expand=True, padx=30, pady=10)

        # Cabeçalho
        header_frame = ttk.Frame(form_frame)
        header_frame.pack(side=tk.TOP, fill=tk.X, pady=(0, 10))

        ttk.Label(header_frame, text="👤 Cadastrar Novo Cliente", font=("Segoe UI", 20, "bold"),
                  foreground=self.primary_color).pack(side="left")

        # --- Rodapé e Botão ---
        footer_frame = ttk.Frame(form_frame, style="White.TFrame")
        footer_frame.pack(side=tk.BOTTOM, fill=tk.X, pady=(10, 0))

        save_btn = tk.Button(
            footer_frame,
            text="💾 Salvar Cadastro de Cliente",
            command=self.save_client,
            font=("Segoe UI", 12, "bold"),
            bg=self.primary_color,
            fg="white",
            relief="flat",
            height=2,
            cursor="hand2",
            activebackground=self.adjust_color(self.primary_color, -30),
            activeforeground="white"
        )
        save_btn.pack(fill=tk.X)

        # Hover effect
        save_btn.bind("<Enter>", lambda e: save_btn.configure(bg=self.adjust_color(self.primary_color, -20)))
        save_btn.bind("<Leave>", lambda e: save_btn.configure(bg=self.primary_color))

        # --- Container dos Campos (Fundo Branco) ---
        main_container = tk.Frame(form_frame, bg="white", highlightbackground="#b8b3b3", highlightthickness=1)
        main_container.pack(side=tk.TOP, fill=tk.BOTH, expand=True)

        # --- Organização dos Campos ---
        sections = [
            ("Informações Principais", [
                ("Nome completo:", "nome", 0, 0),
                ("CPF/CNPJ:", "cpf_cnpj", 0, 1),
                ("Endereço:", "endereco", 1, 0),
                ("Cidade:", "cidade", 1, 1),
                ("CEP:", "cep", 2, 0),
                ("Nota PS:", "nota_ps", 2, 1),
            ]),
            ("Financeiro e Obra", [
                ("Valor da Obra:", "valor_da_obra", 0, 0),
                ("Valor de Devolução:", "valor_de_devolucao", 0, 1),
            ])
        ]

        self.entries = {}

        for section_title, fields in sections:
            # Frame da Seção (Branco)
            sec_frame = ttk.Frame(main_container, style="White.TFrame")
            sec_frame.pack(fill=tk.X, padx=40, pady=(10, 0))

            ttk.Label(sec_frame, text=section_title, font=("Segoe UI", 12, "bold"),
                      foreground="#555", background="white").pack(anchor="w", pady=(0, 10))
            
            # Grid para os campos (Branco)
            grid_frame = ttk.Frame(sec_frame, style="White.TFrame")
            grid_frame.pack(fill=tk.X)
            grid_frame.columnconfigure((0, 1), weight=1, uniform="group1")

            for label_text, field_name, row, col in fields:
                # Container do Campo (Branco)
                f_container = ttk.Frame(grid_frame, style="White.TFrame")
                f_container.grid(row=row, column=col, padx=(0 if col==0 else 15, 15 if col==0 else 0), pady=8, sticky="ew")

                ttk.Label(f_container, text=label_text, font=("Segoe UI", 9, "bold"), 
                          background="white").pack(anchor="w")
                
                # Usando tk.Entry para garantir a aplicação da cor de fundo (bg)
                # Isso contorna restrições de temas nativos do Windows no ttk.Entry
                entry = tk.Entry(
                    f_container,
                    font=("Segoe UI", 11),
                    bg="#CED1D4",         # Cor de fundo definida (Cinza claro para melhor leitura)
                    relief="flat",        # Visual plano e moderno
                    highlightthickness=1,  # Borda fina
                    highlightbackground="#E0E0E0", # Cor da borda em estado normal
                    highlightcolor=self.primary_color # Cor da borda quando focado
                )
                entry.pack(fill=tk.X, ipady=4, pady=(4, 0))
                self.entries[field_name] = entry

        # Auto-focus inicial
        self.root.after(400, lambda: self.entries["nome"].focus_set())


    def save_client(self):
        """Salva um novo cliente."""
        # Campos obrigatórios
        required_fields = ['nome', 'cpf_cnpj', 'endereco']
        data = {}

        for field, entry in self.entries.items():
            value = entry.get().strip()
            if field in required_fields and not value:
                messagebox.showerror("Erro", f"Campo '{field}' é obrigatório!")
                return
            data[field] = value

        cliente_id = database.adicionar_cliente(**data)
        if cliente_id:
            messagebox.showinfo("Sucesso", f"Cliente '{data['nome']}' cadastrado com sucesso!")
            for entry in self.entries.values():
                entry.delete(0, tk.END)
            self.load_clients()
        else:
            messagebox.showerror("Erro", "CPF/CNPJ já cadastrado!")

    def show_clients_list(self):
        """Mostra lista de clientes."""
        self.clear_content()

        list_frame = ttk.Frame(self.content_frame, style="TFrame")
        list_frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=20)

        # Título
        title_label = ttk.Label(
            list_frame,
            text="📋 Lista de Clientes",
            font=("Segoe UI", 18, "bold"),
            foreground=self.primary_color
        )
        title_label.pack(pady=(0, 20))

        # Busca de clientes
        search_frame = ttk.Frame(list_frame, style="TFrame")
        search_frame.pack(fill=tk.X, pady=(0, 15))

        ttk.Label(search_frame, text="Buscar:", font=("Segoe UI", 11, "bold"), background="#f0f2f5").pack(side=tk.LEFT)
        self.client_search_var = tk.StringVar()
        search_entry = tk.Entry(
            search_frame,
            textvariable=self.client_search_var,
            font=("Segoe UI", 11),
            bg="#CED1D4",
            relief="flat",
            highlightthickness=1,
            highlightbackground="#E0E0E0",
            highlightcolor=self.primary_color
        )
        search_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(10, 10), ipady=4)
        search_entry.bind("<KeyRelease>", lambda e: self.load_clients())

        clear_btn = tk.Button(
            search_frame,
            text="✖",
            command=self.clear_client_search,
            font=("Segoe UI", 10),
            bg="#bdc3c7",
            fg="white",
            relief="flat",
            padx=10,
            pady=6,
            cursor="hand2"
        )
        clear_btn.pack(side=tk.LEFT)

        # Treeview para lista de clientes
        tree_frame = ttk.Frame(list_frame, style="TFrame")
        tree_frame.pack(fill=tk.BOTH, expand=True)

        # Scrollbars
        v_scrollbar = ttk.Scrollbar(tree_frame, orient="vertical")
        h_scrollbar = ttk.Scrollbar(tree_frame, orient="horizontal")

        self.clients_tree = ttk.Treeview(
            tree_frame,
            columns=("ID", "Nome", "CPF/CNPJ", "Cidade", "CEP", "Nota PS"),
            show="headings",
            yscrollcommand=v_scrollbar.set,
            xscrollcommand=h_scrollbar.set
        )
        self.clients_tree.bind("<Double-1>", lambda e: self.edit_selected_client())

        v_scrollbar.config(command=self.clients_tree.yview)
        h_scrollbar.config(command=self.clients_tree.xview)

        # Configurar colunas
        columns = [
            ("ID", 50),
            ("Nome", 180),
            ("CPF/CNPJ", 130),
            ("Cidade", 120),
            ("CEP", 100),
            ("Nota PS", 100)
        ]

        for col, width in columns:
            self.clients_tree.heading(col, text=col)
            self.clients_tree.column(col, width=width)

        # Posicionar widgets
        self.clients_tree.grid(row=0, column=0, sticky="nsew")
        v_scrollbar.grid(row=0, column=1, sticky="ns")
        h_scrollbar.grid(row=1, column=0, sticky="ew")

        tree_frame.grid_rowconfigure(0, weight=1)
        tree_frame.grid_columnconfigure(0, weight=1)

        # Botões de ação
        buttons_frame = ttk.Frame(list_frame, style="TFrame")
        buttons_frame.pack(fill=tk.X, pady=(20, 0))

        edit_btn = tk.Button(
            buttons_frame,
            text="✏️ Editar",
            command=self.edit_selected_client,
            font=("Segoe UI", 10),
            bg="#f39c12",
            fg="white",
            relief="flat",
            padx=20,
            pady=8,
            cursor="hand2"
        )
        edit_btn.pack(side=tk.LEFT, padx=(0, 10))

        delete_btn = tk.Button(
            buttons_frame,
            text="🗑️ Excluir",
            command=self.delete_selected_client,
            font=("Segoe UI", 10),
            bg=self.accent_color,
            fg="white",
            relief="flat",
            padx=20,
            pady=8,
            cursor="hand2"
        )
        delete_btn.pack(side=tk.LEFT)

        self.load_clients()

    def load_clients(self):
        """Carrega lista de clientes na treeview."""
        if hasattr(self, 'clients_tree'):
            # Limpar treeview
            for item in self.clients_tree.get_children():
                self.clients_tree.delete(item)

            search_text = self.client_search_var.get().strip().lower() if hasattr(self, 'client_search_var') else ""
            clients = database.listar_clientes()
            for client in clients:
                # Indices: [0]=id, [1]=nome, [2]=cpf_cnpj, [3]=endereco, [4]=cidade, [5]=cep, [6]=nota_ps
                if search_text:
                    combined = f"{client[1]} {client[2]} {client[3]} {client[4]} {client[5]} {client[6]}".lower()
                    if search_text not in combined:
                        continue
                self.clients_tree.insert("", tk.END, values=(client[0], client[1], client[2], client[4], client[5], client[6]))

    def clear_client_search(self):
        """Limpa o campo de busca e recarrega a lista."""
        if hasattr(self, 'client_search_var'):
            self.client_search_var.set("")
            self.load_clients()

    def edit_selected_client(self):
        """Edita o cliente selecionado."""
        selection = self.clients_tree.selection()
        if not selection:
            messagebox.showwarning("Aviso", "Selecione um cliente para editar!")
            return

        item = self.clients_tree.item(selection[0])
        client_values = item['values']
        # client_values[0]=id
        client_id = client_values[0]
        
        # Buscar dados completos do cliente no banco
        full_client = database.buscar_cliente_por_id(client_id)

        # Criar diálogo de edição
        edit_dialog = tk.Toplevel(self.root)
        edit_dialog.title("Editar Cliente")
        edit_dialog.geometry("500x600")
        edit_dialog.configure(bg=self.bg_color)
        edit_dialog.transient(self.root)
        edit_dialog.grab_set()

        # Campos de edição mapeados corretamente
        # Indices: [0]=id, [1]=nome, [2]=cpf_cnpj, [3]=endereco, [4]=cidade, [5]=cep, [6]=nota_ps, [7]=valor_da_obra, [8]=valor_de_devolucao
        field_configs = [
            ("Nome", "nome", full_client[1]),
            ("CPF/CNPJ", "cpf_cnpj", full_client[2]),
            ("Endereço", "endereco", full_client[3]),
            ("Cidade", "cidade", full_client[4] if full_client[4] else ""),
            ("CEP", "cep", full_client[5] if full_client[5] else ""),
            ("Nota PS", "nota_ps", full_client[6] if full_client[6] else ""),
            ("Valor da Obra", "valor_da_obra", full_client[7] if full_client[7] else ""),
            ("Valor de Devolução", "valor_de_devolucao", full_client[8] if full_client[8] else "")
        ]
        entries = {}

        ttk.Label(edit_dialog, text="Editar Cliente", font=("Segoe UI", 16, "bold")).pack(pady=20)

        for display_name, field_key, value in field_configs:
            frame = ttk.Frame(edit_dialog)
            frame.pack(fill=tk.X, padx=30, pady=5)

            ttk.Label(frame, text=f"{display_name}:").pack(anchor="w")
            entry = tk.Entry(
                frame,
                font=("Segoe UI", 11),
                bg="#CED1D4",
                relief="flat",
                highlightthickness=1,
                highlightbackground="#E0E0E0",
                highlightcolor=self.primary_color
            )
            entry.insert(0, str(value))
            entry.pack(fill=tk.X, ipady=4, pady=(0, 10))
            entries[field_key] = entry

        def save_changes():
            try:
                nome = entries["nome"].get().strip()
                cpf_cnpj = entries["cpf_cnpj"].get().strip()
                endereco = entries["endereco"].get().strip()
                cidade = entries["cidade"].get().strip()
                cep = entries["cep"].get().strip()
                nota_ps = entries["nota_ps"].get().strip()
                valor_da_obra = entries["valor_da_obra"].get().strip()
                valor_de_devolucao = entries["valor_de_devolucao"].get().strip()
                
                if not all([nome, cpf_cnpj, endereco]):
                    messagebox.showerror("Erro", "Nome, CPF/CNPJ e Endereço são obrigatórios!")
                    return
                
                if database.atualizar_cliente(client_id, nome, cpf_cnpj, endereco, cidade, cep, nota_ps, valor_da_obra, valor_de_devolucao):
                    messagebox.showinfo("Sucesso", "Cliente atualizado!")
                    edit_dialog.destroy()
                    self.load_clients()
                else:
                    messagebox.showerror("Erro", "Falha ao atualizar cliente!")
            except Exception as e:
                messagebox.showerror("Erro", f"Erro ao salvar: {str(e)}")

        ttk.Button(edit_dialog, text="Salvar", command=save_changes).pack(pady=20)

    def delete_selected_client(self):
        """Exclui o cliente selecionado."""
        selection = self.clients_tree.selection()
        if not selection:
            messagebox.showwarning("Aviso", "Selecione um cliente para excluir!")
            return

        if messagebox.askyesno("Confirmar", "Tem certeza que deseja excluir este cliente?"):
            item = self.clients_tree.item(selection[0])
            client_id = item['values'][0]
            database.deletar_cliente(client_id)
            self.load_clients()
            messagebox.showinfo("Sucesso", "Cliente excluído!")

    def show_document_generator(self):
        """Mostra gerador de documentos."""
        self.clear_content()

        # --- Configuração de Estilos ---
        style = ttk.Style()
        style.configure("White.TFrame", background="white")

        # Container Principal
        gen_frame = ttk.Frame(self.content_frame)
        gen_frame.pack(fill=tk.BOTH, expand=True, padx=30, pady=10)

        # Cabeçalho (Título com fundo padrão da app)
        header_frame = ttk.Frame(gen_frame)
        header_frame.pack(side=tk.TOP, fill=tk.X, pady=(0, 10))
        ttk.Label(header_frame, text="📄 Gerar Documento", font=("Segoe UI", 20, "bold"),
                  foreground=self.primary_color).pack(side="left")

        # --- Rodapé e Botão (Fundo Branco) ---
        footer_frame = ttk.Frame(gen_frame, style="White.TFrame")
        footer_frame.pack(side=tk.BOTTOM, fill=tk.X, pady=(10, 0))

        generate_btn = tk.Button(
            footer_frame,
            text="🚀 Gerar Documento",
            command=self.generate_document,
            font=("Segoe UI", 12, "bold"),
            bg=self.secondary_color,
            fg="white",
            relief="flat",
            height=2,
            cursor="hand2",
            activebackground=self.adjust_color(self.secondary_color, -30),
            activeforeground="white"
        )
        generate_btn.pack(fill=tk.X)

        # Hover effect
        generate_btn.bind("<Enter>", lambda e: generate_btn.configure(bg=self.adjust_color(self.secondary_color, -20)))
        generate_btn.bind("<Leave>", lambda e: generate_btn.configure(bg=self.secondary_color))

        # --- Card do gerador (Fundo Branco) ---
        card = tk.Frame(gen_frame, bg="white", highlightbackground="#b8b3b3", highlightthickness=1)
        card.pack(side=tk.TOP, fill=tk.BOTH, expand=True)

        # Seleção de cliente
        client_frame = ttk.Frame(card, style="White.TFrame")
        client_frame.pack(fill=tk.X, padx=30, pady=10)

        # Carregar clientes
        self.all_clients_gen = database.listar_clientes()

        ttk.Label(
            client_frame, 
            text="🔍 Busca Rápida (Nome ou CPF/CNPJ):", 
            font=("Segoe UI", 11, "bold"), 
            background="white").pack(anchor="w")
            
        self.client_search_gen_var = tk.StringVar()
        search_entry = tk.Entry(
            client_frame, 
            textvariable=self.client_search_gen_var, 
            font=("Segoe UI", 11),
            bg="#CED1D4",
            relief="flat",
            highlightthickness=1,
            highlightbackground="#E0E0E0",
            highlightcolor=self.primary_color
        )
        search_entry.pack(fill=tk.X, ipady=4, pady=(5, 10))
        search_entry.bind("<KeyRelease>", lambda e: self.filter_clients_gen())

        ttk.Label(client_frame, text="Selecionar Cliente:", font=("Segoe UI", 11, "bold"), background="white").pack(anchor="w")
        self.client_var = tk.StringVar()
        self.client_combo = ttk.Combobox(client_frame, textvariable=self.client_var, state="readonly", font=("Segoe UI", 11))
        self.client_combo.pack(fill=tk.X, pady=(5, 10))

        if not self.all_clients_gen:
            self.client_var.set("❌ Nenhum cliente cadastrado no sistema")
        else:
            self.update_client_combo(self.all_clients_gen)

        # Seleção de tipo de documento
        doc_frame = ttk.Frame(card, style="White.TFrame")
        doc_frame.pack(fill=tk.X, padx=30, pady=10)

        ttk.Label(doc_frame, text="Tipo de Documento:", font=("Segoe UI", 11, "bold"), background="white").pack(anchor="w")
        self.doc_var = tk.StringVar()
        self.doc_combo = ttk.Combobox(doc_frame, textvariable=self.doc_var, state="readonly", font=("Segoe UI", 11))
        self.doc_combo.pack(fill=tk.X, pady=(5, 10))

        templates = documents.get_templates()
        self.doc_combo['values'] = list(templates.keys())
        self.templates_data = templates

        # Seleção de formato
        format_frame = ttk.Frame(card, style="White.TFrame")
        format_frame.pack(fill=tk.X, padx=30, pady=10)

        ttk.Label(format_frame, text="Formato de Saída:", font=("Segoe UI", 11, "bold"), background="white").pack(anchor="w")
        self.format_var = tk.StringVar(value="")
        formats = [
            ("Word (.docx)", "word"),
            ("PDF (.pdf)", "pdf")
        ]
             
        self.format_combo = ttk.Combobox(format_frame, textvariable=self.format_var, state="readonly", font=("Segoe UI", 11))
        self.format_combo['values'] = [f[0] for f in formats]
        self.format_combo.pack(fill=tk.X, pady=(5, 10))
        self.format_map = {f[0]: f[1] for f in formats}

    def show_fluxo_caixa(self):
        """Módulo de Gestão de Usinas - Fluxo de Caixa Mensal."""
        self.clear_content()
        
        main_frame = ttk.Frame(self.content_frame)
        main_frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=10)
        
        ttk.Label(main_frame, text="📊 Gestão Usinas - Fluxo de Caixa", font=("Segoe UI", 18, "bold"), 
                  foreground=self.primary_color).pack(pady=(0, 15))

        container = tk.Frame(main_frame, bg="white", highlightbackground="#e0e0e0", highlightthickness=1)
        container.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)

        # Mês de Referência
        ref_frame = ttk.Frame(container, style="White.TFrame")
        ref_frame.pack(side=tk.TOP, fill=tk.X, padx=20, pady=10)
        ttk.Label(ref_frame, text="Mês de Referência (ex: Janeiro/2024):", font=("Segoe UI", 10, "bold"), background="white").pack(side=tk.LEFT)
        self.mes_ref_entry = tk.Entry(ref_frame, font=("Segoe UI", 11), bg="#CED1D4", relief="flat", width=25)
        self.mes_ref_entry.pack(side=tk.LEFT, padx=10, ipady=3)

        # --- Botões de Ação (Empacotados no fundo primeiro para garantir visibilidade) ---
        btn_frame = ttk.Frame(container, style="White.TFrame")
        btn_frame.pack(side=tk.BOTTOM, fill=tk.X, padx=20, pady=10)

        ttk.Label(btn_frame, text="Tipo de Relatório:", font=("Segoe UI", 9), background="white").pack(side=tk.LEFT, padx=(0, 5))
        self.report_type_var = tk.StringVar(value="Geral")
        self.report_type_combo = ttk.Combobox(btn_frame, textvariable=self.report_type_var, state="readonly", width=15)
        self.report_type_combo['values'] = ["Geral", "Demarco", "Marlene", "João B.", "Nei Rigo", "Gilmar T."]
        self.report_type_combo.pack(side=tk.LEFT, padx=5)

        tk.Button(btn_frame, text="🔄 Calcular Fechamento", command=self.calculate_fluxo, font=("Segoe UI", 10, "bold"), 
                  bg=self.primary_color, fg="white", relief="flat", padx=15, pady=8, cursor="hand2").pack(side=tk.LEFT, padx=5)
        
        tk.Button(btn_frame, text="💾 Salvar Fechamento", command=self.save_fluxo, font=("Segoe UI", 10, "bold"), 
                  bg=self.secondary_color, fg="white", relief="flat", padx=15, pady=8, cursor="hand2").pack(side=tk.LEFT, padx=5)

        tk.Button(btn_frame, text="📄 Gerar Relatório PDF", command=self.generate_fluxo_report, font=("Segoe UI", 10, "bold"), 
                  bg="#f39c12", fg="white", relief="flat", padx=15, pady=8, cursor="hand2").pack(side=tk.LEFT, padx=5)

        # --- Resultados e Divisão (Logo acima dos botões no fundo) ---
        res_frame = tk.Frame(container, bg="#f8f9fa", bd=1, relief="solid")
        res_frame.pack(side=tk.BOTTOM, fill=tk.X, padx=20, pady=5)
        
        self.lbl_total_liquido = ttk.Label(res_frame, text="TOTAL LÍQUIDO: R$ 0,00", font=("Segoe UI", 14, "bold"), foreground=self.secondary_color, background="#f8f9fa")
        self.lbl_total_liquido.pack(pady=10)

        # Sócios
        socios_frame = tk.Frame(res_frame, bg="#f8f9fa")
        socios_frame.pack(fill=tk.X, padx=20, pady=5)
        
        self.socio_labels = {}
        socios_config = [("Demarco (25%)", "s1"), ("Marlene (30%)", "s2"), ("João B.(30%)", "s3"), ("Nei Rigo (10%)", "s4"), ("Gilmar T.(5%)", "s5")]
        
        for name, key in socios_config:
            lbl = ttk.Label(socios_frame, text=f"{name}: R$ 0,00", font=("Segoe UI", 9, "bold"), background="#f8f9fa")
            lbl.pack(side=tk.LEFT, expand=True)
            self.socio_labels[key] = lbl

        # Layout de duas colunas para Entradas e Saídas (Ocupa o centro)
        cols_frame = ttk.Frame(container, style="White.TFrame")
        cols_frame.pack(side=tk.TOP, fill=tk.BOTH, expand=True, padx=20)
        cols_frame.columnconfigure(0, weight=1)
        cols_frame.columnconfigure(1, weight=1)

        # --- Coluna Rendimentos ---
        rend_lf = tk.LabelFrame(cols_frame, text=" Rendimentos (R$) ", font=("Segoe UI", 10, "bold"), bg="white")
        rend_lf.grid(row=0, column=0, sticky="nsew", padx=(0, 10), pady=10)
        
        self.rend_fields = {
            "rendimento_usina1": "Rendimento Usina 01:",
            "rendimento_usina2": "Rendimento Usina 02:",
            "rendimento_usina3": "Rendimento Usina 03:"
        }
        self.rend_entries = {}
        for i, (key, label) in enumerate(self.rend_fields.items()):
            ttk.Label(rend_lf, text=label, background="white").grid(row=i, column=0, sticky="w", padx=10, pady=5)
            entry = tk.Entry(rend_lf, font=("Segoe UI", 11), bg="#CED1D4", relief="flat", width=15)
            entry.insert(0, "0.00")
            entry.grid(row=i, column=1, sticky="e", padx=10, pady=5, ipady=3)
            self.rend_entries[key] = entry

        # --- Coluna Despesas ---
        desp_lf = tk.LabelFrame(cols_frame, text=" Despesas Operacionais (R$) ", font=("Segoe UI", 10, "bold"), bg="white")
        desp_lf.grid(row=0, column=1, sticky="nsew", pady=10)

        self.desp_fields = {
            "despesa_contabilidade": "Contabilidade:",
            "despesa_internet": "Internet:",
            "despesa_lavagem": "Lavagem Usinas:",
            "despesa_manutencao": "Manutenção:",
            "despesa_imposto": "Impostos:",
            "despesa_taxa": "Taxas Bancárias:",
            "despesa_diversas": "Diversas:"
        }
        self.desp_entries = {}
        for i, (key, label) in enumerate(self.desp_fields.items()):
            row = i // 2
            col = (i % 2) * 2
            ttk.Label(desp_lf, text=label, background="white").grid(row=row, column=col, sticky="w", padx=(10, 2), pady=2)
            entry = tk.Entry(desp_lf, font=("Segoe UI", 11), bg="#CED1D4", relief="flat", width=12)
            entry.insert(0, "0.00")
            entry.grid(row=row, column=col+1, sticky="e", padx=(2, 10), pady=2, ipady=3)
            self.desp_entries[key] = entry


    def calculate_fluxo(self):
        """Calcula totais e divisões."""
        try:
            def get_val(entry):
                v = entry.get().replace(",", ".")
                return float(v) if v else 0.0

            total_rend = sum(get_val(e) for e in self.rend_entries.values())
            total_desp = sum(get_val(e) for e in self.desp_entries.values())
            liquido = total_rend - total_desp

            self.lbl_total_liquido.config(text=f"TOTAL LÍQUIDO: R$ {liquido:,.2f}".replace(",", "X").replace(".", ",").replace("X", "."))

            # Divisão Sócios
            divisoes = {
                "s1": liquido * 0.25,
                "s2": liquido * 0.30,
                "s3": liquido * 0.30,
                "s4": liquido * 0.10,
                "s5": liquido * 0.05
            }

            for key, val in divisoes.items():
                label_text = self.socio_labels[key].cget("text").split(":")[0]
                self.socio_labels[key].config(text=f"{label_text}: R$ {val:,.2f}".replace(",", "X").replace(".", ",").replace("X", "."))
            
            return liquido
        except ValueError:
            messagebox.showerror("Erro", "Por favor, insira apenas valores numéricos válidos.")
            return None

    def save_fluxo(self):
        """Salva os dados no banco de dados."""
        mes = self.mes_ref_entry.get().strip()
        if not mes:
            messagebox.showwarning("Aviso", "Informe o mês de referência.")
            return

        liquido = self.calculate_fluxo()
        if liquido is None: return

        dados = {"mes_referencia": mes, "total_liquido": liquido}
        for k, e in self.rend_entries.items(): dados[k] = float(e.get().replace(",", "."))
        for k, e in self.desp_entries.items(): dados[k] = float(e.get().replace(",", "."))

        if database.salvar_fluxo_caixa(dados):
            messagebox.showinfo("Sucesso", f"Fechamento de {mes} salvo com sucesso!")
        else:
            messagebox.showerror("Erro", "Erro ao salvar no banco de dados.")

    def generate_fluxo_report(self):
        """Gera o relatório PDF do fluxo de caixa atual."""
        mes = self.mes_ref_entry.get().strip()
        tipo_relatorio = self.report_type_var.get()
        if not mes:
            messagebox.showwarning("Aviso", "Informe o mês de referência para o relatório.")
            return

        # Tenta buscar os dados salvos no banco de dados
        dados_salvos = database.buscar_dados_fluxo_por_mes(mes)

        if dados_salvos:
            dados_usinas, dados_despesas, total_liquido_str = dados_salvos
        else:
            # Se não encontrar no banco, avisa o usuário e oferece gerar com os dados da tela
            if messagebox.askyesno("Fechamento não encontrado", 
                                   f"Não existe um fechamento salvo para '{mes}'.\nDeseja gerar o relatório com os dados que estão atualmente na tela?"):
                liquido_val = self.calculate_fluxo()
                if liquido_val is None: return
                
                total_liquido_str = f"{liquido_val:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
                
                dados_usinas = {}
                for key, label in self.rend_fields.items():
                    val = self.rend_entries[key].get().replace(",", ".")
                    val_f = float(val) if val else 0.0
                    dados_usinas[label.replace(":", "")] = f"{val_f:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

                dados_despesas = {}
                for key, label in self.desp_fields.items():
                    val = self.desp_entries[key].get().replace(",", ".")
                    val_f = float(val) if val else 0.0
                    dados_despesas[label.replace(":", "")] = f"{val_f:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
            else:
                return

        nome_arquivo = f"Relatorio_Usinas_{mes.replace('/', '_').replace(' ', '_')}.pdf"
        
        if tipo_relatorio == "Geral":
            caminho = gerador_relatorio.gerar_pdf_mensal(mes, dados_usinas, dados_despesas, total_liquido_str, nome_arquivo)
        else:
            caminho = gerador_relatorio.gerar_pdf_socio_especifico(tipo_relatorio, mes, dados_usinas, dados_despesas, total_liquido_str)
            
        if caminho:
            webbrowser.open(f"file://{os.path.abspath(caminho)}")

    def filter_clients_gen(self):
        """Filtra a lista de clientes no gerador de documentos com base na busca."""
        search_text = self.client_search_gen_var.get().strip().lower()
        if not search_text:
            filtered = self.all_clients_gen
        else:
            filtered = [c for c in self.all_clients_gen if search_text in f"{c[1]} {c[2]}".lower()]
        self.update_client_combo(filtered)

    def update_client_combo(self, clients):
        """Atualiza os valores e dados do combobox de clientes."""
        if not clients:
            self.client_combo['values'] = []
            self.client_var.set("Nenhum cliente encontrado")
            self.client_data = {}
            return
            
        values = [f"{c[0]} - {c[1]}" for c in clients]
        self.client_combo['values'] = values
        self.client_data = {f"{c[0]} - {c[1]}": c for c in clients}
        self.client_combo.current(0)

    def generate_document(self):
        """Gera o documento selecionado."""
        client_selection = self.client_var.get()
        doc_type = self.doc_var.get()
        format_display = self.format_var.get()

        if not client_selection:
            messagebox.showerror("Erro", "Selecione um cliente!")
            return
        if not doc_type:
            messagebox.showerror("Erro", "Selecione um tipo de documento!")
            return

        client_data = self.client_data[client_selection]
        format_code = self.format_map[format_display]

        # Gerar documento
        try:
            if format_code == "word":
                caminho = documents.gerar_documento_word(client_data, doc_type)
            elif format_code == "pdf":
                caminho = documents.gerar_documento_pdf(client_data, doc_type)

            if caminho:
                database.registrar_documento_gerado(client_data[0], doc_type, format_code, caminho)
                if format_code != "pdf":
                    messagebox.showinfo("Sucesso", f"Documento gerado com sucesso!\n\nSalvo em: {caminho}")
            else:
                messagebox.showerror("Erro", f"Falha ao gerar documento em formato {format_code.upper()}!")

        except Exception as e:
            messagebox.showerror("Erro", f"Erro inesperado: {str(e)}")

    def show_history(self):
        """Módulo de Gestão de Férias (Substitui o antigo Histórico)."""
        self.clear_content()

        main_frame = ttk.Frame(self.content_frame)
        main_frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=10)
        
        ttk.Label(main_frame, text="🌴 Gestão de Férias Colaboradores", font=("Segoe UI", 18, "bold"), 
                  foreground="#f39c12").pack(pady=(0, 15))

        container = tk.Frame(main_frame, bg="white", highlightbackground="#e0e0e0", highlightthickness=1)
        container.pack(fill=tk.BOTH, expand=True)

        # --- Formulário de Cadastro ---
        form_lf = tk.LabelFrame(container, text=" Cadastrar Novas Férias ", font=("Segoe UI", 10, "bold"), bg="white")
        form_lf.pack(fill=tk.X, padx=20, pady=10)

        fields = [("Nome Colaborador:", "nome"), ("Início :", "inicio"), 
                  ("Dias Abono (Máx 10):", "abono"), ("Data Limite :", "limite")]
        self.ferias_entries = {}
        
        for i, (label, key) in enumerate(fields):
            ttk.Label(form_lf, text=label, background="white", font=("Segoe UI", 9, "bold")).grid(row=0, column=i*2, padx=(10, 2), pady=10)
            
            # Largura maior para o campo nome (35) e estilo padronizado com fundo cinza
            w = 35 if key == "nome" else 15
            entry = tk.Entry(
                form_lf, 
                font=("Segoe UI", 10), 
                width=w,
                bg="#CED1D4",
                relief="flat",
                highlightthickness=1,
                highlightbackground="#E0E0E0",
                highlightcolor=self.primary_color
            )
            entry.grid(row=0, column=i*2+1, padx=(0, 10), pady=10, ipady=3)
            self.ferias_entries[key] = entry

        btn_save = tk.Button(form_lf, text="💾 Salvar", command=self.save_vacation, bg=self.primary_color, 
                             fg="white", relief="flat", padx=10)
        btn_save.grid(row=0, column=8, padx=10)

        # --- Botões de Relatório ---
        rel_frame = ttk.Frame(container, style="White.TFrame")
        rel_frame.pack(fill=tk.X, padx=20, pady=5)

        tk.Button(rel_frame, text="📅 Previsão Próximo Mês", command=self.view_next_month_vacation, 
                  bg=self.secondary_color, fg="white", relief="flat", padx=15, pady=5).pack(side=tk.LEFT, padx=5)
        
        self.search_colab_var = tk.StringVar()
        search_entry = tk.Entry(
            rel_frame, 
            textvariable=self.search_colab_var, 
            width=30,
            bg="#CED1D4",
            relief="flat",
            highlightthickness=1,
            highlightbackground="#E0E0E0",
            highlightcolor=self.primary_color
        )
        search_entry.pack(side=tk.LEFT, padx=(20, 5), ipady=3)
        tk.Button(rel_frame, text="🔍 Buscar Histórico", command=self.view_colab_history, 
                  bg="#34495e", fg="white", relief="flat", padx=15, pady=5).pack(side=tk.LEFT)

        # --- Tabela de Exibição ---
        self.ferias_tree = ttk.Treeview(container, columns=("Nome", "Início", "Goso", "Abono", "Retorno", "Limite", "Status"), show="headings")
        for col in ("Nome", "Início", "Goso", "Abono", "Retorno", "Limite", "Status"):
            self.ferias_tree.heading(col, text=col)
            self.ferias_tree.column(col, width=100)
        self.ferias_tree.pack(fill=tk.BOTH, expand=True, padx=20, pady=10)
        
        # Verificar Alertas ao carregar
        self.check_vacation_alerts()

    def save_vacation(self):
        nome = self.ferias_entries['nome'].get().strip()
        inicio_input = self.ferias_entries['inicio'].get().strip()
        limite_input = self.ferias_entries['limite'].get().strip()
        
        try:
            abono = int(self.ferias_entries['abono'].get().strip() or 0)
            
            if abono > 10:
                messagebox.showerror("Erro", "O abono não pode ser superior a 10 dias.")
                return
            
            # Converter data de início de DD/MM/AAAA para YYYY-MM-DD para o banco de dados
            try:
                data_inicio_obj = datetime.strptime(inicio_input, "%d/%m/%Y")
                data_inicio_db = data_inicio_obj.strftime("%Y-%m-%d")
            except ValueError:
                messagebox.showerror("Erro", "Formato da Data de Início inválido. Use DD/MM/AAAA.")
                return

            # Converter data limite de DD/MM/AAAA para YYYY-MM-DD para o banco de dados, se fornecida
            data_limite_db = ""
            if limite_input:
                try:
                    data_limite_obj = datetime.strptime(limite_input, "%d/%m/%Y")
                    data_limite_db = data_limite_obj.strftime("%Y-%m-%d")
                except ValueError:
                    messagebox.showerror("Erro", "Formato da Data Limite inválido. Use DD/MM/AAAA.")
                    return
            
            if database.adicionar_ferias(nome, data_inicio_db, abono, data_limite_db):
                messagebox.showinfo("Sucesso", f"Férias de {nome} cadastradas!")
                for entry in self.ferias_entries.values():
                    entry.delete(0, tk.END) # Limpa os campos após o sucesso
                self.view_colab_history()
            else:
                messagebox.showerror("Erro", "Falha ao salvar. Verifique os dados e tente novamente.")
        except ValueError:
            messagebox.showerror("Erro", "Dias de abono deve ser um número inteiro.")
        except Exception as e:
            messagebox.showerror("Erro", f"Ocorreu um erro inesperado: {e}")

    def format_date_br(self, date_str):
        try:
            return datetime.strptime(date_str, "%Y-%m-%d").strftime("%d/%m/%Y")
        except: return date_str

    def calculate_current_status(self, data_inicio_db, data_retorno_db):
        """Calcula o status em tempo real baseado na data atual."""
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
            self.ferias_tree.insert("", "end", values=(r['nome'], self.format_date_br(r['data_inicio']), 
                                    r['dias_gozo'], r['dias_abono'], self.format_date_br(r['data_retorno']), 
                                    self.format_date_br(r['data_limite']), status))

    def view_colab_history(self):
        nome = self.search_colab_var.get().strip()
        for i in self.ferias_tree.get_children(): self.ferias_tree.delete(i)
        records = database.buscar_ferias_por_colaborador(nome)
        for r in records:
            status = self.calculate_current_status(r['data_inicio'], r['data_retorno'])
            self.ferias_tree.insert("", "end", values=(r['nome'], self.format_date_br(r['data_inicio']), 
                                    r['dias_gozo'], r['dias_abono'], self.format_date_br(r['data_retorno']), 
                                    self.format_date_br(r['data_limite']), status))

    def check_vacation_alerts(self):
        """Verifica alertas de data limite (30, 15, 10 dias)."""
        dados = database.obter_alertas_ferias()
        hoje = datetime.now()
        alertas = []
        
        for r in dados:
            try:
                dt_limite = datetime.strptime(r['data_limite'], "%Y-%m-%d")
                dias_restantes = (dt_limite - hoje).days
                
                if dias_restantes in [30, 15, 10]:
                    alertas.append(f"⚠️ {r['nome']}: Faltam {dias_restantes} dias para o limite ({self.format_date_br(r['data_limite'])}).")
                elif 0 <= dias_restantes < 10:
                    alertas.append(f"🚨 URGENTE: {r['nome']} deve sair até {self.format_date_br(r['data_limite'])}!")
            except: continue
            
        if alertas:
            messagebox.showwarning("Aviso de Prazos de Férias", "\n".join(alertas))

    def show_google_drive(self):
        """Mostra opções do Google Drive."""
        self.clear_content()

        drive_frame = ttk.Frame(self.content_frame, style="TFrame")
        drive_frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=20)

        # Título
        title_label = ttk.Label(
            drive_frame,
            text="☁️ Google Drive",
            font=("Segoe UI", 18, "bold"),
            foreground=self.primary_color
        )
        title_label.pack(pady=(0, 20))

        # Card
        card = tk.Frame(drive_frame, bg=self.card_color, relief="flat", bd=1)
        card.pack(fill=tk.BOTH, expand=True, padx=40, pady=20)
        card.configure(highlightbackground="#e0e0e0", highlightthickness=1)

        ttk.Label(
            card,
            text="Sincronizar backups com Google Drive",
            font=("Segoe UI", 14, "bold"),
            background=self.card_color
        ).pack(pady=(30, 10))

        ttk.Label(
            card,
            text="Faça backup automático dos dados dos clientes\n"
                 "na nuvem do Google Drive.",
            font=("Segoe UI", 10),
            background=self.card_color,
            justify="center"
        ).pack(pady=(0, 30))

        # Botão sincronizar
        sync_btn = tk.Button(
            card,
            text="🔄 Sincronizar Agora",
            command=self.sync_google_drive,
            font=("Segoe UI", 12, "bold"),
            bg="#e74c3c",
            fg="white",
            relief="flat",
            padx=30,
            pady=15,
            cursor="hand2"
        )
        sync_btn.pack(pady=20)

        # Hover effect
        sync_btn.bind("<Enter>", lambda e: sync_btn.configure(bg=self.adjust_color("#e74c3c", -20)))
        sync_btn.bind("<Leave>", lambda e: sync_btn.configure(bg="#e74c3c"))

        # Status
        self.status_label = ttk.Label(
            card,
            text="",
            font=("Segoe UI", 10),
            background=self.card_color
        )
        self.status_label.pack(pady=(10, 30))

    def sync_google_drive(self):
        """Sincroniza com Google Drive."""
        self.status_label.config(text="⏳ Criando backup...", foreground="#f39c12")

        try:
            import database
            backup_json = database.salvar_backup_json()
            if backup_json:
                self.status_label.config(text="⏳ Sincronizando com Google Drive...", foreground="#f39c12")
                if google_drive.sincronizar_backup_local():
                    self.status_label.config(text="✅ Sincronização concluída!", foreground=self.secondary_color)
                else:
                    self.status_label.config(text="❌ Erro na sincronização. Verifique credenciais.", foreground=self.accent_color)
            else:
                self.status_label.config(text="❌ Erro ao criar backup.", foreground=self.accent_color)
        except Exception as e:
            self.status_label.config(text=f"❌ Erro: {str(e)}", foreground=self.accent_color)

    def import_template(self):
        """Importa um modelo de documento."""
        file_path = filedialog.askopenfilename(
            title="Selecionar arquivo de modelo Word",
            filetypes=[("Arquivo Word", "*.docx"), ("Todos os arquivos", "*.*")]
        )

        if file_path:
            sucesso, resultado = documents.importar_template_arquivo(file_path)
            if sucesso:
                messagebox.showinfo("Sucesso", f"Modelo importado com sucesso!\n\n{resultado}")
            else:
                messagebox.showerror("Erro", f"Falha ao importar modelo:\n\n{resultado}")


def main():
    root = tk.Tk()
    app = AppMunaretto(root)
    root.mainloop()


if __name__ == "__main__":
    main()