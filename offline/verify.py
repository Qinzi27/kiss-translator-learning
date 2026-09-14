"""Cold-start real inference with outgoing Python socket connections denied."""
import json
import socket
import sys
from datetime import datetime, timezone
from runtime import DATA, configure, deny_outbound

configure()
os_network_denied = False
if "--require-os-network-denied" in sys.argv:
    # This runs before the Python guard, so EPERM/EACCES proves OS enforcement.
    try:
        with socket.socket() as probe:
            probe.settimeout(0.2)
            probe.connect(("1.1.1.1", 443))
    except PermissionError:
        os_network_denied = True
    except OSError as error:
        raise SystemExit(f"Expected OS PermissionError, received {type(error).__name__}")
    else:
        raise SystemExit("ERROR: operating system permitted the connection")
deny_outbound()
# An address-only connect proves the guard without requiring DNS or transmitting data.
try:
    with socket.socket() as probe:
        probe.connect(("1.1.1.1", 443))
except RuntimeError:
    blocked = True
else:
    raise SystemExit("ERROR: outbound guard did not block the test connection")

# Import only AFTER enabling the guard: an online warm cache cannot mask downloads.
from runtime import translate
samples = [("Reading helps us understand the world.", "en", "zh"),
           ("今天我想学习如何翻译网页。", "zh", "en")]
results = []
for text, source, target in samples:
    translated, _ = translate(text, source, target)
    if not translated.strip() or translated == text:
        raise SystemExit(f"No real translation for {source} -> {target}")
    if target == "zh" and not any("\u3400" <= char <= "\u9fff" for char in translated):
        raise SystemExit("Expected Chinese text")
    results.append({"from": source, "to": target, "input": text, "output": translated})
report = {"verified_at": datetime.now(timezone.utc).isoformat(),
          "os_network_denied": os_network_denied,
          "outbound_connection_probe_blocked": blocked,
          "cold_start": True, "real_argos_inference": results}
(DATA / "offline-verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
print(json.dumps(report, ensure_ascii=False, indent=2))
