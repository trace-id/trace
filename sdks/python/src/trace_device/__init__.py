"""Server SDK for Trace: verify events, webhooks and sealed results on your backend."""

import base64
import hashlib
import hmac
import json
import re
import time
import urllib.error
import urllib.request
import zlib
from typing import Any, Dict, List, Optional, Union

__all__ = [
    "Client",
    "verify_event",
    "label_event",
    "verify_webhook",
    "unseal_event_result",
    "VerifyError",
    "WebhookVerificationError",
    "SealedResultError",
]
__version__ = "0.1.1"

Event = Dict[str, Any]
_LABEL = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
_EVENT_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")


class VerifyError(Exception):
    """code: invalid_event_id, invalid_label, timeout, network, unauthorized, not_found, expired, rate_limited,
    limit_reached, server_error, invalid_response."""

    def __init__(self, code: str, message: str, status: Optional[int] = None, retry_after: Optional[int] = None):
        super().__init__(message)
        self.code = code
        self.status = status
        self.retry_after = retry_after


class WebhookVerificationError(Exception):
    """code: missing_signature, malformed_signature, timestamp_out_of_range, invalid_signature, invalid_payload."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class SealedResultError(Exception):
    """code: invalid_key, malformed, unsupported_version, tampered, expired, missing_dependency."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _code_for(status: int, server_code: Optional[str]) -> str:
    if status in (401, 403):
        return "unauthorized"
    if status == 404:
        return "not_found"
    if status == 410 or server_code == "event_expired":
        return "expired"
    if status == 429:
        return "rate_limited"
    if status == 400:
        return "invalid_label" if server_code == "invalid_label" else "invalid_event_id"
    if status == 409:
        return "limit_reached"
    return "server_error"


class Client:
    """Fetches server-recorded events. Only the verified event should drive decisions: whatever the browser sends
    you can be forged."""

    def __init__(self, secret_key: str, endpoint: str, timeout: float = 2.0):
        if not secret_key.startswith("sk_"):
            raise VerifyError("unauthorized", "secret_key must be a secret key (sk_...)")
        self.secret_key = secret_key
        self.endpoint = endpoint.rstrip("/")
        self.timeout = timeout

    def get_event(self, event_id: str) -> Event:
        _check_event_id(event_id)
        status, event = self._request("GET", f"/v1/events/{event_id}")
        if not _is_event(event):
            raise VerifyError("invalid_response", "Unexpected response shape", status)
        return event

    def label_event(self, event_id: str, label: str, fraud: bool) -> Dict[str, Any]:
        """Records your verdict on an event for one fraud type (e.g. "payment" after a chargeback, or fraud=False after a
        review cleared it). Trace trains a model per type from these labels and adds fraudScores to new events.
        Labelling again replaces the verdict."""
        _check_event_id(event_id)
        _check_label(label)
        if not isinstance(fraud, bool):
            raise TypeError("fraud must be a bool")
        status, data = self._request("PUT", f"/v1/events/{event_id}/labels/{label}", {"fraud": fraud})
        if not (isinstance(data, dict) and data.get("eventId") == event_id and data.get("label") == label and isinstance(data.get("fraud"), bool)):
            raise VerifyError("invalid_response", "Unexpected response shape", status)
        return data

    def unlabel_event(self, event_id: str, label: str) -> None:
        """Removes a label; raises not_found when the event has no label of that type."""
        _check_event_id(event_id)
        _check_label(label)
        self._request("DELETE", f"/v1/events/{event_id}/labels/{label}")

    def _request(self, method: str, path: str, body: Any = None) -> "tuple[int, Any]":
        headers = {"Authorization": f"Bearer {self.secret_key}", "Accept": "application/json"}
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(f"{self.endpoint}{path}", data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                raw = res.read()
                status = res.status
        except urllib.error.HTTPError as err:
            try:
                payload = _json_or_none(err.read())
            finally:
                err.close()
            error = (payload or {}).get("error") or {}
            retry = err.headers.get("Retry-After")
            raise VerifyError(
                _code_for(err.code, error.get("code") if isinstance(error.get("code"), str) else None),
                error.get("message") if isinstance(error.get("message"), str) else f"HTTP {err.code}",
                err.code,
                int(retry) if retry and retry.isdigit() else None,
            ) from None
        except TimeoutError:
            raise VerifyError("timeout", "Verification timed out") from None
        except urllib.error.URLError as err:
            if isinstance(err.reason, TimeoutError):
                raise VerifyError("timeout", "Verification timed out") from None
            raise VerifyError("network", str(err.reason)) from None
        return status, (_json_or_none(raw) if raw else None)


def _check_event_id(event_id: str) -> None:
    if not _EVENT_ID.match(event_id or ""):
        raise VerifyError("invalid_event_id", "event_id is not a valid event id")


def _check_label(label: str) -> None:
    if not _LABEL.match(label or ""):
        raise VerifyError("invalid_label", "label must match ^[a-z][a-z0-9_]{0,31}$")


def verify_event(event_id: str, secret_key: str, endpoint: str, timeout: float = 2.0) -> Event:
    """One-call form of Client(...).get_event(event_id)."""
    return Client(secret_key, endpoint, timeout).get_event(event_id)


def label_event(event_id: str, label: str, fraud: bool, secret_key: str, endpoint: str, timeout: float = 2.0) -> Dict[str, Any]:
    """One-call form of Client(...).label_event(event_id, label, fraud)."""
    return Client(secret_key, endpoint, timeout).label_event(event_id, label, fraud)


def _json_or_none(raw: bytes) -> Any:
    try:
        return json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None


def _is_event(v: Any) -> bool:
    return (
        isinstance(v, dict)
        and isinstance(v.get("eventId"), str)
        and isinstance(v.get("visitorId"), str)
        and isinstance(v.get("confidence"), (int, float))
        and isinstance(v.get("suspectScore"), (int, float))
        and isinstance(v.get("reasons"), list)
        and isinstance(v.get("signals"), dict)
    )


def verify_webhook(
    body: Union[str, bytes],
    signature: Optional[str],
    secret: str,
    tolerance_sec: int = 300,
    now: Optional[float] = None,
) -> Dict[str, Any]:
    """Verifies the X-Signature header (t=<unix>,v1=<hex hmac>) against the raw body and returns the payload.
    Pass the body exactly as received. Deliveries are at-least-once: dedupe on payload["id"]."""
    if not signature:
        raise WebhookVerificationError("missing_signature", "Missing X-Signature header")
    timestamp = None
    macs: List[str] = []
    for part in signature.split(","):
        k, _, v = part.strip().partition("=")
        if k == "t" and re.fullmatch(r"\d{1,12}", v):
            timestamp = int(v)
        elif k == "v1" and re.fullmatch(r"[0-9a-f]{64}", v):
            macs.append(v)
    if timestamp is None or not macs:
        raise WebhookVerificationError("malformed_signature", "X-Signature is malformed")
    current = int(now if now is not None else time.time())
    if abs(current - timestamp) > tolerance_sec:
        raise WebhookVerificationError("timestamp_out_of_range", "Webhook timestamp is outside the tolerance")
    raw = body if isinstance(body, bytes) else body.encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), str(timestamp).encode() + b"." + raw, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, mac) for mac in macs):
        raise WebhookVerificationError("invalid_signature", "Webhook signature does not match")
    payload = _json_or_none(raw)
    if not (isinstance(payload, dict) and isinstance(payload.get("id"), str) and isinstance(payload.get("type"), str) and isinstance(payload.get("data"), dict)):
        raise WebhookVerificationError("invalid_payload", "Webhook body has an unexpected shape")
    return payload


