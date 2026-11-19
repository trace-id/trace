import json
import pathlib
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

import trace_device

VECTORS = json.loads((pathlib.Path(__file__).resolve().parents[2] / "test-vectors" / "vectors.json").read_text())


class WebhookTests(unittest.TestCase):
    w = VECTORS["webhook"]

    def test_valid(self):
        p = trace_device.verify_webhook(self.w["body"], self.w["signature"], self.w["secret"], now=self.w["nowAccepted"])
        self.assertEqual(p["id"], "wh_1")
        self.assertEqual(p["data"]["suspectScore"], 75)

    def test_rejections(self):
        cases = [
            (None, self.w["nowAccepted"], "missing_signature"),
            ("garbage", self.w["nowAccepted"], "malformed_signature"),
            (self.w["signature"], self.w["nowTooLate"], "timestamp_out_of_range"),
            (self.w["badSignature"], self.w["nowAccepted"], "invalid_signature"),
        ]
        for sig, now, code in cases:
            with self.assertRaises(trace_device.WebhookVerificationError) as ctx:
                trace_device.verify_webhook(self.w["body"], sig, self.w["secret"], now=now)
            self.assertEqual(ctx.exception.code, code)


class SealedTests(unittest.TestCase):
    s = VECTORS["sealed"]

    def test_valid_and_rotation(self):
        e = trace_device.unseal_event_result(self.s["valid"], self.s["key"])
        self.assertEqual(e["eventId"], self.s["expect"]["eventId"])
        other = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        self.assertEqual(trace_device.unseal_event_result(self.s["valid"], [other, self.s["key"]])["suspectScore"], 75)

    def test_rejections(self):
        for sealed, key, code in [
            (self.s["tampered"], self.s["key"], "tampered"),
            (self.s["expired"], self.s["key"], "expired"),
            ("abc", self.s["key"], "malformed"),
            (self.s["valid"], "short", "invalid_key"),
        ]:
            with self.assertRaises(trace_device.SealedResultError) as ctx:
                trace_device.unseal_event_result(sealed, key)
            self.assertEqual(ctx.exception.code, code)


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        auth = self.headers.get("Authorization")
        if auth != "Bearer sk_test":
            self._send(401, {"error": {"code": "unauthorized", "message": "bad key"}})
        elif self.path.endswith(VECTORS["eventId"]["valid"]):
            self._send(200, json.loads(VECTORS["webhook"]["body"])["data"])
        else:
            self._send(404, {"error": {"code": "not_found", "message": "Event not found"}})

    def do_PUT(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"null")
        label = self.path.rsplit("/", 1)[-1]
        if self.headers.get("Authorization") != "Bearer sk_test":
            self._send(401, {"error": {"code": "unauthorized", "message": "bad key"}})
        elif label == "full":
            self._send(409, {"error": {"code": "limit_reached", "message": "too many types"}})
        else:
            self._send(200, {"eventId": self.path.split("/")[3], "label": label, "fraud": body["fraud"]})

    def do_DELETE(self):
        if self.path.endswith("/labels/payment"):
            self.send_response(204)
            self.end_headers()
        else:
            self._send(404, {"error": {"code": "not_found", "message": "Label not found"}})

    def _send(self, status, body):
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *args):
        pass


class VerifyEventTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), _Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.endpoint = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def test_fetches_event(self):
        e = trace_device.verify_event(VECTORS["eventId"]["valid"], "sk_test", self.endpoint)
        self.assertEqual(e["suspectScore"], 75)

    def test_errors(self):
        with self.assertRaises(trace_device.VerifyError) as ctx:
            trace_device.verify_event("not-an-id", "sk_test", self.endpoint)
        self.assertEqual(ctx.exception.code, "invalid_event_id")
        with self.assertRaises(trace_device.VerifyError) as ctx:
            trace_device.Client("sk_wrong", self.endpoint).get_event(VECTORS["eventId"]["valid"])
        self.assertEqual((ctx.exception.code, ctx.exception.status), ("unauthorized", 401))
        with self.assertRaises(trace_device.VerifyError) as ctx:
            trace_device.Client("pk_public", self.endpoint)
        self.assertEqual(ctx.exception.code, "unauthorized")
        with self.assertRaises(trace_device.VerifyError) as ctx:
            trace_device.verify_event("01a1dcf6-53b8-7c68-bd1d-000000000000", "sk_test", self.endpoint)
        self.assertEqual(ctx.exception.code, "not_found")
        with self.assertRaises(trace_device.VerifyError) as ctx:
            trace_device.verify_event(VECTORS["eventId"]["valid"], "sk_test", "http://127.0.0.1:1")
        # Unreachable host: "network" where the refusal is immediate, "timeout" where the OS retries (Windows).
        self.assertIn(ctx.exception.code, ("network", "timeout"))


    def test_labels(self):
        valid = VECTORS["eventId"]["valid"]
        client = trace_device.Client("sk_test", self.endpoint)
        self.assertEqual(client.label_event(valid, "payment", True), {"eventId": valid, "label": "payment", "fraud": True})
        self.assertEqual(trace_device.label_event(valid, "payment", False, "sk_test", self.endpoint)["fraud"], False)
        self.assertIsNone(client.unlabel_event(valid, "payment"))
        for call, code in [
            (lambda: client.label_event(valid, "Payment", True), "invalid_label"),
            (lambda: client.label_event("nope", "payment", True), "invalid_event_id"),
            (lambda: client.label_event(valid, "full", True), "limit_reached"),
            (lambda: client.unlabel_event(valid, "promo"), "not_found"),
        ]:
            with self.assertRaises(trace_device.VerifyError) as ctx:
                call()
            self.assertEqual(ctx.exception.code, code)


if __name__ == "__main__":
    unittest.main()
