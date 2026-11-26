"""Sign and check the short record references that list tools hand the model.

A reference names one saved record (by its UUID) for later selection in the same chat
operation. It is an HMAC-signed identity plus expiry, bound to the token's user and
operation and to a per-record-kind prefix and scope, so a job reference can never be
read as a question reference. References carry no saved text and need no local state,
so any server replica can check them. Readers must still filter by the owner.
"""
import base64
import hashlib
import hmac
import struct
import time
from uuid import UUID

_REFERENCE_LENGTH = 45  # two-character prefix plus 32 bytes in unpadded base64


def issue_reference(secret, *, prefix, scope, record_id, user_id, operation_id, expires_at):
    """Sign one record's identity for this owner and operation until `expires_at`."""
    payload = UUID(str(record_id)).bytes + struct.pack("!I", int(expires_at))
    return prefix + base64.urlsafe_b64encode(payload + _sign(secret, scope, user_id, operation_id, payload)).decode().rstrip("=")


def resolve_reference(secret, reference, *, prefix, scope, user_id, operation_id):
    """Return the record UUID, or raise ValueError for a wrong, tampered or expired reference."""
    try:
        if not reference.startswith(prefix) or len(reference) != _REFERENCE_LENGTH:
            raise ValueError("invalid reference")
        encoded = reference[len(prefix):]
        raw = base64.urlsafe_b64decode(encoded + "=")
        if base64.urlsafe_b64encode(raw).decode().rstrip("=") != encoded:
            raise ValueError("invalid reference")
        payload, signature = raw[:20], raw[20:]
        if (not hmac.compare_digest(signature, _sign(secret, scope, user_id, operation_id, payload))
                or struct.unpack("!I", payload[16:])[0] <= time.time()):
            raise ValueError("invalid reference")
        return str(UUID(bytes=payload[:16]))
    except (ValueError, TypeError, struct.error) as error:
        raise ValueError("invalid reference") from error


def _sign(secret, scope, user_id, operation_id, payload):
    bound = f"{scope}\0{user_id}\0{operation_id}\0".encode()
    return hmac.digest(secret.encode(), bound + payload, hashlib.sha256)[:12]
