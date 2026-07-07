import random
import json
import numpy as np
from typing import Dict, List, Tuple, Any
from dataclasses import dataclass, asdict
from enum import Enum
import argparse
from pathlib import Path

# AutoGen-style multi-agent poker simulator for CFR training data
# Generates thousands of hands with AI agents of different personalities

class ActionType(Enum):
    FOLD = 0
    CHECK_CALL = 1
    BET_HALF = 2
    BET_FULL = 3
    ALL_IN = 4

class PlayerStyle(Enum):
    ROCK = "rock"          # Tight passive, low VPIP, low PFR
    TAG = "tag"            # Tight aggressive, low VPIP, high PFR
    LAG = "lag"            # Loose aggressive, high VPIP, high PFR
    FISH = "fish"          # Loose passive, high VPIP, low PFR
    WHALE = "whale"        # Ultra loose, calls everything
    NIT = "nit"            # Ultra tight, only premiums

@dataclass
class PlayerProfile:
    name: str
    style: PlayerStyle
    vpip: float            # Voluntarily put money in pot % (0-1)
    pfr: float             # Pre-flop raise % (0-1)
    aggression: float      # Post-flop aggression factor (0-5)
    bluff_freq: float      # Bluff frequency (0-1)
    call_down: float       # Call down frequency (0-1)
    stack: int
    
    @classmethod
    def from_style(cls, name: str, style: PlayerStyle, stack: int = 10000) -> 'PlayerProfile':
        profiles = {
            PlayerStyle.ROCK: (0.15, 0.10, 1.5, 0.05, 0.30),
            PlayerStyle.TAG: (0.22, 0.18, 2.5, 0.15, 0.40),
            PlayerStyle.LAG: (0.35, 0.28, 3.5, 0.30, 0.55),
            PlayerStyle.FISH: (0.45, 0.12, 1.0, 0.10, 0.70),
            PlayerStyle.WHALE: (0.65, 0.20, 2.0, 0.20, 0.85),
            PlayerStyle.NIT: (0.10, 0.08, 1.0, 0.03, 0.20),
        }
        vpip, pfr, agg, bluff, call = profiles.get(style, (0.25, 0.15, 2.0, 0.15, 0.45))
        return cls(name, style, vpip, pfr, agg, bluff, call, stack)

class Card:
    RANKS = '23456789TJQKA'
    SUITS = 'shdc'  # spades, hearts, diamonds, clubs
    
    def __init__(self, card_str: str):
        self.rank = card_str[0]
        self.suit = card_str[1]
        self.value = self.RANKS.index(self.rank)
    
    def __repr__(self):
        return f"{self.rank}{self.suit}"
    
    @classmethod
    def deck(cls) -> List['Card']:
        return [Card(f"{r}{s}") for r in cls.RANKS for s in cls.SUITS]

class HandEvaluator:
    """Simple 5-card hand evaluator for simulation."""
    
    @staticmethod
    def evaluate(cards: List[Card]) -> Tuple[int, List[int]]:
        """Returns (hand_rank, kickers) where higher is better."""
        if len(cards) < 5:
            return (0, [0])
        
        # Simple evaluation: check for flush, straight, pairs, etc.
        ranks = sorted([c.value for c in cards], reverse=True)
        suits = [c.suit for c in cards]
        
        is_flush = len(set(suits)) == 1 and len(cards) >= 5
        is_straight = len(set(ranks)) == 5 and ranks[0] - ranks[-1] == 4
        
        rank_counts = {}
        for r in ranks:
            rank_counts[r] = rank_counts.get(r, 0) + 1
        
        counts = sorted(rank_counts.values(), reverse=True)
        
        if is_straight and is_flush:
            return (8, [ranks[0]])  # Straight flush
        elif counts[0] == 4:
            quad = [r for r, c in rank_counts.items() if c == 4][0]
            kicker = [r for r in ranks if r != quad][0]
            return (7, [quad, kicker])  # Four of a kind
        elif counts[0] == 3 and counts[1] == 2:
            trip = [r for r, c in rank_counts.items() if c == 3][0]
            pair = [r for r, c in rank_counts.items() if c == 2][0]
            return (6, [trip, pair])  # Full house
        elif is_flush:
            return (5, ranks[:5])  # Flush
        elif is_straight:
            return (4, [ranks[0]])  # Straight
        elif counts[0] == 3:
            trip = [r for r, c in rank_counts.items() if c == 3][0]
            kickers = sorted([r for r in ranks if r != trip], reverse=True)[:2]
            return (3, [trip] + kickers)  # Three of a kind
        elif counts[0] == 2 and counts[1] == 2:
            pairs = sorted([r for r, c in rank_counts.items() if c == 2], reverse=True)
            kicker = [r for r in ranks if r not in pairs][0]
            return (2, pairs + [kicker])  # Two pair
        elif counts[0] == 2:
            pair = [r for r, c in rank_counts.items() if c == 2][0]
            kickers = sorted([r for r in ranks if r != pair], reverse=True)[:3]
            return (1, [pair] + kickers)  # One pair
        else:
            return (0, ranks[:5])  # High card

