"""Consola sencilla; conserva intacto el motor y sus reglas de validacion."""
import contextlib
from datetime import datetime, timezone
import math
from pathlib import Path
import sys
import traceback

import lab

ROOT = Path(__file__).resolve().parent


def number(label, default=None):
    while True:
        hint = '' if default is None else f' [{default:g}]'
        value = input(label + hint + ': ').strip().replace(',', '.')
        if not value and default is not None:
            return default
        try:
            result = float(value)
            if not math.isfinite(result) or result < 0:
                raise ValueError
            return result
        except ValueError:
            print('Escribe un numero igual o mayor que 0.')


def configure():
    path = ROOT / 'config.json'
    c = {**lab.DEFAULT, **lab.read(path)} if path.exists() else lab.DEFAULT.copy()
    c['symbol'] = input(f"Activo [{c['symbol']}]: ").strip() or c['symbol']
    frames=input('Temporalidades a probar separadas por comas [1,3,5,15]: ').strip()
    if frames:
        c['frames_minutes']=[int(x.strip()) for x in frames.split(',')]
    print('SL: pivotes confirmados de 2/3 velas, margen ATR 0.20/0.30; salidas TP1, TP2 y parcial 50/50.')
    mt = None
    try:
        mt, symbol, info, _ = lab.connect(c)
        tick = mt.symbol_info_tick(symbol)
        if tick is None or tick.ask <= tick.bid or tick.bid <= 0:
            raise ValueError('No hay un precio con spread positivo. Prueba con el mercado abierto.')
        timestamp = tick.time_msc / 1000
        age = datetime.now(timezone.utc).timestamp() - timestamp
        if not -5 <= age <= 60:
            raise ValueError('MT5 no tiene un precio reciente con hora UTC. Revisa conexion y horario.')
        spread_price = tick.ask - tick.bid
        print(f'Activo encontrado: {symbol}. Spread actual en precio: {spread_price:g}.')
        print('Solo necesitas indicar los costos. No se adivina la comision.')
        c['commission_roundtrip_per_lot'] = number('Comision TOTAL de compra y cierre por 1 lote, en USD (0 si es cero)', c['commission_roundtrip_per_lot'])
        previous = c['slippage_points_per_side']
        default_slip = previous * info['point'] if previous is not None else None
        slip = number('Slippage estimado por lado, en unidades de PRECIO (0 si asumes cero)', default_slip)
        c['slippage_points_per_side'] = slip / info['point']
        previous = c['max_spread_points']
        default_max = previous * info['point'] if previous is not None else round(spread_price * 3, 10)
        max_spread = number('Spread maximo permitido, en unidades de PRECIO', default_max)
        if max_spread <= 0:
            raise ValueError('El spread maximo debe ser mayor que cero.')
        c['max_spread_points'] = max_spread / info['point']
        print('Horario: rango 10:30-10:45 de Nueva York. El historial debe tener timestamps UTC.')
        c['time_confirmed'] = input('Confirmas ese horario con tu historial? [s/n]: ').strip().lower() in ('s','si','sí')
        if not c['time_confirmed']:
            print('Configuracion cancelada. No se inicia la prueba.')
            return False
        lab.save(path, c)
        lab.config()
        print('Listo. Costos guardados para las proximas pruebas.')
        return True
    finally:
        if mt is not None:
            mt.shutdown()


def configured():
    try:
        lab.config()
        return True
    except (ValueError, OSError):
        return False


class Progress:
    """Detalles al registro; solamente progreso util en pantalla."""
    def __init__(self, log, console):
        self.log, self.console, self.buffer = log, console, ''

    def write(self, value):
        self.log.write(value)
        self.log.flush()
        self.buffer += value
        while '\n' in self.buffer:
            line, self.buffer = self.buffer.split('\n', 1)
            if line.startswith('FASE 1'):
                self.console.write('\n1/2 Buscando la mejor configuracion...\n')
            elif line.startswith('FASE 2'):
                self.console.write('\n2/2 Validando con datos separados...\n')
            elif len(line) > 10 and line[0:4].isdigit() and line[4] == '-':
                self.console.write('\rProcesando ' + line[:10] + '...          ')
            self.console.flush()
        return len(value)

    def flush(self):
        self.log.flush()
        self.console.flush()


