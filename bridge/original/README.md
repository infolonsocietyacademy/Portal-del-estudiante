# Original Bridge 1.0.10

The existing signed launcher and CMD remain in place. `demo_gold` starts a guarded M1 worker in that same console with the existing owned MT5, installed Python binding, and configured XAUUSD lot/risk. No additional terminal is created.

Fresh confirmed M1 structure breaks are accepted once per closed candle, with no fixed operation-count or session-duration cap. Every entry has broker SL/TP. The worker never sends exit orders or imposes hold timers. Pausing prevents new entries while broker SL/TP remain active. Account pins, command IDs and signal cursors survive restart. Real accounts, netting conflicts, stale quotes and uncertain duplicate sends remain blocked.

`demo_structure_status` reports the strategy. `demo_gold_stop` or the existing stop-session CMD pauses new entries. The old timed XAUUSD demonstration is disabled.

Tests simulate the broker and verify the release against the public key of the original installed launcher. VPS attachment must be checked after deployment. No account credentials or private signing keys are included.
