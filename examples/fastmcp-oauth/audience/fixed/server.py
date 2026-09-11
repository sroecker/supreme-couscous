from fastmcp import FastMCP
from fastmcp.server.auth.providers.jwt import JWTVerifier


def create_verifier(public_key: str) -> JWTVerifier:
    return JWTVerifier(
        public_key=public_key,
        issuer="https://identity.example.invalid",
        audience="https://mcp.example.invalid/mcp",
        required_scopes=["reports:read"],
    )


def read_report() -> dict:
    return {"report": "synthetic internal report"}


def create_server(public_key: str) -> FastMCP:
    mcp = FastMCP("Reports", auth=create_verifier(public_key))
    mcp.tool()(read_report)
    return mcp
