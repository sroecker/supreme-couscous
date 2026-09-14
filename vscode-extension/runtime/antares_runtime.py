"""Run the installed Python CLI with cooperative cleanup of its tool subprocesses.

The pinned Antares CLI creates separate process sessions for read-only tools.
Track Popen handles inside that CLI process, so SIGTERM can clean those groups
without searching for unrelated processes by name or PID ancestry.
"""
import contextlib
import os
import runpy
import signal
import subprocess
import sys
import threading
import time


def main(argv=None):
    arguments = list(sys.argv[1:] if argv is None else argv)
    if not arguments:
        raise SystemExit('Usage: antares_runtime.py /absolute/path/to/antares [arguments...]')
    executable = arguments[0]
    if not os.path.isabs(executable):
        raise SystemExit('Antares executable must be an absolute path')
    original_popen = subprocess.Popen
    processes = []
    lock = threading.RLock()
    stopping = False

    def send(process, grouped, sig, force_group=False):
        if not force_group and process.poll() is not None:
            return
        with contextlib.suppress(ProcessLookupError):
            if grouped and os.name == 'posix':
                os.killpg(process.pid, sig)
            else:
                process.send_signal(sig)

    class OwnedProcess(original_popen):
        def __init__(self, *args, **kwargs):
            with lock:
                if stopping:
                    raise RuntimeError('Antares is stopping; no new tools can start')
                super().__init__(*args, **kwargs)
                grouped = bool(kwargs.get('start_new_session'))
                processes.append((self, grouped))
                # A signal can interrupt a main-thread Popen before registration.
                if stopping:
                    send(self, grouped, signal.SIGKILL)

    def cleanup():
        nonlocal stopping
        with lock:
            stopping = True
            owned = list(processes)
        active = [(p, grouped) for p, grouped in owned if p.poll() is None]
        for process, grouped in active:
            send(process, grouped, signal.SIGTERM)
        deadline = time.monotonic() + 0.3
        for process, _ in active:
            with contextlib.suppress(subprocess.TimeoutExpired):
                process.wait(timeout=max(0, deadline - time.monotonic()))
        if active:
            time.sleep(max(0, deadline - time.monotonic()))
        for process, grouped in active:
            send(process, grouped, signal.SIGKILL, force_group=grouped)
        for process, _ in active:
            with contextlib.suppress(subprocess.TimeoutExpired):
                process.wait(timeout=0.2)

    def terminate(signum, _frame):
        cleanup()
        raise SystemExit(128 + signum)

    subprocess.Popen = OwnedProcess
    previous_handlers = {sig: signal.signal(sig, terminate) for sig in (signal.SIGTERM, signal.SIGINT)}
    sys.argv = arguments
    try:
        runpy.run_path(executable, run_name='__main__')
    finally:
        cleanup()
        subprocess.Popen = original_popen
        for sig, handler in previous_handlers.items():
            signal.signal(sig, handler)


if __name__ == '__main__':
    main()
