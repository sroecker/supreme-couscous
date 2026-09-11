from fastmcp import FastMCP
from fastmcp.server.auth.providers.jwt import JWTVerifier
from fastmcp.server.dependencies import get_access_token


def export_audit_log() -> dict:
    token = get_access_token()
    if token is None or "audit:export" not in token.scopes:
        raise PermissionError("audit:export scope required")
    return {"entries": [{"actor": "synthetic-user", "event": "admin-login"}]}


def create_server(public_key: str) -> FastMCP:
    verifier = JWTVerifier(
        public_key=public_key,
        issuer="https://identity.example.invalid",
        audience="https://mcp.example.invalid/mcp",
        required_scopes=["reports:read"],
    )
    mcp = FastMCP("Reports and Audit", auth=verifier)
    mcp.tool()(export_audit_log)
    return mcp
