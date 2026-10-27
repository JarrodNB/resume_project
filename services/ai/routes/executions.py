"""Accept authenticated, bounded execution nudges without waiting for model work."""

import hmac
from uuid import UUID

from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError


class StartExecution(BaseModel):
    model_config = ConfigDict(extra="forbid")
    feature: str = Field(pattern=r"^[a-z][a-z_]{0,30}$")
    operation_id: UUID


def install_execution_routes(app, *, secret):
    @app.post("/internal/executions")
    async def start_execution(request: Request):
        expected = secret()
        authorization = request.headers.get("authorization", "")
        supplied = authorization.removeprefix("Bearer ")
        if (not expected or not authorization.startswith("Bearer ") or
                not hmac.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8"))):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 4096:
                return JSONResponse({"error": "request_too_large"}, status_code=413)
        try:
            body = StartExecution.model_validate_json(raw)
        except ValidationError:
            return JSONResponse({"error": "invalid_request"}, status_code=422)
        runner = getattr(request.app.state, "execution_runner", None)
        if runner is None or not runner.ready:
            return JSONResponse({"error": "unavailable"}, status_code=503, headers={"Retry-After": "1"})
        if body.feature not in runner.adapters:
            return JSONResponse({"error": "unknown_feature"}, status_code=404)
        receipt = runner.start(body.feature, str(body.operation_id))
        if receipt == "overloaded":
            return JSONResponse({"error": "busy"}, status_code=503, headers={"Retry-After": "1"})
        return JSONResponse({"feature": body.feature, "operation_id": str(body.operation_id), "receipt": receipt}, status_code=202)
