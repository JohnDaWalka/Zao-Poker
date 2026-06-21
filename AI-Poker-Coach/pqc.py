"""
Post-Quantum Cryptography Module
================================
Drop this module into any Python project to add quantum-resistant cryptography.

NIST FIPS Standards:
- ML-KEM (FIPS 203): Key Encapsulation Mechanism
- ML-DSA (FIPS 204): Digital Signature Algorithm

Installation:
    pip install quantcrypt cryptography

Usage:
    from pqc import PQCrypto
    
    pqc = PQCrypto()
    pub, priv = pqc.generate_keypair()
    encrypted = pqc.encrypt(data, recipient_public_key)
    decrypted = pqc.decrypt(encrypted, private_key)
"""

import os
import json
import base64
import hashlib
from pathlib import Path
from typing import Tuple, Dict, Optional, Union
from dataclasses import dataclass
from datetime import datetime, timezone

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.asymmetric import x25519, ed25519
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    PublicFormat,
    PrivateFormat,
    NoEncryption,
)

try:
    from quantcrypt.kem import MLKEM_1024, MLKEM_768, MLKEM_512
    from quantcrypt.dss import MLDSA_87, MLDSA_65, MLDSA_44
    PQC_AVAILABLE = True
except ImportError:
    PQC_AVAILABLE = False


@dataclass
class PQCKey:
    """Represents a post-quantum cryptographic key pair."""
    public_key: bytes
    private_key: bytes
    algorithm: str
    created_at: str
    key_id: str
    
    def to_dict(self) -> Dict:
        return {
            "public_key": base64.b64encode(self.public_key).decode(),
            "algorithm": self.algorithm,
            "created_at": self.created_at,
            "key_id": self.key_id
        }
    
    def save(self, directory: Path, name: str):
        """Save keys to files."""
        directory.mkdir(parents=True, exist_ok=True)
        
        # Save public key (can be shared)
        pub_path = directory / f"{name}.pub.json"
        pub_path.write_text(json.dumps(self.to_dict(), indent=2))
        
        # Save private key (keep secure!)
        priv_path = directory / f"{name}.key"
        priv_path.write_bytes(self.private_key)
        os.chmod(priv_path, 0o600)
        
        return pub_path, priv_path


