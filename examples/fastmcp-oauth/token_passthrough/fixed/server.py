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
        response = await client.post(
            "https://identity.example.invalid/oauth/token",
            auth=(os.environ["PROJECTS_CLIENT_ID"], os.environ["PROJECTS_CLIENT_SECRET"]),
            data={
                "grant_type": "client_credentials",
                "resource": "https://projects.example.invalid/api",
                "scope": "projects:read",
            },
        )
        response.raise_for_status()
        upstream_token = response.json()["access_token"]
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
