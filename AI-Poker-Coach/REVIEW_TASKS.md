# Codebase Review: Proposed Follow-up Tasks

## 1) Typo fix task
**Task:** Fix the API name typo in the `pqc.py` module-level usage example.

- The usage block currently calls `pqc.generate_keypair()`, but the implementation exposes `generate_encryption_keypair()` and `generate_signing_keypair()`.
- Update the example to use valid method names so copy/paste usage works.
- Acceptance criteria: all usage snippets in `pqc.py` run without `AttributeError` when copied into a REPL.

## 2) Bug fix task
**Task:** Add explicit validation for `security_level` in `PQCrypto.__init__` and raise a clear `ValueError` for invalid values.

- Current code indexes `self.KEM_LEVELS[security_level]` and `self.DSS_LEVELS[security_level]` directly, which raises a raw `KeyError` for invalid input.
- Validate against allowed values (`standard`, `medium`, `high`) before indexing.
- Acceptance criteria: invalid values raise `ValueError` with a helpful message listing supported options.

## 3) Comment/documentation discrepancy task
**Task:** Align `PQC_SECURITY.md` with actual key storage behavior and key types.

- The file says “Public keys are in `security/` directory,” but runtime key generation in `PQCKeyStore` defaults to `~/.pqc-keys`.
- Clarify that `security/` currently contains a repository-provided public key artifact, while generated keypairs are stored under `~/.pqc-keys` by default.
- Acceptance criteria: documentation clearly distinguishes checked-in key artifacts from runtime-generated keys.

## 4) Test improvement task
**Task:** Improve CLI self-test cleanup and isolation in `pqc_files.py`.

- The `test` command creates `test-file-key` in the default key store and does not remove it, leaving persistent state between runs.
- Refactor the self-test to use a temporary key-store directory and ensure key material is cleaned up.
- Acceptance criteria: repeated `python pqc_files.py test` runs are hermetic and leave no persistent files in `~/.pqc-keys`.