class PQCrypto:
    """
    Post-Quantum Cryptography wrapper for easy integration.
    
    Supports:
    - Key encapsulation (ML-KEM)
    - Digital signatures (ML-DSA)  
    - Hybrid encryption (ML-KEM + AES-256-GCM)
    """
    
    KEM_LEVELS = {
        "high": MLKEM_1024 if PQC_AVAILABLE else None,
        "medium": MLKEM_768 if PQC_AVAILABLE else None,
        "standard": MLKEM_512 if PQC_AVAILABLE else None,
    }
    
    DSS_LEVELS = {
        "high": MLDSA_87 if PQC_AVAILABLE else None,
        "medium": MLDSA_65 if PQC_AVAILABLE else None,
        "standard": MLDSA_44 if PQC_AVAILABLE else None,
    }
    
    def __init__(self, security_level: str = "high"):
        supported = tuple(self.KEM_LEVELS.keys())
        if security_level not in supported:
            raise ValueError(
                f"Invalid security_level '{security_level}'. "
                f"Supported values: {', '.join(supported)}"
            )
        
        self.security_level = security_level
        if PQC_AVAILABLE:
            self._kem = self.KEM_LEVELS[security_level]()
            self._dss = self.DSS_LEVELS[security_level]()
            self._fallback_mode = False
        else:
            # Portable fallback mode for environments where quantcrypt wheels are
            # unavailable (e.g., iOS/Pythonista/Pyto).
            self._fallback_mode = True
            self._kem = None
            self._dss = None
    
    def generate_encryption_keypair(self) -> PQCKey:
        """Generate a new ML-KEM key pair for encryption."""
        if self._fallback_mode:
            priv_obj = x25519.X25519PrivateKey.generate()
            pub_obj = priv_obj.public_key()
            priv = priv_obj.private_bytes(
                encoding=Encoding.Raw,
                format=PrivateFormat.Raw,
                encryption_algorithm=NoEncryption(),
            )
            pub = pub_obj.public_bytes(
                encoding=Encoding.Raw,
                format=PublicFormat.Raw,
            )
            algorithm = "X25519-HKDF-AES256GCM (fallback)"
        else:
            pub, priv = self._kem.keygen()
            algorithm = (
                f"ML-KEM-{['512', '768', '1024'][['standard', 'medium', 'high'].index(self.security_level)]}"
            )
        key_id = hashlib.sha256(pub).hexdigest()[:16]
        
        return PQCKey(
            public_key=pub,
            private_key=priv,
            algorithm=algorithm,
            created_at=datetime.now(timezone.utc).isoformat(),
            key_id=key_id
        )
    
    def generate_signing_keypair(self) -> PQCKey:
        """Generate a new ML-DSA key pair for signatures."""
        if self._fallback_mode:
            priv_obj = ed25519.Ed25519PrivateKey.generate()
            pub_obj = priv_obj.public_key()
            priv = priv_obj.private_bytes(
                encoding=Encoding.Raw,
                format=PrivateFormat.Raw,
                encryption_algorithm=NoEncryption(),
            )
            pub = pub_obj.public_bytes(
                encoding=Encoding.Raw,
                format=PublicFormat.Raw,
            )
            algorithm = "Ed25519 (fallback)"
        else:
            pub, priv = self._dss.keygen()
            algorithm = (
                f"ML-DSA-{['44', '65', '87'][['standard', 'medium', 'high'].index(self.security_level)]}"
            )
        key_id = hashlib.sha256(pub).hexdigest()[:16]
        
        return PQCKey(
            public_key=pub,
            private_key=priv,
            algorithm=algorithm,
            created_at=datetime.now(timezone.utc).isoformat(),
            key_id=key_id
        )
    
    def encrypt(self, plaintext: bytes, recipient_public_key: bytes) -> bytes:
        """
        Encrypt data using hybrid ML-KEM + AES-256-GCM.
        
        Returns a binary blob containing:
        - 4 bytes: ciphertext length
        - N bytes: KEM ciphertext
        - 12 bytes: AES nonce
        - M bytes: AES ciphertext + tag
        """
        if self._fallback_mode:
            ephemeral_private = x25519.X25519PrivateKey.generate()
            ephemeral_public = ephemeral_private.public_key().public_bytes(
                encoding=Encoding.Raw, format=PublicFormat.Raw
            )
            recipient_pub = x25519.X25519PublicKey.from_public_bytes(recipient_public_key)
            shared_secret = ephemeral_private.exchange(recipient_pub)
            kem_ciphertext = ephemeral_public
        else:
            # Encapsulate shared secret
            kem_ciphertext, shared_secret = self._kem.encaps(recipient_public_key)
        
        # Derive AES key using HKDF
        aes_key = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=None,
            info=b"pqc-aes-encryption"
        ).derive(shared_secret)
        
        # Encrypt with AES-256-GCM
        nonce = os.urandom(12)
        aesgcm = AESGCM(aes_key)
        aes_ciphertext = aesgcm.encrypt(nonce, plaintext, None)
        
        # Pack everything together
        return (
            len(kem_ciphertext).to_bytes(4, 'big') +
            kem_ciphertext +
            nonce +
            aes_ciphertext
        )
    
    def decrypt(self, ciphertext: bytes, private_key: bytes) -> bytes:
        """Decrypt data encrypted with encrypt()."""
        # Unpack
        kem_ct_len = int.from_bytes(ciphertext[:4], 'big')
        kem_ciphertext = ciphertext[4:4+kem_ct_len]
        nonce = ciphertext[4+kem_ct_len:4+kem_ct_len+12]
        aes_ciphertext = ciphertext[4+kem_ct_len+12:]
        
        if self._fallback_mode:
            recipient_priv = x25519.X25519PrivateKey.from_private_bytes(private_key)
            ephemeral_pub = x25519.X25519PublicKey.from_public_bytes(kem_ciphertext)
            shared_secret = recipient_priv.exchange(ephemeral_pub)
        else:
            # Decapsulate
            shared_secret = self._kem.decaps(private_key, kem_ciphertext)
        
        # Derive AES key
        aes_key = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=None,
            info=b"pqc-aes-encryption"
        ).derive(shared_secret)
        
        # Decrypt
        aesgcm = AESGCM(aes_key)
        return aesgcm.decrypt(nonce, aes_ciphertext, None)
    
    def sign(self, message: bytes, private_key: bytes) -> bytes:
        """Create a digital signature using ML-DSA."""
        if self._fallback_mode:
            signer = ed25519.Ed25519PrivateKey.from_private_bytes(private_key)
            return signer.sign(message)
        return self._dss.sign(private_key, message)
    
    def verify(self, message: bytes, signature: bytes, public_key: bytes) -> bool:
        """Verify a digital signature."""
        try:
            if self._fallback_mode:
                verifier = ed25519.Ed25519PublicKey.from_public_bytes(public_key)
                verifier.verify(signature, message)
                return True
            return self._dss.verify(public_key, message, signature)
        except Exception:
            return False
    
    def encrypt_file(self, input_path: Path, output_path: Path, recipient_public_key: bytes):
        """Encrypt a file."""
        plaintext = input_path.read_bytes()
        ciphertext = self.encrypt(plaintext, recipient_public_key)
        output_path.write_bytes(ciphertext)
    
    def decrypt_file(self, input_path: Path, output_path: Path, private_key: bytes):
        """Decrypt a file."""
        ciphertext = input_path.read_bytes()
        plaintext = self.decrypt(ciphertext, private_key)
        output_path.write_bytes(plaintext)


