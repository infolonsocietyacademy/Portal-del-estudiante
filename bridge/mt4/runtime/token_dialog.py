"""Local masked token entry. Never writes or logs the plaintext token."""


class TokenInputError(Exception):
    pass


def normalize_token(value):
    if not isinstance(value, str):
        raise TokenInputError("TOKEN_INVALIDO")
    token = value.strip()
    if not token:
        raise TokenInputError("PEGA_EL_TOKEN_PRIMERO")
    if not 20 <= len(token) <= 512 or any(not 33 <= ord(c) <= 126 for c in token):
        raise TokenInputError("TOKEN_INVALIDO_COPIA_SOLO_EL_TOKEN")
    return token


class TokenDialog:
    def __init__(self, root, tk, ttk, title):
        self.root = root
        self.result = None
        root.title(title)
        root.geometry("620x330")
        root.minsize(520, 300)
        root.configure(background="#101722")
        style = ttk.Style(root)
        style.theme_use("clam")
        style.configure("Bridge.TFrame", background="#101722")
        style.configure("Bridge.TLabel", background="#101722", foreground="#e7edf6", font=("Segoe UI", 11))
        style.configure("Title.Bridge.TLabel", font=("Segoe UI", 17, "bold"))
        style.configure("Hint.Bridge.TLabel", foreground="#aab8ca", background="#101722", font=("Segoe UI", 10))
        style.configure("Bridge.TButton", font=("Segoe UI", 11), padding=(14, 9))
        box = ttk.Frame(root, padding=24, style="Bridge.TFrame")
        box.pack(fill="both", expand=True)
        ttk.Label(box, text="Conectar OLFX MT5 BRIDGE", style="Title.Bridge.TLabel").pack(anchor="w")
        ttk.Label(box, text="Pega tu token de GitHub en esta ventana.", style="Bridge.TLabel").pack(anchor="w", pady=(16, 3))
        ttk.Label(box, text="Veras asteriscos al escribir. El token se queda en esta VPS.", style="Hint.Bridge.TLabel").pack(anchor="w", pady=(0, 12))
        self.entry = tk.Entry(box, show="*", font=("Consolas", 13), relief="flat", bg="#202e41", fg="white", insertbackground="white", borderwidth=10)
        self.entry.pack(fill="x", ipady=4)
        self.status = tk.StringVar(value="Puedes escribir, usar Ctrl+V o pulsar Pegar.")
        ttk.Label(box, textvariable=self.status, wraplength=550, style="Hint.Bridge.TLabel").pack(anchor="w", pady=(10, 14))
        buttons = ttk.Frame(box, style="Bridge.TFrame")
        buttons.pack(fill="x")
        self.paste_button = ttk.Button(buttons, text="Pegar", style="Bridge.TButton", command=self.paste)
        self.paste_button.pack(side="left")
        self.accept_button = ttk.Button(buttons, text="Continuar", style="Bridge.TButton", command=self.accept)
        self.accept_button.pack(side="right")
        ttk.Button(buttons, text="Cancelar", style="Bridge.TButton", command=self.cancel).pack(side="right", padx=8)
        root.protocol("WM_DELETE_WINDOW", self.cancel)
        root.bind("<Return>", lambda event: self.accept())
        root.bind("<Escape>", lambda event: self.cancel())
        root.after(100, self.entry.focus_force)

    def paste(self):
        try:
            value = normalize_token(self.root.clipboard_get())
        except Exception:
            self.status.set("Copia el token desde el navegador de la VPS y vuelve a pulsar Pegar.")
            self.entry.focus_set()
            return
        self.entry.delete(0, "end")
        self.entry.insert(0, value)
        self.status.set("Token pegado. Pulsa Continuar.")
        self.entry.focus_set()

    def accept(self):
        try:
            value = normalize_token(self.entry.get())
        except TokenInputError:
            self.status.set("Pega el token completo, sin texto adicional, y pulsa Continuar.")
            self.entry.focus_set()
            return
        self.result = value
        self.entry.delete(0, "end")
        self.root.destroy()

    def cancel(self):
        self.result = None
        self.entry.delete(0, "end")
        self.root.destroy()


def ask_token(title="OLFX MT5 BRIDGE - Configuracion"):
    try:
        import tkinter as tk
        from tkinter import ttk
        root = tk.Tk()
    except Exception:
        raise TokenInputError("VENTANA_NO_DISPONIBLE_INSTALA_COMPONENTE_TCL_TK_DE_PYTHON") from None
    dialog = TokenDialog(root, tk, ttk, title)
    root.mainloop()
    if dialog.result is None:
        raise TokenInputError("CONFIGURACION_CANCELADA")
    return dialog.result