class PokerAgent:
    """AI agent with personality-based decision making."""
    
    def __init__(self, profile: PlayerProfile):
        self.profile = profile
        self.hole_cards: List[Card] = []
        self.current_bet = 0
        self.total_invested = 0
        self.folded = False
        self.all_in = False
    
    def hand_strength(self, community: List[Card]) -> float:
        """Estimate hand strength 0-1."""
        if not self.hole_cards:
            return 0.0
        
        all_cards = self.hole_cards + community
        if len(all_cards) < 5:
            # Pre-flop: estimate based on hole cards
            return self._preflop_strength()
        
        rank, _ = HandEvaluator.evaluate(all_cards)
        return min(1.0, rank / 8.0 + random.uniform(0, 0.1))
    
    def _preflop_strength(self) -> float:
        """Simple preflop strength estimation."""
        c1, c2 = self.hole_cards
        if c1.rank == c2.rank:
            return 0.5 + (c1.value / 26.0)  # Pairs: 0.5-0.96
        
        suited = 1.0 if c1.suit == c2.suit else 0.0
        high_card = max(c1.value, c2.value) / 12.0
        gap = abs(c1.value - c2.value)
        connected = max(0, 1.0 - gap / 4.0)
        
        return (high_card * 0.5 + suited * 0.15 + connected * 0.2 + 0.15)
    
    def decide(self, game_state: Dict) -> Tuple[ActionType, int]:
        """Make a decision based on game state and personality."""
        pot = game_state['pot']
        facing = game_state['facing_bet']
        street = game_state['street']
        community = game_state['community']
        
        strength = self.hand_strength(community)
        pot_odds = facing / (pot + facing) if facing > 0 and pot > 0 else 0.3
        
        # Adjust for street
        if street == 'preflop':
            strength *= (1 + self.profile.vpip)
        else:
            strength *= (1 + self.profile.aggression * 0.2)
        
        # Decision logic based on personality
        if strength < pot_odds * 0.5 and facing > 0:
            if random.random() < self.profile.bluff_freq:
                return (ActionType.BET_HALF, min(self.profile.stack, pot * 0.5))
            return (ActionType.FOLD, 0)
        
        if strength < pot_odds and facing > 0:
            if random.random() < self.profile.call_down:
                return (ActionType.CHECK_CALL, facing)
            return (ActionType.FOLD, 0)
        
        if strength > 0.8:
            if self.profile.stack > 0 and random.random() < 0.3:
                return (ActionType.ALL_IN, self.profile.stack)
            return (ActionType.BET_FULL, min(self.profile.stack, pot))
        
        if strength > 0.6:
            return (ActionType.BET_HALF, min(self.profile.stack, pot * 0.5))
        
        if facing > 0:
            return (ActionType.CHECK_CALL, facing)
        return (ActionType.CHECK_CALL, 0)