def show_metrics(m):
    print(f"Operaciones cerradas: {m['trades']} | WinRate neto: {m['winrate']:.1%}")
    print(f"Resultado neto: ${m['net']:.2f} | Drawdown: {m['max_drawdown_pct']:.2f}%")


def show_result():
    try:
        folder = lab.latest()
    except ValueError:
        print('Todavia no hay resultados. Usa la opcion 1.')
        return
    result = lab.read(folder / 'estado.json')
    labels = {
        'RECHAZADA_ENTRENAMIENTO': 'NO PASO EL ENTRENAMIENTO',
        'RECHAZADA_VALIDACION': 'NO PASO LA VALIDACION',
        'LISTA_PARA_DEMO': 'VALIDACION APROBADA. Puedes iniciar demo con 2.',
        'INCOMPLETO': 'PRUEBA INCOMPLETA. No esta aprobada.',
    }
    print('\n' + labels.get(result['status'], result['status']))
    if 'validation' in result:
        show_metrics(result['validation'])
    if result.get('error'):
        print('Motivo:', result['error'])
    if (folder / 'optimizacion.json').exists() and result['status'] == 'RECHAZADA_ENTRENAMIENTO':
        print('Ninguna configuracion cumplio todos los requisitos. No se fuerza el 75%.')
    windows = result.get('windows_14_30_60_90', {})
    if windows:
        print('\nDias   Trades   WinRate neto   Neto USD')
        for days, m in windows.items():
            print(f"{days:>4}   {m['trades']:>6}   {m['winrate']:>11.1%}   {m['net']:>8.2f}")
    if (folder / 'resultado_demo.json').exists():
        demo = lab.read(folder / 'resultado_demo.json')
        print('\nDemo:', 'APROBADA EN SIMULACION' if demo['status'] == 'APROBADA_EN_SIMULACION' else 'PENDIENTE')
        show_metrics(demo['metrics'])
        if demo.get('compromised_campaign'):
            print('Hubo interrupciones. La campana requiere revision y no puede aprobarse.')
    print('Archivos:', folder)


def run_test():
    if not configured():
        if not configure():
            return
    c = lab.config()
    print(f"\n{c['symbol']} | Rango NY 10:30-10:45 | BUY/SELL | SL estructura | TP1 1R / TP2 2R")
    print(f"Entrenamiento {c['train_days']} dias + validacion {c['validation_days']} dias.")
    print('Reportes de 14, 30, 60 y 90 dias. Iniciando...')
    logs = ROOT / 'registros'
    logs.mkdir(exist_ok=True)
    path = logs / (datetime.now().strftime('%Y%m%d_%H%M%S') + '.txt')
    try:
        with path.open('w', encoding='utf-8') as log:
            with contextlib.redirect_stdout(Progress(log, sys.stdout)):
                lab.experiment()
    finally:
        print('\nRegistro:', path)
    show_result()


def main():
    (ROOT / 'experimentos').mkdir(exist_ok=True)
    if '--run' in sys.argv:
        run_test()
        return
    if '--demo' in sys.argv:
        lab.demo()
        return
    while True:
        print('\nOLFX LAB\n1  Probar estrategia\n2  Iniciar demo (sin enviar ordenes)\n3  Ver resultados\nC  Cambiar activo o costos\n0  Salir')
        try:
            choice = input('Elige: ').strip().lower()
            if choice == '0':
                return
            if choice == '1':
                run_test()
            elif choice == '2':
                print('Deja la consola y MT5 abiertos. La demo usa precios en vivo.')
                lab.demo()
            elif choice == '3':
                show_result()
            elif choice == 'c':
                configure()
            else:
                print('Escribe 1, 2, 3, C o 0.')
        except (KeyboardInterrupt, EOFError):
            print('\nDetenido. Tus resultados siguen guardados.')
            return
        except Exception as error:
            logs = ROOT / 'registros'
            logs.mkdir(exist_ok=True)
            (logs / 'ultimo_error.txt').write_text(traceback.format_exc(), encoding='utf-8')
            print('\nNo se completo:', error)
            print('Detalle guardado en registros/ultimo_error.txt.')


def start():
    lock = (ROOT / 'instancia.lock').open('a+b')
    lock.write(b'0')
    lock.flush()
    lock.seek(0)
    try:
        if sys.platform == 'win32':
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        main()
    finally:
        lock.close()


if __name__ == '__main__':
    start()
