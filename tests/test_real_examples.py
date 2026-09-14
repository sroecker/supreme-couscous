import hashlib
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from scan_real_examples import stage_archive, prepare


class SnapshotTests(unittest.TestCase):
    def archive(self, directory, entries):
        path = directory/'snapshot.zip'
        with zipfile.ZipFile(path, 'w') as handle:
            for name, content in entries:
                handle.writestr(name, content)
        return path

    def test_preserves_repository_paths_and_excludes_scanner_configuration(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = self.archive(root, [('commit/pkg/app.py', 'pass\n'),
                                          ('commit/LICENSE', 'Example license'),
                                          ('commit/.antares.toml', 'untrusted config')])
            result = stage_archive(archive, root/'repository')
            self.assertEqual((root/'repository/pkg/app.py').read_text(), 'pass\n')
            self.assertTrue((root/'repository/LICENSE').is_file())
            self.assertFalse((root/'repository/.antares.toml').exists())
            self.assertEqual(result['files'], 2)
            repeated = stage_archive(archive, root/'second')
            self.assertEqual(result, repeated)

    def test_rejects_traversal_and_case_collisions_before_writing(self):
        for entries in [[('commit/../../escape.py', 'bad')],
                        [('commit/A.py', 'a'), ('commit/a.py', 'b')]]:
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                archive = self.archive(root, entries)
                with self.assertRaises(ValueError):
                    stage_archive(archive, root/'repository')
                self.assertFalse((root/'repository').exists())

    def test_rejects_symlink_entries(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            info = zipfile.ZipInfo('commit/link')
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive = self.archive(root, [(info, '/tmp')])
            with self.assertRaises(ValueError):
                stage_archive(archive, root/'repository')

    def test_corrupt_cached_archive_is_not_used_or_silently_replaced(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'abc.zip').write_bytes(b'corrupt')
            case = dict(id='example', revision='abc', archive_sha256=hashlib.sha256(b'expected').hexdigest())
            with patch('scan_real_examples.CACHE', root):
                with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                    prepare(case)
            self.assertEqual((root/'abc.zip').read_bytes(), b'corrupt')
