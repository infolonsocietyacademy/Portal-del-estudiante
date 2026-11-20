"""Lanzador visible para Windows. No utiliza archivos CMD ni BAT."""
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

def start():
    code = 1
    try:
        print("OLFX LAB - VERSION PYTHON PARA WINDOWS", flush=True)
        from bootstrap import main
        code = main()
    except (KeyboardInterrupt, EOFError):
        print("\nProceso detenido.")
    except Exception:
        detail = traceback.format_exc()
        print(detail)
        (ROOT / "error_arranque.txt").write_text(detail, encoding="utf-8")
        print("Detalle guardado en error_arranque.txt")
    finally:
        try:
            input("\nPresiona ENTER para cerrar esta ventana...")
        except (KeyboardInterrupt, EOFError):
            pass
    return code

if __name__ == "__main__":
    sys.exit(start())