class PokerTable:
    """Simulates a poker table with agents."""
    
    def __init__(self, agents: List[PokerAgent], small_blind: int = 50, big_blind: int = 100):
        self.agents = agents
        self.small_blind = small_blind
        self.big_blind = big_blind
        self.pot = 0
        self.community: List[Card] = []
        self.deck = Card.deck()
        self.street = 'preflop'
        self.current_bet = 0
        self.button = 0
        self.action_log: List[Dict] = []
        self.hand_count = 0
    
    def shuffle(self):
        random.shuffle(self.deck)
    
    def deal_hole_cards(self):
        for agent in self.agents:
            agent.hole_cards = [self.deck.pop(), self.deck.pop()]
            agent.folded = False
            agent.all_in = False
            agent.current_bet = 0
    
    def deal_community(self, count: int):
        self.deck.pop()  # Burn card
        for _ in range(count):
            self.community.append(self.deck.pop())
    
    def post_blinds(self):
        sb_pos = (self.button + 1) % len(self.agents)
        bb_pos = (self.button + 2) % len(self.agents)
        
        self.agents[sb_pos].current_bet = self.small_blind
        self.agents[sb_pos].profile.stack -= self.small_blind
        self.agents[sb_pos].total_invested += self.small_blind
        
        self.agents[bb_pos].current_bet = self.big_blind
        self.agents[bb_pos].profile.stack -= self.big_blind
        self.agents[bb_pos].total_invested += self.big_blind
        
        self.pot = self.small_blind + self.big_blind
        self.current_bet = self.big_blind
    
    def play_hand(self) -> Dict:
        """Play a single hand and return hand history."""
        self.shuffle()
        self.community = []
        self.pot = 0
        self.current_bet = 0
        self.street = 'preflop'
        self.action_log = []
        
        for agent in self.agents:
            agent.total_invested = 0
        
        self.deal_hole_cards()
        self.post_blinds()
        
        # Pre-flop betting
        self._betting_round('preflop')
        
        if self._active_count() > 1:
            self.street = 'flop'
            self.deal_community(3)
            self.current_bet = 0
            for agent in self.agents:
                agent.current_bet = 0
            self._betting_round('flop')
        
        if self._active_count() > 1:
            self.street = 'turn'
            self.deal_community(1)
            self.current_bet = 0
            for agent in self.agents:
                agent.current_bet = 0
            self._betting_round('turn')
        
        if self._active_count() > 1:
            self.street = 'river'
            self.deal_community(1)
            self.current_bet = 0
            for agent in self.agents:
                agent.current_bet = 0
            self._betting_round('river')
        
        # Showdown
        winner = self._showdown()
        
        self.hand_count += 1
        self.button = (self.button + 1) % len(self.agents)
        
        return {
            'hand_id': self.hand_count,
            'button': self.button,
            'community': [str(c) for c in self.community],
            'actions': self.action_log,
            'winner': winner,
            'pot': self.pot,
        }
    
    def _betting_round(self, street: str):
        """Execute a betting round."""
        start = (self.button + 3) % len(self.agents) if street == 'preflop' else (self.button + 1) % len(self.agents)
        
        for i in range(len(self.agents)):
            idx = (start + i) % len(self.agents)
            agent = self.agents[idx]
            
            if agent.folded or agent.all_in or agent.profile.stack <= 0:
                continue
            
            facing = self.current_bet - agent.current_bet
            game_state = {
                'pot': self.pot,
                'facing_bet': max(0, facing),
                'street': street,
                'community': self.community,
            }
            
            action, amount = agent.decide(game_state)
            
            if action == ActionType.FOLD:
                agent.folded = True
            elif action == ActionType.CHECK_CALL:
                call_amt = min(facing, agent.profile.stack)
                agent.profile.stack -= call_amt
                agent.current_bet += call_amt
                self.pot += call_amt
            elif action == ActionType.BET_HALF:
                bet = min(amount, agent.profile.stack)
                agent.profile.stack -= bet
                agent.current_bet += bet
                self.current_bet = agent.current_bet
                self.pot += bet
            elif action == ActionType.BET_FULL:
                bet = min(amount, agent.profile.stack)
                agent.profile.stack -= bet
                agent.current_bet += bet
                self.current_bet = agent.current_bet
                self.pot += bet
            elif action == ActionType.ALL_IN:
                bet = agent.profile.stack
                agent.profile.stack = 0
                agent.all_in = True
                agent.current_bet += bet
                self.current_bet = max(self.current_bet, agent.current_bet)
                self.pot += bet
            
            self.action_log.append({
                'seat': idx,
                'player': agent.profile.name,
                'style': agent.profile.style.value,
                'action': action.name,
                'amount': amount,
                'street': street,
                'hole_cards': [str(c) for c in agent.hole_cards] if not agent.folded else None,
            })
    
    def _active_count(self) -> int:
        return sum(1 for a in self.agents if not a.folded)
    
    def _showdown(self) -> Dict:
        """Determine winner at showdown."""
        active = [(i, a) for i, a in enumerate(self.agents) if not a.folded]
        if not active:
            return {'seat': -1, 'name': 'none', 'hand': 'none'}
        
        best_rank = -1
        best_kickers = []
        winners = []
        
        for idx, agent in active:
            all_cards = agent.hole_cards + self.community
            rank, kickers = HandEvaluator.evaluate(all_cards)
            
            if rank > best_rank or (rank == best_rank and kickers > best_kickers):
                best_rank = rank
                best_kickers = kickers
                winners = [(idx, agent)]
            elif rank == best_rank and kickers == best_kickers:
                winners.append((idx, agent))
        
        # Award pot
        split = self.pot // len(winners)
        for idx, agent in winners:
            agent.profile.stack += split
        
        return {
            'seat': winners[0][0],
            'name': winners[0][1].profile.name,
            'hand_rank': best_rank,
            'split': len(winners) > 1,
        }

