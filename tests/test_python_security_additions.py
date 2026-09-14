"""Offline checks: no external requests, credential use, or executable payloads."""
import asyncio
import io
import json
import logging
from types import SimpleNamespace
import unittest
from unittest.mock import Mock
import zlib

from test_python_security_fixtures import ROOT, ORIGINAL_FAMILIES, load_app

CASES = [c for c in json.loads((ROOT/'cases.json').read_text()) if c['family'] not in ORIGINAL_FAMILIES]


class AdditionalFixtures(unittest.TestCase):
    def exercise(self, case):
        app = load_app(case['source'])
        unsafe = bool(case['expected_paths'])
        family = case['family']
        if family == 'secret_logging':
            stream = io.StringIO()
            logger = logging.Logger('fixture')
            logger.addHandler(logging.StreamHandler(stream))
            client = Mock()
            client.get.return_value = 'OK'
            self.assertEqual(app.fetch({'Authorization': 'EXAMPLE_SECRET'}, client, logger), 'OK')
            client.get.side_effect = ValueError('Authorization=EXAMPLE_SECRET')
            self.assertIsNone(app.fetch({'Authorization': 'EXAMPLE_SECRET'}, client, logger))
            self.assertEqual('EXAMPLE_SECRET' in stream.getvalue(), unsafe)
        elif family == 'redirect_credentials':
            for destination in ['https://api.example.invalid:8443/items', 'http://api.example.invalid/items']:
                client = Mock()
                client.get.side_effect = [SimpleNamespace(status_code=302, headers={'Location': destination}), 'OK']
                self.assertEqual(app.fetch('https://api.example.invalid/items', 'EXAMPLE_SECRET', client), 'OK')
                self.assertEqual(bool(client.get.call_args.kwargs['headers']), unsafe)
            client = Mock()
            client.get.side_effect = [SimpleNamespace(status_code=302, headers={'Location': '/next'}), 'OK']
            app.fetch('https://api.example.invalid/items', 'EXAMPLE_SECRET', client)
            self.assertEqual(client.get.call_args.kwargs['headers']['Authorization'], 'Bearer EXAMPLE_SECRET')
        elif family == 'tls_validation':
            client = Mock()
            client.get.return_value = 'OK'
            self.assertEqual(app.fetch('https://localhost.attacker.invalid/api', client), 'OK')
            self.assertIs(client.get.call_args.kwargs['verify'], not unsafe)
        elif family == 'template_rendering':
            baseline = 'Hello {{ name }}' if unsafe else 'summary'
            self.assertEqual(app.render(baseline, {'name': 'Ada'}), 'Hello Ada')
            if unsafe:
                self.assertEqual(app.render('{{ 7 * 7 }}', {}), '49')
            else:
                with self.assertRaises(ValueError):
                    app.render('{{ 7 * 7 }}', {})
                self.assertEqual(app.render('summary', {'name': '{{ 7 * 7 }}'}), 'Hello {{ 7 * 7 }}')
        elif family == 'compressed_attachment':
            self.assertEqual(app.unpack(zlib.compress(b'hello')), b'hello')
            data = zlib.compress(b'A' * 8192)
            self.assertLess(len(data), 4096)
            if unsafe:
                self.assertEqual(len(app.unpack(data)), 8192)
            else:
                with self.assertRaises(ValueError):
                    app.unpack(data)
                for invalid in [zlib.compress(b'hello')[:-1], zlib.compress(b'hello') + b'junk']:
                    with self.assertRaises(ValueError):
                        app.unpack(invalid)
        elif family == 'batch_jobs':
            async def check():
                active, maximum, calls = 0, 0, 0
                async def worker(item):
                    nonlocal active, maximum, calls
                    calls += 1
                    active += 1
                    maximum = max(maximum, active)
                    await asyncio.sleep(0)
                    active -= 1
                    return item
                self.assertEqual(await app.process(list(range(8)), worker), list(range(8)))
                self.assertEqual(maximum, 8 if unsafe else 2)
                calls = 0
                if unsafe:
                    await app.process(list(range(9)), worker)
                    self.assertEqual(calls, 9)
                else:
                    with self.assertRaises(ValueError):
                        await app.process(list(range(9)), worker)
                    self.assertEqual(calls, 0)
            asyncio.run(check())
        else:
            self.fail(f'Unhandled family: {family}')


for case in CASES:
    def test(self, case=case):
        self.exercise(case)
    setattr(AdditionalFixtures, 'test_' + case['id'].replace('-', '_'), test)
