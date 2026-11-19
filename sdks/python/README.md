# Trace (Python)

Server SDK: verify events, webhooks and sealed results, and label events for the fraud score. Standard library only; sealed results need the `sealed` extra.

```sh
pip install trace-device            # or: pip install "trace-device[sealed]"
```

```python
import trace_device

client = trace_device.Client(secret_key=os.environ["TRACE_SECRET_KEY"], endpoint="https://id.example.com")
try:
    event = client.get_event(request.json["eventId"])
except trace_device.VerifyError as e:
    ...  # e.code: timeout, not_found, expired, unauthorized, ...; decide whether to fail open or closed

if event["suspectScore"] >= 60 or event["signals"]["multiAccount"]["detected"]:
    ...

# Fraud score: label outcomes per fraud type (a chargeback, or a review that cleared the user)
client.label_event(event_id, "payment", True)
client.unlabel_event(event_id, "payment")

# Webhooks: pass the raw body exactly as received
payload = trace_device.verify_webhook(request.get_data(), request.headers.get("X-Signature"), os.environ["TRACE_WEBHOOK_SECRET"])

# Sealed results (SEALED_RESULTS_KEY on the server), no API call
event = trace_device.unseal_event_result(request.json["sealedResult"], os.environ["TRACE_SEALED_KEY"])
```

Framework guards (read the event id from the `X-Trace-Event-Id` header or the JSON body, verify it, and set the verified event; `TRACE_SECRET_KEY` and `TRACE_ENDPOINT` are read from the environment):

```python
from trace_device.django import trace_guard      # @trace_guard(reject=...) on a view; request.trace
from trace_device.flask import trace_guard       # @trace_guard(reject=...) on a route; flask.g.trace
from trace_device.fastapi import trace_dependency  # Depends(trace_dependency(reject=...)) -> event
from trace_device.guard import Guard             # framework-neutral: Guard(...).check(event_id)
```

Answers: 400 missing or invalid event, 403 when `reject(event)` is true, 503 when Trace is unreachable (`fail_open=True` lets it through), 500 for a bad key or missing configuration (never fails open).

Tests: `PYTHONPATH=src python -m unittest discover -s tests` (sealed tests need `cryptography`; the Django, Flask and FastAPI guard tests need those frameworks and `httpx`, and skip without them).