def run_simulation(
    num_hands: int = 1000,
    num_players: int = 6,
    output_file: str = 'training_data.jsonl'
):
    """Run a full simulation and save training data."""
    
    styles = [PlayerStyle.TAG, PlayerStyle.LAG, PlayerStyle.ROCK, 
              PlayerStyle.FISH, PlayerStyle.WHALE, PlayerStyle.NIT]
    
    agents = [
        PokerAgent(PlayerProfile.from_style(f"Agent_{i}", styles[i % len(styles)], 10000))
        for i in range(num_players)
    ]
    
    table = PokerTable(agents)
    hands = []
    
    for i in range(num_hands):
        if (i + 1) % 100 == 0:
            print(f"Played {i + 1} / {num_hands} hands...")
        
        hand = table.play_hand()
        hands.append(hand)
        
        # Reset stacks if someone is busted
        for agent in agents:
            if agent.profile.stack < table.big_blind:
                agent.profile.stack = 10000
    
    # Save to JSONL format
    output_path = Path(output_file)
    with output_path.open('w') as f:
        for hand in hands:
            f.write(json.dumps(hand) + '\n')
    
    print(f"\nSimulation complete!")
    print(f"Total hands: {num_hands}")
    print(f"Output file: {output_path.absolute()}")
    
    # Stats
    style_wins = {}
    for hand in hands:
        winner = hand['winner']
        if winner['seat'] >= 0:
            style = agents[winner['seat']].profile.style.value
            style_wins[style] = style_wins.get(style, 0) + 1
    
    print("\nWin rates by style:")
    for style, wins in sorted(style_wins.items(), key=lambda x: -x[1]):
        pct = (wins / num_hands) * 100
        print(f"  {style}: {wins} wins ({pct:.1f}%)")
    
    return hands

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='AutoGen Poker Simulator for CFR Training')
    parser.add_argument('--hands', type=int, default=1000, help='Number of hands to simulate')
    parser.add_argument('--players', type=int, default=6, help='Number of players')
    parser.add_argument('--output', type=str, default='training_data.jsonl', help='Output file')
    
    args = parser.parse_args()
    run_simulation(args.hands, args.players, args.output)
