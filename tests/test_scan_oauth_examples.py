import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('scan', Path(__file__).resolve().parents[1] / 'scripts/scan_oauth_examples.py')
scan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scan)

class EvaluationTests(unittest.TestCase):
    def test_bad_reports_do_not_prevent_later_cases(self):
        valid = {'metadata': {'model': 'antares-350m'}, 'summary': {'generation_errors': 0, 'failed_workers': 0}, 'findings': []}
        with tempfile.TemporaryDirectory() as temporary:
            for index, content in enumerate([None, '{', '[]', '{}', json.dumps(valid)]):
                destination = Path(temporary) / str(index)
                def runner(*args, **kwargs):
                    if content is not None:
                        (destination / 'report.json').write_text(content)
                    return subprocess.CompletedProcess(args, 0)
                row = scan.evaluate_case({'id':'audience', 'cwe':'CWE-287'}, 'fixed', destination, 1, runner=runner)
                self.assertEqual(row['complete'], index == 4)
                self.assertEqual(row['matches_expected'], True if index == 4 else None)

    def test_timeout_with_truncated_report_is_recorded(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / 'case'
            def runner(*args, **kwargs):
                (destination / 'report.json').write_text('{')
                raise subprocess.TimeoutExpired(args, 1)
            row = scan.evaluate_case({'id':'audience', 'cwe':'CWE-287'}, 'fixed', destination, 1, runner=runner)
            self.assertTrue(row['timed_out'])
            self.assertFalse(row['complete'])

    def test_exit_semantics_and_incomplete_not_scored(self):
        match = {'complete':True, 'matches_expected':True, 'false_positive_paths':[], 'missed_paths':[], 'duration_seconds':1}
        mismatch = {**match, 'matches_expected':False, 'false_positive_paths':['server.py']}
        incomplete = {**match, 'complete':False, 'matches_expected':None, 'false_positive_paths':None, 'missed_paths':None}
        self.assertEqual(scan.result_exit([mismatch]), 0)
        self.assertEqual(scan.result_exit([mismatch], True), 1)
        self.assertEqual(scan.result_exit([mismatch, incomplete], True), 2)
        self.assertEqual(scan.result_exit([match], True), 0)
        self.assertEqual(scan.aggregate([match, mismatch, incomplete])['false_positive_paths'], 1)

    def test_atomic_summary_and_finite_timeout(self):
        with tempfile.TemporaryDirectory() as temporary:
            output=Path(temporary)/'summary.json'
            scan.atomic_json(output, [1]);scan.atomic_json(output, [2])
            self.assertEqual(json.loads(output.read_text()), [2])
            self.assertEqual(len(list(Path(temporary).iterdir())), 1)
            with self.assertRaises(SystemExit) as error:
                scan.main(['--output', str(Path(temporary)/'new'), '--timeout', 'nan'])
            self.assertEqual(error.exception.code, 2)


class LauncherTests(unittest.TestCase):
    def test_missing_setup_has_actionable_errors(self):
        import shutil
        import sys
        with tempfile.TemporaryDirectory(prefix='antares preflight ') as temporary:
            root = Path(temporary)
            (root/'scripts').mkdir()
            for filename in ['antares.sh','serve.sh','model_profile.sh']:
                shutil.copy(scan.ROOT/'scripts'/filename, root/'scripts'/filename)
            def check(fragment):
                result = subprocess.run(['bash', str(root/'scripts/antares.sh')], capture_output=True, text=True)
                self.assertEqual(result.returncode, 2)
                self.assertIn(fragment, result.stderr)
                self.assertNotIn('Traceback', result.stderr)
            check('virtual environment')
            (root/'.venv/bin').mkdir(parents=True)
            (root/'.venv/bin/python').symlink_to(sys.executable)
            check('Missing model profiles')
            (root/'vscode-extension/src').mkdir(parents=True)
            shutil.copy(scan.ROOT/'vscode-extension/src/model-profiles.json',root/'vscode-extension/src/model-profiles.json')
            check('Antares CLI missing')
            (root/'.venv/bin/antares').write_text('')
            (root/'.venv/bin/antares').chmod(0o755)
            check('Missing Antares runtime')

    def test_shared_defaults_and_explicit_overrides(self):
        import shutil
        import sys
        with tempfile.TemporaryDirectory(prefix='antares launcher ') as temporary:
            root=Path(temporary)
            for directory in ['scripts','.venv/bin','build/llama.cpp/bin','models','vscode-extension/src','vscode-extension/runtime']:
                (root/directory).mkdir(parents=True)
            for filename in ['serve.sh','antares.sh','model_profile.sh']:
                shutil.copy(scan.ROOT/'scripts'/filename,root/'scripts'/filename)
            shutil.copy(scan.ROOT/'vscode-extension/src/model-profiles.json',root/'vscode-extension/src/model-profiles.json')
            shutil.copy(scan.ROOT/'vscode-extension/runtime/antares_runtime.py',root/'vscode-extension/runtime/antares_runtime.py')
            (root/'.venv/bin/python').symlink_to(sys.executable)
            for model in ['antares-350m','antares-1b']:
                (root/f'models/{model}-bf16.gguf').touch()
            server=root/'build/llama.cpp/bin/llama-server'
            server.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n');server.chmod(0o755)
            cli=root/'.venv/bin/antares'
            cli.write_text('import os\nprint(os.environ["ANTARES_MODEL"])\nprint(os.environ["ANTARES_ENDPOINT"])\n');cli.chmod(0o755)
            env={'PATH':'/usr/bin:/bin','ANTARES_MODEL':'antares-350m'}
            result=subprocess.run(['bash',str(root/'scripts/serve.sh')],env=env,capture_output=True,text=True,check=True)
            args=result.stdout.splitlines();self.assertEqual(args[args.index('--port')+1],'8086')
            result=subprocess.run(['bash',str(root/'scripts/antares.sh')],env=env,capture_output=True,text=True,check=True)
            self.assertIn('127.0.0.1:8086',result.stdout)
            env['ANTARES_PORT']='8090';env['ANTARES_ENDPOINT']='http://127.0.0.1:8091/v1/completions'
            result=subprocess.run(['bash',str(root/'scripts/antares.sh')],env=env,capture_output=True,text=True,check=True)
            self.assertIn(':8091/',result.stdout)
            result=subprocess.run(['bash',str(root/'scripts/serve.sh')],env=env,capture_output=True,text=True,check=True)
            args=result.stdout.splitlines();self.assertEqual(args[args.index('--port')+1],'8090')
            env['ANTARES_MODEL']='invalid'
            self.assertNotEqual(subprocess.run(['bash',str(root/'scripts/serve.sh')],env=env,capture_output=True).returncode,0)

if __name__ == '__main__':
    unittest.main()
