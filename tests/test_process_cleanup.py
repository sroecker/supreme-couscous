"""Exercise actual processes, including a tool in its own POSIX session."""
import importlib.util
import os
from pathlib import Path
import signal
import select
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('scan', ROOT / 'scripts/scan_oauth_examples.py')
scan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scan)
RUNTIME = ROOT / 'vscode-extension/runtime/antares_runtime.py'


class ProcessCleanupTests(unittest.TestCase):
    def test_runner_timeout_reaps_separate_session_tool(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            pid_file = root / 'tool.pid'
            cli = root / 'cli.py'
            cli.write_text("import subprocess,sys,time\np=subprocess.Popen([sys.executable,'-c','import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(60)'], start_new_session=True)\nopen(sys.argv[1],'w').write(str(p.pid))\ntime.sleep(60)\n")
            independent = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
            pid = None
            try:
                with self.assertRaises(subprocess.TimeoutExpired):
                    scan.run_bounded([sys.executable, str(RUNTIME), str(cli), str(pid_file)], timeout=0.7, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                pid = int(pid_file.read_text())
                with self.assertRaises(ProcessLookupError):
                    os.kill(pid, 0)
                self.assertIsNone(independent.poll())
            finally:
                independent.kill()
                independent.wait()
                if pid is not None:
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass

    def test_exited_leader_cannot_leave_descendants(self):
        for ending in ('normal', 'cancel'):
            with self.subTest(ending=ending), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                pid_file = root / 'child.pid'
                cli = root / 'cli.py'
                tool = "import subprocess,sys; p=subprocess.Popen([sys.executable,'-c','import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(60)']); open(sys.argv[1],'w').write(str(p.pid))"
                cli.write_text("import subprocess,sys,time\np=subprocess.Popen([sys.executable,'-c'," + repr(tool) + "," + repr(str(pid_file)) + "],start_new_session=True)\np.wait()\nprint('ready',flush=True)\n" + ("time.sleep(60)\n" if ending == 'cancel' else ""))
                parent = subprocess.Popen([sys.executable, str(RUNTIME), str(cli)], stdout=subprocess.PIPE, text=True)
                child = None
                try:
                    self.assertTrue(select.select([parent.stdout], [], [], 5)[0], 'CLI did not become ready')
                    self.assertEqual(parent.stdout.readline().strip(), 'ready')
                    child = int(pid_file.read_text())
                    if ending == 'cancel':
                        parent.terminate()
                    parent.wait(timeout=5)
                    with self.assertRaises(ProcessLookupError):
                        os.kill(child, 0)
                finally:
                    parent.stdout.close()
                    if parent.poll() is None:
                        parent.kill()
                        parent.wait()
                    if child is None and pid_file.exists():
                        child = int(pid_file.read_text())
                    if child is not None:
                        try:
                            os.kill(child, signal.SIGKILL)
                        except ProcessLookupError:
                            pass

    def test_native_tools_preserve_output_and_exit_status(self):
        with tempfile.TemporaryDirectory() as temporary:
            cli = Path(temporary) / 'cli.py'
            cli.write_text("import subprocess\nfor command in (['/bin/echo','native output'],['/usr/bin/false']):\n p=subprocess.run(command,start_new_session=True,capture_output=True,text=True)\n print(p.returncode,repr(p.stdout))\n")
            result = subprocess.run([sys.executable, str(RUNTIME), str(cli)], capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("0 'native output\\n'", result.stdout)
            self.assertIn("1 ''", result.stdout)

    def test_runtime_preserves_json_stdout_and_exit_code(self):
        with tempfile.TemporaryDirectory() as temporary:
            cli = Path(temporary) / 'cli.py'
            cli.write_text('import sys\nprint(sys.stdin.read())\nsys.exit(2)\n')
            result = subprocess.run([sys.executable, str(RUNTIME), str(cli)], input='{"partial":true}', text=True, capture_output=True)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stdout.strip(), '{"partial":true}')


if __name__ == '__main__':
    unittest.main()
