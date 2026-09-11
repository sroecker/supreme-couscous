from fastmcp import FastMCP
from fastmcp.server.auth.providers.jwt import JWTVerifier
from fastmcp.server.dependencies import get_access_token
import httpx
import os


async def project_count() -> dict:
    token = get_access_token()
    if token is None or "projects:read" not in token.scopes:
        raise PermissionError("projects:read scope required")
    async with httpx.AsyncClient() as client:
        upstream_token = token.token
        response = await client.get(
            "https://projects.example.invalid/api/projects/count",
            headers={"Authorization": f"Bearer {upstream_token}"},
        )
        response.raise_for_status()
        return response.json()


def create_server(public_key: str) -> FastMCP:
    verifier = JWTVerifier(
        public_key=public_key,
        issuer="https://identity.example.invalid",
        audience="https://mcp.example.invalid/mcp",
        required_scopes=["projects:read"],
    )
    mcp = FastMCP("Project Statistics", auth=verifier)
    mcp.tool()(project_count)
    return mcp