_AAD = b"trace-sealed-v1"


def _key_bytes(key: str) -> bytes:
    try:
        raw = base64.b64decode(key, validate=True)
    except ValueError:
        raw = b""
    if len(raw) != 32:
        raise SealedResultError("invalid_key", "The key must be base64 of exactly 32 bytes")
    return raw


def unseal_event_result(
    sealed_result: str,
    key: Union[str, List[str]],
    check_expiry: bool = True,
    now: Optional[float] = None,
) -> Event:
    """Decrypts the sealedResult from an identify response (needs: pip install "trace-device[sealed]"). Authenticated, so
    it cannot be altered; still accept each eventId only once to stop replays."""
    try:
        from cryptography.exceptions import InvalidTag
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError:
        raise SealedResultError("missing_dependency", 'Install the extra: pip install "trace-device[sealed]"') from None
    keys = [_key_bytes(k) for k in (key if isinstance(key, list) else [key])]
    try:
        sealed = base64.urlsafe_b64decode(sealed_result + "=" * (-len(sealed_result) % 4))
    except ValueError:
        raise SealedResultError("malformed", "Sealed result is not base64url") from None
    if len(sealed) < 1 + 12 + 16 + 1:
        raise SealedResultError("malformed", "Sealed result is too short")
    if sealed[0] != 1:
        raise SealedResultError("unsupported_version", f"Unsupported sealed result version {sealed[0]}")
    iv, body = sealed[1:13], sealed[13:]
    plain = None
    for k in keys:
        try:
            plain = AESGCM(k).decrypt(iv, body, _AAD)
            break
        except InvalidTag:
            continue
    if plain is None:
        raise SealedResultError("tampered", "Sealed result failed authentication (wrong key or altered)")
    try:
        event = json.loads(zlib.decompress(plain, -15).decode("utf-8"))
    except (zlib.error, ValueError):
        raise SealedResultError("malformed", "Sealed result content is not valid") from None
    if check_expiry:
        expires = event.get("expiresAt", "")
        current = now if now is not None else time.time()
        if _iso_to_epoch(expires) < current:
            raise SealedResultError("expired", "The event is past its verification window")
    return event


def _iso_to_epoch(value: str) -> float:
    from datetime import datetime

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0
