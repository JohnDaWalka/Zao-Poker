// CFR (Counterfactual Regret Minimization) Engine
// Implements poker strategy analysis using CFR algorithm

class CFREngine {
  constructor(config = {}) {
    this.iterations = config.iterations || 1000;
    this.regretSums = new Map();
    this.strategySums = new Map();
    this.nodeMap = new Map();
  }

  // Main CFR algorithm
  async cfr(gameState, reach1, reach2, player) {
    if (gameState.isTerminal()) {
      return gameState.getUtility(player);
    }

    const infoSet = gameState.getInfoSet(player);
    const node = this.getNode(infoSet);
    const strategy = node.getStrategy(reach1);
    const actions = gameState.getActions();
    
    const actionUtilities = new Map();
    let nodeUtil = 0;

    // Calculate utilities for each action
    for (const action of actions) {
      const nextState = gameState.takeAction(action);
      let actionUtil;

      if (player === 0) {
        actionUtil = await this.cfr(nextState, reach1 * strategy.get(action), reach2, 1 - player);
      } else {
        actionUtil = await this.cfr(nextState, reach1, reach2 * strategy.get(action), 1 - player);
      }

      actionUtilities.set(action, actionUtil);
      nodeUtil += strategy.get(action) * actionUtil;
    }

    // Calculate regrets
    for (const action of actions) {
      const regret = actionUtilities.get(action) - nodeUtil;
      const reachProb = player === 0 ? reach2 : reach1;
      node.updateRegret(action, regret * reachProb);
    }

    return nodeUtil;
  }

  // Get or create node for info set
  getNode(infoSet) {
    if (!this.nodeMap.has(infoSet)) {
      this.nodeMap.set(infoSet, new CFRNode(infoSet));
    }
    return this.nodeMap.get(infoSet);
  }

  // Train the CFR model
  async train(initialState, iterations = null) {
    const iters = iterations || this.iterations;
    
    for (let i = 0; i < iters; i++) {
      await this.cfr(initialState, 1.0, 1.0, 0);
      await this.cfr(initialState, 1.0, 1.0, 1);

      if (i % 100 === 0) {
        console.log(`CFR iteration ${i}/${iters}`);
      }
    }

    return this.getAverageStrategy();
  }

  // Get average strategy across all iterations
  getAverageStrategy() {
    const avgStrategy = new Map();

    for (const [infoSet, node] of this.nodeMap) {
      avgStrategy.set(infoSet, node.getAverageStrategy());
    }

    return avgStrategy;
  }

  // Analyze a specific hand using CFR
  async analyzeHand(handData) {
    const gameState = this.createGameStateFromHand(handData);
    
    // Run quick CFR iterations for this specific scenario
    await this.train(gameState, 500);
    
    const strategy = this.getAverageStrategy();
    const infoSet = gameState.getInfoSet(0); // Player's perspective
    
    return {
      optimalStrategy: strategy.get(infoSet),
      exploitability: this.calculateExploitability(strategy),
      recommendations: this.generateRecommendations(handData, strategy)
    };
  }

  // Create game state from hand data
  createGameStateFromHand(handData) {
    return new PokerGameState({
      position: handData.position,
      cards: [handData.card1, handData.card2],
      pot: handData.pot || 0,
      stack: handData.stack || 100,
      players: handData.cnt_players || 2,
      board: handData.board || [],
      history: handData.action_history || []
    });
  }

  // Calculate strategy exploitability
  calculateExploitability(strategy) {
    // Simplified exploitability calculation
    // In practice, this would run best response calculations
    let totalRegret = 0;
    
    for (const node of this.nodeMap.values()) {
      totalRegret += node.getTotalRegret();
    }

    return totalRegret / this.nodeMap.size;
  }

  // Generate human-readable recommendations
  generateRecommendations(handData, strategy) {
    const recommendations = [];
    const infoSet = this.createGameStateFromHand(handData).getInfoSet(0);
    const optimalStrategy = strategy.get(infoSet);

    if (!optimalStrategy) {
      return ['Insufficient data for recommendations'];
    }

    // Analyze each action's frequency
    const actions = Array.from(optimalStrategy.entries())
      .sort((a, b) => b[1] - a[1]);

    for (const [action, freq] of actions) {
      if (freq > 0.05) { // Only recommend actions used >5% of the time
        recommendations.push({
          action,
          frequency: (freq * 100).toFixed(1) + '%',
          description: this.getActionDescription(action, freq, handData)
        });
      }
    }

    return recommendations;
  }

  // Get description for an action
  getActionDescription(action, frequency, handData) {
    const descriptions = {
      'fold': `Fold ${(frequency * 100).toFixed(0)}% of the time in this spot`,
      'call': `Call ${(frequency * 100).toFixed(0)}% of the time to maintain balance`,
      'raise': `Raise ${(frequency * 100).toFixed(0)}% for value and protection`,
      'check': `Check ${(frequency * 100).toFixed(0)}% to control pot and see more cards`,
      'bet': `Bet ${(frequency * 100).toFixed(0)}% for value and to deny equity`
    };

    return descriptions[action] || `Take action: ${action}`;
  }

