"""Short-lived tokens that tell the MCP tool server which user a caller acts for.

An internal caller (today, chat) signs one token per operation with the shared
`MCP_TOOLS_SECRET`. The server checks the signature, issuer, audience and expiry on
every request and reads the user only from the token, never from tool arguments.
Anyone holding the secret can act for any user, so only internal services get it.
"""
import os
from datetime import UTC, datetime, timedelta

import jwt
from fastmcp.server.auth.providers.jwt import JWTVerifier

TOKEN_ISSUER = "careergrind-ai"
TOKEN_AUDIENCE = "careergrind-mcp-tools"
TOKEN_ALGORITHM = "HS256"
# Long enough for one chat execution; a fresh token is minted for every operation.
MAX_TOKEN_LIFETIME = timedelta(minutes=10)


class MissingToolSecret(RuntimeError):
    """MCP_TOOLS_SECRET is unset or too short to sign tokens safely."""


def tool_token_secret() -> str:
    """Read the shared signing secret; at least 32 characters, as HS256 needs."""
    secret = os.getenv("MCP_TOOLS_SECRET", "").strip()
    if len(secret) < 32:
        raise MissingToolSecret("Set MCP_TOOLS_SECRET (at least 32 characters) for the MCP tool server")
    return secret


def mint_tool_token(secret: str, *, user_id: str, operation_id: str, expires_at: datetime | None = None) -> str:
    """Sign a token for one user and one operation, expiring by `expires_at` at the latest."""
    now = datetime.now(UTC)
    expires = min(expires_at or now + MAX_TOKEN_LIFETIME, now + MAX_TOKEN_LIFETIME)
    return jwt.encode({"iss": TOKEN_ISSUER, "aud": TOKEN_AUDIENCE, "sub": str(user_id),
                       "client_id": str(user_id), "operation_id": str(operation_id),
                       "iat": now, "exp": expires}, secret, algorithm=TOKEN_ALGORITHM)


def tool_token_verifier(secret: str) -> JWTVerifier:
    """FastMCP auth that rejects requests without a valid token before any tool runs."""
    return JWTVerifier(public_key=secret, algorithm=TOKEN_ALGORITHM, issuer=TOKEN_ISSUER,
                       audience=TOKEN_AUDIENCE)
