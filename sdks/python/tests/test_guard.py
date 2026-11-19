import importlib.util
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from trace_device.guard import Guard, event_id_from

EVENT_ID = "0192f0c4-8a5e-7c3d-9b2a-1f2e3d4c5b6a"
EVENT = {"eventId": EVENT_ID, "visitorId": "v1", "confidence": 0.98, "matchKind": "token", "suspectScore": 10, "reasons": [], "signals": {}}
KEY = "sk_test_fake"

state = {"status": 200, "body": EVENT, "calls": 0}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        state["calls"] += 1
        raw = json.dumps(state["body"]).encode()
        self.send_response(state["status"])
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *args):
        pass


server = HTTPServer(("127.0.0.1", 0), Handler)
ENDPOINT = f"http://127.0.0.1:{server.server_address[1]}"
threading.Thread(target=server.serve_forever, daemon=True).start()


def reset(status=200, body=None):
    state.update(status=status, body=EVENT if body is None else body, calls=0)


def guard(**kw):
    return Guard(secret_key=KEY, endpoint=ENDPOINT, **kw)


class GuardTests(unittest.TestCase):
    def setUp(self):
        reset()

    def test_event_id_from_header_or_body(self):
        self.assertEqual(event_id_from({"X-Trace-Event-Id": " abc "}, None), "abc")
        self.assertEqual(event_id_from({}, {"eventId": "xyz"}), "xyz")
        self.assertIsNone(event_id_from({}, {"eventId": 5}))
        self.assertIsNone(event_id_from(None, None))

    def test_verifies_and_returns_the_server_event(self):
        out = guard().check(EVENT_ID)
        self.assertTrue(out.ok)
        self.assertEqual(out.event["visitorId"], "v1")

    def test_missing_id(self):
        out = guard().check(None)
        self.assertEqual((out.ok, out.status, out.code), (False, 400, "event_required"))
        self.assertEqual(state["calls"], 0)
        self.assertTrue(guard(required=False).check(None).ok)

    def test_reject_gives_403(self):
        out = guard(reject=lambda e: e["suspectScore"] >= 5).check(EVENT_ID)
        self.assertEqual((out.ok, out.status), (False, 403))

    def test_unknown_event_is_400(self):
        reset(404, {"error": {"code": "not_found", "message": "no"}})
        self.assertEqual(guard().check(EVENT_ID).status, 400)
        self.assertEqual(guard().check("not-an-id").status, 400)

    def test_unreachable_fails_closed_unless_fail_open(self):
        reset(500, {})
        self.assertEqual(guard().check(EVENT_ID).status, 503)
        out = guard(fail_open=True).check(EVENT_ID)
        self.assertTrue(out.ok)
        self.assertIsNone(out.event)

    def test_bad_key_or_config_never_fails_open(self):
        reset(401, {"error": {"code": "invalid_key", "message": "no"}})
        self.assertEqual(guard(fail_open=True).check(EVENT_ID).status, 500)
        self.assertEqual(Guard(secret_key=KEY, endpoint="").check(EVENT_ID).status, 500)
        self.assertEqual(Guard(secret_key="pk_public", endpoint=ENDPOINT, fail_open=True).check(EVENT_ID).status, 500)


def has(name):
    return importlib.util.find_spec(name) is not None


@unittest.skipUnless(has("flask"), "flask not installed")
class FlaskTests(unittest.TestCase):
    def test_decorator(self):
        from flask import Flask, g

        from trace_device.flask import trace_guard

        app = Flask(__name__)

        @app.post("/signup")
        @trace_guard(secret_key=KEY, endpoint=ENDPOINT, reject=lambda e: e["visitorId"] == "banned")
        def signup():
            return {"visitor": g.trace["visitorId"]}

        c = app.test_client()
        reset()
        r = c.post("/signup", json={"eventId": EVENT_ID})
        self.assertEqual((r.status_code, r.get_json()), (200, {"visitor": "v1"}))
        self.assertEqual(c.post("/signup", headers={"X-Trace-Event-Id": EVENT_ID}).status_code, 200)
        self.assertEqual(c.post("/signup", data={"eventId": EVENT_ID, "email": "a@b.test"}).status_code, 200)
        r = c.post("/signup", json={})
        self.assertEqual((r.status_code, r.get_json()["error"]["code"]), (400, "event_required"))
        reset(body={**EVENT, "visitorId": "banned"})
        self.assertEqual(c.post("/signup", json={"eventId": EVENT_ID}).status_code, 403)


@unittest.skipUnless(has("django"), "django not installed")
class DjangoTests(unittest.TestCase):
    def test_decorator(self):
        import django
        from django.conf import settings

        if not settings.configured:
            settings.configure(DEBUG=True, SECRET_KEY="x", ALLOWED_HOSTS=["*"], ROOT_URLCONF=__name__)
            django.setup()
        from django.http import JsonResponse
        from django.test import RequestFactory

        from trace_device.django import trace_guard

        @trace_guard(secret_key=KEY, endpoint=ENDPOINT)
        def signup(request):
            return JsonResponse({"visitor": request.trace["visitorId"]})

        rf = RequestFactory()
        reset()
        r = signup(rf.post("/signup", data=json.dumps({"eventId": EVENT_ID}), content_type="application/json"))
        self.assertEqual((r.status_code, json.loads(r.content)), (200, {"visitor": "v1"}))
        self.assertEqual(signup(rf.post("/signup", headers={"X-Trace-Event-Id": EVENT_ID})).status_code, 200)
        self.assertEqual(signup(rf.post("/signup", data={"eventId": EVENT_ID, "email": "a@b.test"})).status_code, 200)
        r = signup(rf.post("/signup", data="{}", content_type="application/json"))
        self.assertEqual((r.status_code, json.loads(r.content)["error"]["code"]), (400, "event_required"))


@unittest.skipUnless(has("fastapi") and has("httpx"), "fastapi/httpx not installed")
class FastApiTests(unittest.TestCase):
    def test_dependency(self):
        from fastapi import Depends, FastAPI
        from fastapi.testclient import TestClient

        from trace_device.fastapi import trace_dependency

        app = FastAPI()

        @app.post("/signup")
        async def signup(event=Depends(trace_dependency(secret_key=KEY, endpoint=ENDPOINT))):
            return {"visitor": event["visitorId"]}

        c = TestClient(app)
        reset()
        r = c.post("/signup", json={"eventId": EVENT_ID})
        self.assertEqual((r.status_code, r.json()), (200, {"visitor": "v1"}))
        self.assertEqual(c.post("/signup", headers={"X-Trace-Event-Id": EVENT_ID}).status_code, 200)
        r = c.post("/signup", json={})
        self.assertEqual((r.status_code, r.json()["detail"]["code"]), (400, "event_required"))
        reset(500, {})
        self.assertEqual(c.post("/signup", json={"eventId": EVENT_ID}).status_code, 503)


if __name__ == "__main__":
    unittest.main()
