# AI Poker Coach - Workspace Instructions

## Project Overview
This project implements a Post-Quantum Cryptography (PQC) toolkit for secure communication and data storage, likely intended for an AI Poker Coach application requiring high security. It adheres to NIST standardization (FIPS 203/204).

## Core Technologies
- **Language**: Python 3.8+
- **Cryptography**: 
  - `quantcrypt` (NIST PQC: ML-KEM, ML-DSA)
  - `cryptography` (Hybrid encryption: AES-GCM, HKDF)
- **Key Standards**: 
  - Key Encapsulation: ML-KEM-1024, ML-KEM-768, ML-KEM-512
  - Digital Signatures: ML-DSA-87, ML-DSA-65, ML-DSA-44

## Architecture and Patterns
- **Modular Design**: 
  - `pqc.py`: Core cryptographic primitives and key management.
  - `pqc_api.py`: Mixin for securing API clients.
  - `pqc_files.py`: File encryption service.
- **Import Strategy**: Uses `try-except ImportError` blocks to support both library usage and direct script execution (e.g., `from .pqc import ...` vs `from pqc import ...`).
- **Key Management**:
  - Runtime keys stored in `~/.pqc-keys` (handled by `PQCKeyStore`).
  - Repository artifacts (like trusted public keys) stored in `security/`.

## Coding Conventions
- **Type Hinting**: Use strict type hints (`typing` module) for all function arguments and return values.
- **Docstrings**: 
  - Module-level docstrings must include a "Usage" section with copy-pasteable examples.
  - Class and method docstrings should clearly describe behavior, arguments, and return values.
  - See `pqc.py` or `pqc_files.py` for the standard docstring format.
- **Error Handling**: Use specific exceptions (`ValueError`, `ImportError`) over generic ones.

## Security Guidelines
- **NIST Compliance**: Always prioritize FIPS 203/204 algorithms (ML-KEM, ML-DSA).
- **Hybrid Encryption**: Use PQC for key exchange/encapsulation, but rely on standard AES-GCM for symmetric data encryption (as implemented in `pqc.py` logic).
- **Cleanup**: Ensure sensitive key material (especially private keys) is handled securely and temporary files are cleaned up (see `REVIEW_TASKS.md` regarding `pqc_files.py`).

## Common Tasks (Ref: REVIEW_TASKS.md)
- Verify API method names in examples (e.g., `generate_encryption_keypair` vs `generate_keypair`).
- Validate inputs (e.g., `security_level` arguments).
- Maintain documentation alignment with implementation (especially key storage paths).

## Build and Test
- **Installation**: `pip install quantcrypt cryptography`
- **Testing**: Currently relies on `python pqc_files.py test` (needs refactoring for hermeticity).

## Anti-Patterns
- **Hardcoding Paths**: Avoid hardcoding paths outside of default constants. Use `pathlib.Path`.
- **Ignoring Imports**: Do not remove the `try-except` import guard; it is essential for the module's dual usage.
