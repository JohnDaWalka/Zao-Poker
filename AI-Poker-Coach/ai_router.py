"""Routing logic for selecting analysis depth per hand."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import json
from typing import Any, Dict, Iterable, Literal, Set

RouteType = Literal["light", "deep", "skip"]


@dataclass
class RoutingContext:
    variant: str
    pot_size: float
    tags: Set[str]


class AIRouter:
    """Route incoming hands to a processing tier: light, deep, or skip."""

    def __init__(self, config_path: str | Path = "config/models.json") -> None:
        self.config_path = Path(config_path)
        self._config = self._load_config()
        self.rules: Dict[str, Any] = self._config.get("routing_rules", {})

    def _load_config(self) -> Dict[str, Any]:
        if not self.config_path.exists():
            return {}
        return json.loads(self.config_path.read_text(encoding="utf-8"))

    def route_hand(self, hand_json: Dict[str, Any]) -> RouteType:
        context = self._extract_context(hand_json)

        skip_tags = self._to_set(self.rules.get("skip_tags", []))
        deep_tags = self._to_set(self.rules.get("deep_tags", []))
        skip_variants = self._to_set(self.rules.get("skip_variants", []))
        deep_variants = self._to_set(self.rules.get("deep_variants", []))

        if context.variant in skip_variants or context.tags.intersection(skip_tags):
            return "skip"

        if (
            context.variant in deep_variants
            or context.tags.intersection(deep_tags)
            or context.pot_size >= float(self.rules.get("deep_pot_threshold", 200.0))
        ):
            return "deep"

        if context.pot_size <= float(self.rules.get("light_pot_threshold", 30.0)):
            return "light"

        return "light"

    @staticmethod
    def _to_set(values: Iterable[str]) -> Set[str]:
        return {str(v).strip().lower() for v in values}

    def _extract_context(self, hand_json: Dict[str, Any]) -> RoutingContext:
        variant = str(hand_json.get("variant", "cash")).strip().lower()
        pot_size = float(hand_json.get("pot_size", 0.0) or 0.0)
        tags = self._to_set(hand_json.get("tags", []))

        return RoutingContext(variant=variant, pot_size=pot_size, tags=tags)
