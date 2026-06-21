# Post-Quantum Cryptography (PQC) Security

This repository is protected with **NIST-standardized post-quantum cryptography**.

## Algorithms Used
- **ML-KEM-1024** (FIPS 203) - Key encapsulation
- **ML-DSA-87** (FIPS 204) - Digital signatures
- **AES-256-GCM** - Symmetric encryption
- **Portable fallback:** X25519 + Ed25519 + AES-256-GCM when `quantcrypt` is unavailable

## Files
- `pqc.py` - Core PQC module
- `pqc_api.py` - API protection utilities
- `pqc_files.py` - File encryption utilities

## Usage
```python
from pqc import PQCrypto
pqc = PQCrypto()
encrypted = pqc.encrypt(data, public_key)
```

## Key Management
- `security/` contains repository-provided public key artifacts only.
- Runtime-generated keypairs are stored locally in `~/.pqc-keys/` by default.

## iPhone / local-node compatibility
`PQCrypto` now starts in a portable fallback mode automatically when
`quantcrypt` cannot be imported (common on iOS Python runtimes). This keeps the
same API surface for local testing while preserving authenticated encryption and
signatures.

---
*Secured with quantum-resistant cryptography*
