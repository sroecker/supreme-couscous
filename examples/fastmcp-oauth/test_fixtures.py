"""Offline behavioral checks; no HTTP listeners or external requests."""
import importlib.util
from pathlib import Path
import time
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
import httpx
import jwt

ROOT = Path(__file__).resolve().parent
ISSUER = "https://identity.example.invalid"
AUDIENCE = "https://mcp.example.invalid/mcp"


def load(case, variant):
    spec = importlib.util.spec_from_file_location(f"{case}_{variant}", ROOT / case / variant / "server.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FixtureTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.public_key = cls.key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        ).decode()

    def mint(self, **overrides):
        claims = {"iss": ISSUER, "aud": AUDIENCE, "sub": "synthetic-user",
                  "client_id": "synthetic-client", "scope": "reports:read",
                  "exp": int(time.time()) + 300}
        claims.update(overrides)
        if claims.get("aud") is None:
            claims.pop("aud")
        return jwt.encode(claims, self.key, algorithm="RS256")

    async def test_wrong_audience_is_accepted_only_by_vulnerable_case(self):
        token = self.mint(aud="https://other.example.invalid/api")
        for variant in ("vulnerable", "fixed"):
            module = load("audience", variant)
            module.create_server(self.public_key)
            result = await module.create_verifier(self.public_key).verify_token(token)
            self.assertEqual(result is not None, variant == "vulnerable")

    async def test_missing_audience_is_accepted_only_by_vulnerable_case(self):
        for variant in ("vulnerable", "fixed"):
            result = await load("audience", variant).create_verifier(self.public_key).verify_token(self.mint(aud=None))
            self.assertEqual(result is not None, variant == "vulnerable")

    async def test_correct_audience_is_accepted_by_both(self):
        for variant in ("vulnerable", "fixed"):
            result = await load("audience", variant).create_verifier(self.public_key).verify_token(self.mint())
            self.assertIsNotNone(result)

    async def test_expired_and_bad_signature_tokens_are_rejected_by_both(self):
        wrong_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        claims = jwt.decode(self.mint(), options={"verify_signature": False})
        invalid = jwt.encode(claims, wrong_key, algorithm="RS256")
        for variant in ("vulnerable", "fixed"):
            verifier = load("audience", variant).create_verifier(self.public_key)
            for token in (self.mint(exp=int(time.time()) - 300), invalid):
                self.assertIsNone(await verifier.verify_token(token))

    async def test_baseline_scope_cannot_export_in_fixed_case(self):
        for variant in ("vulnerable", "fixed"):
            module = load("tool_scope", variant)
            token = await module.create_server(self.public_key).auth.verify_token(self.mint())
            self.assertIsNotNone(token)
            with patch.object(module, "get_access_token", return_value=token):
                if variant == "fixed":
                    with self.assertRaises(PermissionError):
                        module.export_audit_log()
                else:
                    self.assertIn("entries", module.export_audit_log())

    async def test_export_scope_is_accepted_by_fixed_case(self):
        module = load("tool_scope", "fixed")
        token = await module.create_server(self.public_key).auth.verify_token(
            self.mint(scope="reports:read audit:export"))
        with patch.object(module, "get_access_token", return_value=token):
            self.assertIn("entries", module.export_audit_log())

    async def test_fixed_export_rejects_missing_context(self):
        module = load("tool_scope", "fixed")
        with patch.object(module, "get_access_token", return_value=None):
            with self.assertRaises(PermissionError):
                module.export_audit_log()

    async def test_only_vulnerable_case_forwards_mcp_token(self):
        for variant in ("vulnerable", "fixed"):
            module = load("token_passthrough", variant)
            raw_token = self.mint(scope="projects:read")
            token = await module.create_server(self.public_key).auth.verify_token(raw_token)
            self.assertIsNotNone(token)
            requests = []

            def respond(request):
                requests.append(request)
                if request.url.path == "/oauth/token":
                    return httpx.Response(200, json={"access_token": "synthetic-upstream-token"})
                return httpx.Response(200, json={"count": 7})

            client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
            with patch.object(module, "get_access_token", return_value=token), \
                 patch.object(module.httpx, "AsyncClient", return_value=client), \
                 patch.dict(module.os.environ, {"PROJECTS_CLIENT_ID": "test-client", "PROJECTS_CLIENT_SECRET": "test-only"}):
                self.assertEqual(await module.project_count(), {"count": 7})
            expected = raw_token if variant == "vulnerable" else "synthetic-upstream-token"
            self.assertEqual(requests[-1].headers["Authorization"], f"Bearer {expected}")
            self.assertEqual(len(requests), 1 if variant == "vulnerable" else 2)
            if variant == "fixed":
                self.assertNotIn(raw_token, str(requests[0].headers))
                self.assertNotIn(raw_token.encode(), requests[0].content)
                self.assertIn(b"grant_type=client_credentials", requests[0].content)


if __name__ == "__main__":
    unittest.main(verbosity=2)
