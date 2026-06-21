"""Persistent dossier memory for cross-session player analytics."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Dict, List


class DossierManager:
    """Maintains compressed long-term memory for poker analysis sessions."""

    def __init__(self, dossier_dir: str | Path = "dossiers", max_entries: int = 200, max_chars: int = 6000) -> None:
        self.dossier_dir = Path(dossier_dir)
        self.dossier_dir.mkdir(parents=True, exist_ok=True)
        self.max_entries = max_entries
        self.max_chars = max_chars

    def load(self, player_id: str = "default") -> Dict[str, Any]:
        path = self._path(player_id)
        if not path.exists():
            return {
                "player_id": player_id,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "entries": [],
                "personality_analytics": {},
                "dsm4_analytics": {},
                "dsm5_analytics": {},
                "therapy_analytics": {},
                "compressed_memory": "",
            }
        return json.loads(path.read_text(encoding="utf-8"))

    def save(self, dossier: Dict[str, Any]) -> Path:
        dossier["updated_at"] = datetime.now(timezone.utc).isoformat()
        path = self._path(str(dossier.get("player_id", "default")))
        path.write_text(json.dumps(dossier, indent=2, ensure_ascii=False), encoding="utf-8")
        return path

    def append_entry(self, player_id: str, entry: Dict[str, Any]) -> Dict[str, Any]:
        dossier = self.load(player_id)
        entries: List[Dict[str, Any]] = dossier.get("entries", [])
        entries.append(entry)
        dossier["entries"] = entries[-self.max_entries :]
        dossier["compressed_memory"] = self._compress_entries(dossier["entries"])
        self._refresh_analytics(dossier)
        self.save(dossier)
        return dossier

    def ingest_leaksnipe_snapshot(self, player_id: str, snapshot: Dict[str, Any]) -> Dict[str, Any]:
        entry = {
            "source": "leak_snipe",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "payload": snapshot,
            "key_points": [
                f"VPIP={snapshot.get('vpip', 'n/a')}",
                f"PFR={snapshot.get('pfr', 'n/a')}",
                f"AF={snapshot.get('af', 'n/a')}",
                f"Hands={snapshot.get('hands', 'n/a')}",
            ],
        }
        return self.append_entry(player_id, entry)

    def _refresh_analytics(self, dossier: Dict[str, Any]) -> None:
        entries = dossier.get("entries", [])
        tag_counts: Dict[str, int] = {}
        for entry in entries:
            for tag in entry.get("tags", []):
                tag_counts[tag] = tag_counts.get(tag, 0) + 1

        dossier["personality_analytics"] = {
            "dominant_patterns": sorted(tag_counts, key=tag_counts.get, reverse=True)[:8],
            "sample_size": len(entries),
        }
        # These are soft behavioral indicators, not clinical diagnosis outputs.
        dossier["dsm4_analytics"] = {
            "status": "non-clinical indicators only",
            "risk_signals": self._risk_from_tags(tag_counts),
        }
        dossier["dsm5_analytics"] = {
            "status": "non-clinical indicators only",
            "risk_signals": self._risk_from_tags(tag_counts),
        }
        dossier["therapy_analytics"] = {
            "recommended_focus": self._recommended_focus(tag_counts),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

    def _compress_entries(self, entries: List[Dict[str, Any]]) -> str:
        lines: List[str] = []
        for entry in entries[-40:]:
            hand_id = entry.get("hand_id", "unknown")
            route = entry.get("route", "light")
            tags = ",".join(entry.get("tags", [])[:4])
            summary = str(entry.get("analysis", "")).replace("\n", " ")[:140]
            lines.append(f"[{hand_id}|{route}] {tags} :: {summary}")

        compressed = "\n".join(lines)
        if len(compressed) > self.max_chars:
            compressed = compressed[-self.max_chars :]
        return compressed

    @staticmethod
    def _risk_from_tags(tag_counts: Dict[str, int]) -> List[str]:
        mapping = {
            "tilt": "possible emotion regulation strain",
            "overbluff": "impulsivity under pressure",
            "hero-call": "risk-seeking bias",
            "fear-fold": "avoidance response in high-variance spots",
        }
        signals: List[str] = []
        for tag, description in mapping.items():
            if tag_counts.get(tag, 0) >= 3:
                signals.append(description)
        return signals

    @staticmethod
    def _recommended_focus(tag_counts: Dict[str, int]) -> List[str]:
        if not tag_counts:
            return ["Collect more sessions for stable behavioral baseline."]
        priorities = []
        if tag_counts.get("tilt", 0) > 0:
            priorities.append("Pre-session regulation routine and stop-loss boundaries.")
        if tag_counts.get("overbluff", 0) > 0:
            priorities.append("Strengthen bluff frequency calibration by node type.")
        if tag_counts.get("fear-fold", 0) > 0:
            priorities.append("River bluff-catcher threshold drills with MDF ranges.")
        return priorities or ["Maintain baseline and continue periodic review."]

    def _path(self, player_id: str) -> Path:
        safe_id = "".join(c for c in player_id if c.isalnum() or c in {"-", "_"}) or "default"
        return self.dossier_dir / f"{safe_id}.json"
