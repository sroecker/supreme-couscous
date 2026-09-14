import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from scan_python_examples import FIXTURES, score, stage_source, confusion_matrix


class EvaluationTests(unittest.TestCase):
    def report(self, findings=None):
        return {'metadata': {'model': 'antares-1b'}, 'summary': {'generation_errors': 0, 'failed_workers': 0},
                'findings': findings or [], 'warnings': []}

    def test_incomplete_is_not_a_negative(self):
        report = self.report()
        report['warnings'] = ['Worker interrupted']
        result = score(report, ['app.py'], 'CWE-22', 'antares-1b', 0, None)
        self.assertFalse(result['complete'])
        self.assertIsNone(result['missed_paths'])
        self.assertIsNone(result['matches_expected'])

    def test_model_mismatch_is_incomplete(self):
        self.assertFalse(score(self.report(), [], 'CWE-22', 'antares-350m', 0, None)['complete'])

    def test_cwe_and_path_both_must_match(self):
        report = self.report([{'file_path': 'app.py', 'cwe_ids': ['CWE-79']}])
        result = score(report, ['app.py'], 'CWE-22', 'antares-1b', 0, None)
        self.assertEqual(result['missed_paths'], ['app.py'])
        self.assertFalse(result['matches_expected'])

    def test_source_only_staging(self):
        for case in json.loads((FIXTURES / 'cases.json').read_text()):
            with tempfile.TemporaryDirectory() as temporary:
                target = Path(temporary) / 'repository'
                hashes = stage_source(case, target)
                self.assertEqual(set(hashes), {p.name for p in target.iterdir()})
                self.assertTrue(all(name.endswith('.py') for name in hashes))
                self.assertNotIn('cases.json', hashes)
                self.assertEqual(len(hashes), 2 if case['variant'] == 'protected_elsewhere' else 1)

    def test_confusion_matrix_counts_all_four_outcomes(self):
        rows = [dict(complete=True, expected_paths=expected, actual_paths=actual)
                for expected in ([], ['app.py']) for actual in ([], ['app.py'])]
        result = confusion_matrix(rows)
        self.assertEqual(result, dict(true_positive=1, false_negative=1, false_positive=1,
                                      true_negative=1, incomplete_unsafe=0, incomplete_safe=0))

    def test_incomplete_predictions_are_excluded_from_matrix(self):
        rows = [dict(complete=False, expected_paths=expected, actual_paths=actual)
                for expected in ([], ['app.py']) for actual in ([], ['app.py'])]
        result = confusion_matrix(rows)
        self.assertEqual(result, dict(true_positive=0, false_negative=0, false_positive=0,
                                      true_negative=0, incomplete_unsafe=2, incomplete_safe=2))
