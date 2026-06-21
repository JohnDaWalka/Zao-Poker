"""AI processing pipeline for local/external poker hand analysis."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
from typing import Any, Dict, Iterable, List, Optional
from urllib import error as url_error
from urllib import request as url_request
import random

from ai_router import AIRouter
from dossier_manager import DossierManager
from vector_store import HandVectorStore

try:
    from sentence_transformers import SentenceTransformer
except ImportError:  # pragma: no cover - optional dependency
    SentenceTransformer = None


@dataclass
class AnalysisResult:
    hand_id: str
    analysis: str
    tags: List[str]
    confidence: float


class EmbeddingEngine:
    def __init__(self, model_name: str = "all-MiniLM-L6-v2") -> None:
        self.model_name = model_name
        self.dimension = 384
        self._model = SentenceTransformer(model_name) if SentenceTransformer else None

    def embed_text(self, text: str) -> List[float]:
        if self._model is not None:
            emb = self._model.encode(text, convert_to_numpy=True)
            return [float(x) for x in emb.tolist()]

        # deterministic fallback embedding for environments without sentence-transformers
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        seed = int.from_bytes(digest[:8], "big", signed=False)
        rng = random.Random(seed)
        return [rng.uniform(-1.0, 1.0) for _ in range(self.dimension)]

    def embed_batch(self, texts: Iterable[str]) -> List[List[float]]:
        if self._model is not None:
            embeddings = self._model.encode(list(texts), convert_to_numpy=True)
            return [[float(x) for x in emb.tolist()] for emb in embeddings]
        return [self.embed_text(text) for text in texts]


class LLMGateway:
    """Gateway capable of local (Ollama) and external (OpenAI/Grok) inference."""

    def __init__(self, config: Dict[str, Any]) -> None:
        self.config = config
        self.default_provider = config.get("default_provider", "local")

    def infer(self, prompt: str, route: str, provider: Optional[str] = None) -> str:
        provider_name = provider or self.default_provider
        if provider_name == "local":
            return self._infer_local(prompt, route)
        return self._infer_external(prompt, provider_name)

    def _infer_local(self, prompt: str, route: str) -> str:
        local_cfg = self.config.get("local", {})
        model = local_cfg.get("models", {}).get(route, "phi")
        endpoint = local_cfg.get("endpoint", "http://localhost:11434/api/generate")

        payload = json.dumps({"model": model, "prompt": prompt, "stream": False}).encode("utf-8")
        req = url_request.Request(endpoint, data=payload, headers={"Content-Type": "application/json"}, method="POST")

        try:
            with url_request.urlopen(req, timeout=60) as response:
                body = json.loads(response.read().decode("utf-8"))
            return body.get("response", "")
        except Exception:
            if local_cfg.get("use_subprocess_fallback", True):
                try:
                    proc = subprocess.run(
                        ["ollama", "run", model, prompt],
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                    if proc.returncode == 0:
                        return proc.stdout.strip()
                except FileNotFoundError:
                    pass
            return "Local model inference unavailable."

    def _infer_external(self, prompt: str, provider: str) -> str:
        provider_cfg = self.config.get("external", {}).get(provider, {})
        if not provider_cfg:
            return f"External provider '{provider}' is not configured."

        api_key_env = provider_cfg.get("api_key_env", "")
        api_key = ""
        if api_key_env:
            from os import environ

            api_key = environ.get(api_key_env, "")

        if not api_key:
            return f"Missing API key for {provider}."

        payload = {
            "model": provider_cfg.get("model"),
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": provider_cfg.get("token_limit", 1024),
        }
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }

        req = url_request.Request(
            provider_cfg.get("endpoint"),
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )

        try:
            with url_request.urlopen(req, timeout=60) as response:
                body = json.loads(response.read().decode("utf-8"))

            # Try to extract a standard OpenAI-style completion, defensively.
            choices = body.get("choices")
            if isinstance(choices, list) and choices:
                first_choice = choices[0]
                if isinstance(first_choice, dict):
                    message = first_choice.get("message")
                    if isinstance(message, dict):
                        content = message.get("content")
                        if isinstance(content, str) and content.strip():
                            return content

            # If there is an explicit error object, surface its details.
            error_obj = body.get("error")
            if isinstance(error_obj, dict):
                err_msg = error_obj.get("message") or error_obj.get("error") or ""
                err_type = error_obj.get("type") or ""
                details_parts = []
                if err_type:
                    details_parts.append(err_type)
                if err_msg:
                    details_parts.append(err_msg)
                details = ": ".join(details_parts) if details_parts else json.dumps(error_obj)
                return f"External provider '{provider}' error: {details}"

            # Fallback when the response shape is unexpected.
            try:
                body_preview = json.dumps(body)[:500]
            except Exception:
                body_preview = "<unserializable response body>"
            return f"Unexpected response from external provider '{provider}': {body_preview}"
        except (url_error.URLError, json.JSONDecodeError) as exc:
            return f"External provider '{provider}' request failed: {exc}"
class AIProcessor:
    def __init__(
        self,
        config_path: str | Path = "config/models.json",
        output_dir: str | Path = "ai_outputs",
        vector_dir: str | Path = "vector_store",
    ) -> None:
        self.config_path = Path(config_path)
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.config = self._load_config()
        embedding_model = self.config.get("embedding", {}).get("model_name", "all-MiniLM-L6-v2")

        self.router = AIRouter(config_path=config_path)
        self.embedding_engine = EmbeddingEngine(embedding_model)
        self.vector_store = HandVectorStore(vector_dir, dimension=self.embedding_engine.dimension)
        self.llm = LLMGateway(self.config)
        dossier_cfg = self.config.get("dossier", {})
        self.dossier = DossierManager(
            dossier_dir=dossier_cfg.get("directory", "dossiers"),
            max_entries=int(dossier_cfg.get("max_entries", 200)),
            max_chars=int(dossier_cfg.get("max_chars", 6000)),
        )

        self.queue: asyncio.Queue[Dict[str, Any]] = asyncio.Queue()
        self.max_batch_size = int(self.config.get("performance", {}).get("max_batch_size", 8))

    def _load_config(self) -> Dict[str, Any]:
        if not self.config_path.exists():
            return {}
        try:
            return json.loads(self.config_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}

    def tag_hand(self, hand_json: Dict[str, Any], provider: Optional[str] = None) -> List[str]:
        prompt = (
            "Extract concise poker tags from this hand JSON. "
            "Return a comma-separated list only.\n\n"
            f"{json.dumps(hand_json, ensure_ascii=False)}"
        )
        route = self.router.route_hand(hand_json)
        if route == "skip":
            return ["skipped"]

        raw = self.llm.infer(prompt, route=route, provider=provider)
        tags = [tag.strip().lower() for tag in raw.replace("\n", ",").split(",") if tag.strip()]
        return tags[:12]

    def analyze_hand(self, hand_json: Dict[str, Any], provider: Optional[str] = None) -> AnalysisResult:
        hand_id = str(hand_json.get("hand_id") or self._hand_id(hand_json))
        player_id = str(hand_json.get("player_id", "default"))
        route = self.router.route_hand(hand_json)

        if route == "skip":
            result = AnalysisResult(hand_id=hand_id, analysis="Skipped by router.", tags=["skipped"], confidence=0.0)
            self._save_output(result, session_id=str(hand_json.get("session_id", "")))
            return result

        tags = self.tag_hand(hand_json, provider=provider)
        prompt = (
            f"Analyze this poker hand with {route} depth. Include strategic adjustments and mistakes.\n\n"
            f"Hand JSON:\n{json.dumps(hand_json, ensure_ascii=False)}"
        )
        analysis = self.llm.infer(prompt, route=route, provider=provider).strip()

        confidence = 0.9 if route == "deep" else 0.75
        result = AnalysisResult(hand_id=hand_id, analysis=analysis, tags=tags, confidence=confidence)

        emb_input = f"{analysis}\nTAGS:{','.join(tags)}\nVARIANT:{hand_json.get('variant', '')}"
        embedding = self.embedding_engine.embed_text(emb_input)
        self.vector_store.add_hand_embedding(hand_id=hand_id, embedding=embedding, payload=hand_json)
        self._save_output(result, session_id=str(hand_json.get("session_id", "")))
        self._update_dossier(player_id=player_id, hand_json=hand_json, route=route, result=result)
        return result

    def summarize_session(self, session_id: str, provider: Optional[str] = None) -> AnalysisResult:
        session_files = sorted(self.output_dir.glob(f"{session_id}_*.json"))
        if not session_files:
            return AnalysisResult(
                hand_id=session_id,
                analysis="No analyzed hands available for this session.",
                tags=["empty-session"],
                confidence=0.0,
            )

        analyses = [json.loads(path.read_text(encoding="utf-8")) for path in session_files]
        summary_prompt = (
            "Summarize this poker session and provide 3 improvement goals:\n\n"
            f"{json.dumps(analyses, ensure_ascii=False)}"
        )
        text = self.llm.infer(summary_prompt, route="summary", provider=provider)
        return AnalysisResult(hand_id=session_id, analysis=text, tags=["session-summary"], confidence=0.85)

    async def enqueue_hand(self, hand_json: Dict[str, Any]) -> None:
        await self.queue.put(hand_json)

    async def process_queue(self, batch_size: int = 8, provider: Optional[str] = None) -> List[AnalysisResult]:
        processed: List[AnalysisResult] = []
        size = max(1, min(batch_size, self.max_batch_size))

        while not self.queue.empty():
            batch: List[Dict[str, Any]] = []
            for _ in range(size):
                if self.queue.empty():
                    break
                batch.append(await self.queue.get())

            for hand in batch:
                processed.append(self.analyze_hand(hand, provider=provider))
                self.queue.task_done()

            await asyncio.sleep(0)

        return processed

    def find_similar_hands(self, hand_json: Dict[str, Any], top_k: int = 5) -> List[Dict[str, Any]]:
        probe = json.dumps(hand_json, sort_keys=True)
        embedding = self.embedding_engine.embed_text(probe)
        similar = self.vector_store.find_similar_hands(embedding=embedding, top_k=top_k)
        return [
            {"hand_id": item.hand_id, "score": item.score, "payload": item.payload}
            for item in similar
        ]

    def _save_output(self, result: AnalysisResult, session_id: str = "") -> Path:
        payload = {
            "hand_id": result.hand_id,
            "analysis": result.analysis,
            "tags": result.tags,
            "confidence": result.confidence,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        file_name = f"{session_id}_{result.hand_id}.json" if session_id else f"{result.hand_id}.json"
        output_file = self.output_dir / file_name
        output_file.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        return output_file

    @staticmethod
    def _hand_id(hand_json: Dict[str, Any]) -> str:
        raw = json.dumps(hand_json, sort_keys=True).encode("utf-8")
        return hashlib.sha256(raw).hexdigest()[:16]

    def set_default_provider(self, provider: str) -> None:
        allowed = {"local", "openai", "grok", "asi1"}
        if provider not in allowed:
            raise ValueError(f"Unsupported provider '{provider}'. Expected one of: {sorted(allowed)}")
        self.llm.default_provider = provider

    def ingest_leaksnipe_snapshot(self, snapshot: Dict[str, Any], player_id: str = "default") -> Dict[str, Any]:
        """Ingest Leak Snipe snapshot/overlay stats into persistent dossier memory."""
        return self.dossier.ingest_leaksnipe_snapshot(player_id=player_id, snapshot=snapshot)

    def ingest_leaksnipe_file(self, file_path: str | Path, player_id: str = "default") -> Dict[str, Any]:
        path = Path(file_path)
        snapshot = json.loads(path.read_text(encoding="utf-8"))
        return self.ingest_leaksnipe_snapshot(snapshot=snapshot, player_id=player_id)

    def get_dossier(self, player_id: str = "default") -> Dict[str, Any]:
        return self.dossier.load(player_id)

    def _update_dossier(self, player_id: str, hand_json: Dict[str, Any], route: str, result: AnalysisResult) -> None:
        entry = {
            "source": "hand_analysis",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "hand_id": result.hand_id,
            "session_id": hand_json.get("session_id", ""),
            "route": route,
            "analysis": result.analysis,
            "tags": result.tags,
            "confidence": result.confidence,
            "variant": hand_json.get("variant", "unknown"),
            "pot_size": hand_json.get("pot_size", 0),
        }
        self.dossier.append_entry(player_id=player_id, entry=entry)


def analyze_batch(hands: Iterable[Dict[str, Any]], provider: Optional[str] = None) -> List[AnalysisResult]:
    """Convenience batch analyzer for non-async callers."""
    processor = AIProcessor()
    results = [processor.analyze_hand(hand, provider=provider) for hand in hands]
    return results