  // Calculate EV for specific action
  calculateActionEV(handData, action) {
    // Simplified EV calculation
    const pot = handData.pot || 0;
    const toCall = handData.to_call || 0;
    
    // This is a placeholder - real EV calculation would consider:
    // - Equity vs opponent's range
    // - Pot odds
    // - Implied odds
    // - Fold equity
    
    return {
      immediate: pot * 0.5 - toCall,
      implied: pot * 0.7,
      total: pot * 0.6 - toCall
    };
  }
}

// CFR Node representing an information set
class CFRNode {
  constructor(infoSet) {
    this.infoSet = infoSet;
    this.regretSum = new Map();
    this.strategySum = new Map();
    this.actions = this.getAvailableActions();
    
    // Initialize regrets and strategy sums
    for (const action of this.actions) {
      this.regretSum.set(action, 0);
      this.strategySum.set(action, 0);
    }
  }

  getAvailableActions() {
    // Default poker actions
    return ['fold', 'call', 'raise'];
  }

  // Get current strategy using regret matching
  getStrategy(realizationWeight) {
    const strategy = new Map();
    let normalizingSum = 0;

    for (const action of this.actions) {
      const regret = Math.max(0, this.regretSum.get(action) || 0);
      strategy.set(action, regret);
      normalizingSum += regret;
    }

    // Normalize
    for (const action of this.actions) {
      if (normalizingSum > 0) {
        strategy.set(action, strategy.get(action) / normalizingSum);
      } else {
        // Uniform strategy if no positive regrets
        strategy.set(action, 1.0 / this.actions.length);
      }

      // Update strategy sum
      const currentSum = this.strategySum.get(action) || 0;
      this.strategySum.set(action, currentSum + realizationWeight * strategy.get(action));
    }

    return strategy;
  }

  // Get average strategy across all iterations
  getAverageStrategy() {
    const avgStrategy = new Map();
    let normalizingSum = 0;

    for (const action of this.actions) {
      normalizingSum += this.strategySum.get(action) || 0;
    }

    for (const action of this.actions) {
      if (normalizingSum > 0) {
        avgStrategy.set(action, (this.strategySum.get(action) || 0) / normalizingSum);
      } else {
        avgStrategy.set(action, 1.0 / this.actions.length);
      }
    }

    return avgStrategy;
  }

  // Update regret for an action
  updateRegret(action, regret) {
    const currentRegret = this.regretSum.get(action) || 0;
    this.regretSum.set(action, currentRegret + regret);
  }

  // Get total regret
  getTotalRegret() {
    let total = 0;
    for (const regret of this.regretSum.values()) {
      total += Math.abs(regret);
    }
    return total;
  }
}

// Poker Game State representation
class PokerGameState {
  constructor(data) {
    this.position = data.position;
    this.cards = data.cards;
    this.pot = data.pot;
    this.stack = data.stack;
    this.players = data.players;
    this.board = data.board;
    this.history = data.history;
    this.street = this.determineStreet();
  }

  determineStreet() {
    if (!this.board || this.board.length === 0) return 'preflop';
    if (this.board.length === 3) return 'flop';
    if (this.board.length === 4) return 'turn';
    if (this.board.length === 5) return 'river';
    return 'preflop';
  }

  isTerminal() {
    // Check if hand is over
    return this.history.includes('fold') || 
           (this.street === 'river' && this.history.includes('call'));
  }

  getUtility(player) {
    // Simplified utility calculation
    // In practice, would need showdown logic
    if (this.history[this.history.length - 1] === 'fold') {
      return player === 0 ? this.pot : -this.pot;
    }
    return 0; // Placeholder for showdown
  }

  getInfoSet(player) {
    // Create unique string representing this game state
    return `${this.position}_${this.cards.join('')}_${this.street}_${this.history.join('_')}`;
  }

  getActions() {
    // Determine available actions based on game state
    const actions = ['fold', 'call'];
    
    if (this.stack > this.pot) {
      actions.push('raise');
    }
    
    if (!this.history.length || this.history[this.history.length - 1] === 'check') {
      actions.push('check');
      actions.push('bet');
    }
    
    return actions.filter(a => a !== 'call' || this.pot > 0);
  }

  takeAction(action) {
    // Create new state after action
    const newState = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    newState.history = [...this.history, action];
    
    if (action === 'raise' || action === 'bet') {
      newState.pot += this.stack * 0.5; // Simplified
    } else if (action === 'call') {
      newState.pot += this.pot * 0.3; // Simplified
    }
    
    return newState;
  }
}

module.exports = { CFREngine, CFRNode, PokerGameState };
