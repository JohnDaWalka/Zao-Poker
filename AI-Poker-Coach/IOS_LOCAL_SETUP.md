# Running This Node Locally on iPhone

This project can run on iPhone in a local Python environment (e.g., Pyto/Pythonista + local shell app) without `quantcrypt`.

## 1) Install minimal dependency
```bash
pip install cryptography
```

## 2) Run locally
```bash
python pqc.py list
python pqc_files.py test
```

## 3) What changed for iPhone compatibility
- `PQCrypto` now auto-falls back to a portable mode when `quantcrypt` is not available.
- The fallback keeps the same public API and uses:
  - X25519 key exchange
  - Ed25519 signatures
  - AES-256-GCM encryption

## 4) Notes
- If `quantcrypt` is available, the module automatically uses ML-KEM/ML-DSA.
- On iPhone/local environments where compiled PQC libs are unavailable, the fallback lets your local tracker node keep running.
