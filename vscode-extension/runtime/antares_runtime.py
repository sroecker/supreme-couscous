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


def exited_without_reaping(pid):
    """Use Darwin libc on Python builds that do not expose os.waitid."""
    options = os.WEXITED | os.WNOHANG | os.WNOWAIT
    if hasattr(os, 'waitid'):
        return os.waitid(os.P_PID, pid, options) is not None
    if sys.platform != 'darwin':
        raise RuntimeError('Tool cleanup requires waitid with WNOWAIT')
    import ctypes
    import errno

    # Darwin sys/signal.h: six int fields, then pointer-sized fields and padding.
    class SigInfo(ctypes.Structure):
        _fields_ = [('signo', ctypes.c_int), ('error', ctypes.c_int),
                    ('code', ctypes.c_int), ('pid', ctypes.c_int),
                    ('uid', ctypes.c_uint), ('status', ctypes.c_int),
                    ('address', ctypes.c_void_p), ('value', ctypes.c_void_p),
                    ('band', ctypes.c_long), ('pad', ctypes.c_ulong * 7)]

    libc = ctypes.CDLL(None, use_errno=True)
    waitid = libc.waitid
    waitid.argtypes = [ctypes.c_int, ctypes.c_uint, ctypes.POINTER(SigInfo), ctypes.c_int]
    waitid.restype = ctypes.c_int
    info = SigInfo()
    if waitid(os.P_PID, pid, ctypes.byref(info), options) != 0:
        error = ctypes.get_errno()
        if error == errno.ECHILD:
            raise ChildProcessError(error, os.strerror(error))
        if error == errno.EINTR:
            return False
        raise OSError(error, os.strerror(error))
    return info.pid == pid


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
    creating_on_main = False
    pending_signal = None

    def send(process, grouped, sig):
        if process.poll() is not None:
            return
        with contextlib.suppress(ProcessLookupError):
            if grouped and os.name == 'posix':
                os.killpg(process.pid, sig)
            else:
                process.send_signal(sig)

    class OwnedProcess(original_popen):
        # Inspect exit without reaping. Until waitpid releases this PID, its process
        # group cannot be confused with a subsequently reused group identifier.
        def _internal_poll(self, *args, **kwargs):
            if not getattr(self, '_owned_group', False):
                return super()._internal_poll(*args, **kwargs)
            if self.returncode is not None or not self._waitpid_lock.acquire(False):
                return self.returncode
            try:
                if exited_without_reaping(self.pid):
                    try:
                        os.killpg(self.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    except PermissionError:
                        # Darwin returns EPERM when only zombies remain in the
                        # group (no live member eligible to receive the signal).
                        if sys.platform != 'darwin':
                            raise
                    pid, status = os.waitpid(self.pid, os.WNOHANG)
                    if pid == self.pid:
                        self._handle_exitstatus(status)
                # Do not delegate to Popen here: the leader could exit between
                # waitid and its waitpid, bypassing the pre-reap group cleanup.
            except ChildProcessError:
                self.returncode = 0
            finally:
                self._waitpid_lock.release()
            return self.returncode

        def _wait(self, timeout):
            if not getattr(self, '_owned_group', False):
                return super()._wait(timeout)
            deadline = None if timeout is None else time.monotonic() + timeout
            while self.poll() is None:
                remaining = None if deadline is None else deadline - time.monotonic()
                if remaining is not None and remaining <= 0:
                    raise subprocess.TimeoutExpired(self.args, timeout)
                time.sleep(0.01 if remaining is None else min(0.01, remaining))
            return self.returncode

        def __init__(self, *args, **kwargs):
            nonlocal creating_on_main
            on_main = threading.current_thread() is threading.main_thread()
            if on_main:
                creating_on_main = True
            try:
                with lock:
                    if stopping:
                        raise RuntimeError('Antares is stopping; no new tools can start')
                    try:
                        super().__init__(*args, **kwargs)
                    finally:
                        if getattr(self, '_child_created', False):
                            grouped = bool(kwargs.get('start_new_session'))
                            self._owned_group = grouped and os.name == 'posix'
                            processes.append((self, grouped))
            finally:
                if on_main:
                    creating_on_main = False
                    if pending_signal is not None:
                        terminate(pending_signal, None)

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
            send(process, grouped, signal.SIGKILL)
        for process, _ in active:
            with contextlib.suppress(subprocess.TimeoutExpired):
                process.wait(timeout=0.2)

    def terminate(signum, _frame):
        nonlocal pending_signal, stopping
        if creating_on_main:
            # Do not raise through Popen before its child is registered. Keep
            # signal masks unchanged so the new tool can still receive SIGTERM.
            pending_signal = signum
            stopping = True
            return
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
