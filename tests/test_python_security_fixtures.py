"""Offline behavioral ground truth; never included in a scanned fixture."""
import importlib.util
import json
from pathlib import Path
import pickle
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1] / 'examples/python-security'
CASES = json.loads((ROOT/'cases.json').read_text())


def load_app(source):
    directory = ROOT/source
    previous = sys.modules.pop('policy', None)
    sys.path.insert(0, str(directory))
    try:
        spec = importlib.util.spec_from_file_location('fixture_app', directory/'app.py')
        app = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(app)
        return app
    finally:
        sys.path.pop(0)
        sys.modules.pop('policy', None)
        if previous is not None:
            sys.modules['policy'] = previous


class Response:
    def __init__(self, text, status=200):
        self.text, self.status_code = text, status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise ValueError('HTTP error')


class Client:
    """No sockets: model one redirect from a trusted URL to an internal URL."""
    def __init__(self, redirect=False):
        self.redirect, self.calls = redirect, []

    def get(self, url, *, follow_redirects, timeout):
        self.calls.append(url)
        if self.redirect and url == 'https://docs.example.invalid/guide':
            if not follow_redirects:
                return Response('', 302)
            self.calls.append('http://127.0.0.1/private')
            return Response('INTERNAL')
        return Response('INTERNAL' if '127.0.0.1' in url else 'GUIDE')


class Reduction:
    def __reduce__(self):
        # Harmless callable invocation proves the executable pickle semantics.
        return str, ('REDUCTION_EXECUTED',)


class PythonSecurityFixtures(unittest.TestCase):
    def exercise(self, case):
        app = load_app(case['source'])
        unsafe = bool(case['expected_paths'])
        family = case['family']
        if family == 'file_download':
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)/'storage';root.mkdir()
                sibling = Path(tmp)/'storage_backup';sibling.mkdir()
                (root/'guide.txt').write_text('GUIDE');(sibling/'secret.txt').write_text('SECRET')
                (root/'link.txt').symlink_to(sibling/'secret.txt')
                self.assertEqual(app.download(root,'guide.txt'),'GUIDE')
                for name in ['../storage_backup/secret.txt','link.txt']:
                    if unsafe:
                        self.assertEqual(app.download(root,name),'SECRET')
                    else:
                        with self.assertRaises(ValueError):app.download(root,name)
        elif family == 'command_report':
            with patch.object(app.subprocess,'run',return_value=SimpleNamespace(stdout='12 report.txt')) as run:
                self.assertEqual(app.report_size('report.txt'),'12 report.txt')
                run.reset_mock()
                value='report.txt$(echo MARKER)'
                if unsafe:
                    app.report_size(value)
                    self.assertTrue(run.call_args.kwargs['shell'])
                    self.assertIn('$(echo MARKER)',run.call_args.args[0])
                else:
                    for bad in [value,'--help','../report.txt']:
                        with self.assertRaises(ValueError):app.report_size(bad)
                    run.assert_not_called()
                    app.report_size('report.txt')
                    self.assertFalse(run.call_args.kwargs['shell'])
                    self.assertEqual(run.call_args.args[0],['wc','-c','--','report.txt'])
        elif family == 'url_preview':
            url='https://docs.example.invalid/guide'
            self.assertEqual(app.preview(url,Client()),'GUIDE')
            client=Client(redirect=True)
            if unsafe:
                self.assertEqual(app.preview(url,client),'INTERNAL')
                self.assertIn('http://127.0.0.1/private',client.calls)
            else:
                with self.assertRaises(ValueError):app.preview(url,client)
                self.assertEqual(client.calls,[url])
                client=Client()
                with self.assertRaises(ValueError):app.preview('http://127.0.0.1/private',client)
                self.assertEqual(client.calls,[])
        elif family == 'job_config':
            config={'report':'daily','copies':2}
            baseline=pickle.dumps(config) if unsafe else json.dumps(config).encode()
            self.assertEqual(app.load_configuration(baseline),config)
            payload=pickle.dumps(Reduction())
            if unsafe:
                self.assertEqual(app.load_configuration(payload),'REDUCTION_EXECUTED')
            else:
                with self.assertRaises((ValueError,UnicodeError)):app.load_configuration(payload)
                with self.assertRaises(ValueError):app.load_configuration(b'{"report":"daily","copies":true}')
        elif family == 'tenant_invoice':
            user={'tenant_id':'a','user_id':'alice'}
            invoices={'one':{'tenant_id':'a','total':10},'two':{'tenant_id':'b','total':20}}
            self.assertEqual(app.invoice_detail('one',user,invoices),invoices['one'])
            if unsafe:
                self.assertEqual(app.invoice_detail('two',user,invoices),invoices['two'])
            else:
                with self.assertRaises(PermissionError):app.invoice_detail('two',user,invoices)
                with self.assertRaises(PermissionError):app.invoice_detail('one',None,invoices)
        elif family == 'html_report':
            self.assertIn('<h1>Daily report</h1>',app.render_report('Daily report'))
            payload='<img src=x onerror="marker()">'
            output=app.render_report(payload)
            if unsafe:
                self.assertIn(payload,output)
            else:
                self.assertNotIn('<img',output)
                self.assertIn('&lt;img',output)
        else:
            self.fail(f'Unknown family {family}')


for case in CASES:
    def test(self, case=case):self.exercise(case)
    setattr(PythonSecurityFixtures,'test_'+case['id'].replace('-','_'),test)

if __name__ == '__main__':
    unittest.main()