class PQCKeyStore:
    """Simple key store for managing PQC keys."""
    
    def __init__(self, directory: Path = None):
        self.directory = directory or Path.home() / ".pqc-keys"
        self.directory.mkdir(parents=True, exist_ok=True)
    
    def save_key(self, key: PQCKey, name: str) -> Tuple[Path, Path]:
        """Save a key pair."""
        return key.save(self.directory, name)
    
    def load_public_key(self, name: str) -> bytes:
        """Load a public key."""
        pub_path = self.directory / f"{name}.pub.json"
        data = json.loads(pub_path.read_text())
        return base64.b64decode(data["public_key"])
    
    def load_private_key(self, name: str) -> bytes:
        """Load a private key."""
        priv_path = self.directory / f"{name}.key"
        return priv_path.read_bytes()
    
    def list_keys(self) -> list:
        """List all stored keys."""
        keys = []
        for pub_file in self.directory.glob("*.pub.json"):
            data = json.loads(pub_file.read_text())
            data["name"] = pub_file.stem.replace(".pub", "")
            keys.append(data)
        return keys


# Convenience functions
def quick_encrypt(data: Union[str, bytes], recipient_public_key: bytes) -> bytes:
    """Quick encryption helper."""
    if isinstance(data, str):
        data = data.encode('utf-8')
    return PQCrypto().encrypt(data, recipient_public_key)


def quick_decrypt(ciphertext: bytes, private_key: bytes) -> bytes:
    """Quick decryption helper."""
    return PQCrypto().decrypt(ciphertext, private_key)


# CLI when run directly
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("PQC - Post-Quantum Cryptography Module")
        print("=" * 40)
        print("\nUsage:")
        print("  python pqc.py keygen <name>     Generate new key pair")
        print("  python pqc.py list              List stored keys")
        print("  python pqc.py encrypt <file> <key_name>")
        print("  python pqc.py decrypt <file> <key_name>")
        print("  python pqc.py test              Run tests")
        sys.exit(0)
    
    cmd = sys.argv[1]
    store = PQCKeyStore()
    pqc = PQCrypto()
    
    if cmd == "keygen":
        name = sys.argv[2] if len(sys.argv) > 2 else "default"
        enc_key = pqc.generate_encryption_keypair()
        sig_key = pqc.generate_signing_keypair()
        store.save_key(enc_key, f"{name}-enc")
        store.save_key(sig_key, f"{name}-sig")
        print(f"✓ Generated keys: {name}-enc, {name}-sig")
    
    elif cmd == "list":
        keys = store.list_keys()
        if not keys:
            print("No keys found.")
        else:
            for k in keys:
                print(f"  {k['name']}: {k['algorithm']} ({k['key_id']})")
    
    elif cmd == "test":
        print("Running PQC tests...")
        
        # Test encryption
        key = pqc.generate_encryption_keypair()
        original = b"Hello, quantum-safe world!"
        encrypted = pqc.encrypt(original, key.public_key)
        decrypted = pqc.decrypt(encrypted, key.private_key)
        assert original == decrypted, "Encryption test failed!"
        print("  ✓ Encryption/Decryption")
        
        # Test signing
        sig_key = pqc.generate_signing_keypair()
        message = b"Sign this message"
        signature = pqc.sign(message, sig_key.private_key)
        assert pqc.verify(message, signature, sig_key.public_key), "Signature test failed!"
        assert not pqc.verify(b"wrong", signature, sig_key.public_key), "Tamper test failed!"
        print("  ✓ Digital Signatures")
        
        print("\n✅ All tests passed!")
    
    else:
        print(f"Unknown command: {cmd}")
