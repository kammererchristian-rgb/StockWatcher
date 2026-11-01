#!/usr/bin/env python3
"""Abruf-Helfer für Yahoo Finance mit Chrome-Verbindungssignatur (curl_cffi).

Yahoo sperrt Anfragen, deren TLS-/HTTP2-Signatur nicht nach einem Browser aussieht, mit HTTP 429.
Der Helfer läuft dauerhaft, hält eine Sitzung (Cookies) und beantwortet Anfragen zeilenweise:
  stdin : {"id": 1, "url": "https://...", "headers": {...}}
  stdout: {"id": 1, "status": 200, "body": "...", "error": null}
"""
import json
import sys

try:
    from curl_cffi import requests
except Exception as e:  # Bibliothek fehlt: Node fällt auf eigenes fetch zurück
    print(json.dumps({"id": 0, "fatal": f"curl_cffi nicht verfügbar: {e}"}), flush=True)
    sys.exit(3)

session = requests.Session(impersonate="chrome")
print(json.dumps({"id": 0, "ready": True}), flush=True)

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
    except Exception:
        continue
    rid = req.get("id")
    try:
        r = session.get(req["url"], headers=req.get("headers") or {}, timeout=20, allow_redirects=req.get("redirects", True))
        out = {"id": rid, "status": r.status_code, "body": r.text[:5_000_000], "error": None}
    except Exception as e:
        out = {"id": rid, "status": 0, "body": "", "error": str(e)[:300]}
    print(json.dumps(out), flush=True)
