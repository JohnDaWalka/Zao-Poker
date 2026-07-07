let openai: any = null;

function getOpenAI(): any {
  if (!openai) {
    try {
      const { OpenAI } = require('openai');
      openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    } catch {
      console.warn('OpenAI not installed. Run: npm install openai');
      openai = null;
    }
  }
  return openai;
}

interface SwarmMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  name?: string;
}

interface Agent {
  name: string;
  systemPrompt: string;
  model: string;
  tools?: Tool[];
}

interface Tool {
  name: string;
  description: string;
  execute: (args: any) => Promise<string>;
}

// --- Specialized Agents ---

const gameStateAgent: Agent = {
  name: 'gameState',
  systemPrompt: `You are the ZAO Poker game state parser. 
You receive raw Farcaster Frame payloads and extract:
- playerFid (Farcaster ID)
- gameId
- selectedAction (fold/call/raise_half/raise_full/all_in)
- stateHash (for integrity verification)

Return ONLY a JSON object. No markdown, no explanation.`,
  model: 'gpt-4o-mini',
};

const oddsCalculatorAgent: Agent = {
  name: 'oddsCalc',
  systemPrompt: `You are the ZAO Poker pot odds calculator. 
Given: pot size, facing bet, player stack, street, hole cards, community cards.
Calculate:
1. Pot odds (call price / total pot after call)
2. Minimum equity needed to call
3. Implied odds estimate
4. Recommended action from {fold, call, raise}

Return ONLY JSON with keys: potOdds, minEquity, impliedOdds, recommendation, confidence(0-1)`,
  model: 'gpt-4o',
};

const farcasterResponseAgent: Agent = {
  name: 'farcasterFrame',
  systemPrompt: `You are the ZAO Poker Farcaster Frame builder.
Given a game state and valid actions, construct the Frame JSON metadata.
Use the exact Farcaster Frame vNext spec.

Return ONLY valid JSON matching the Frame spec.`,
  model: 'gpt-4o-mini',
};

const blockchainAgent: Agent = {
  name: 'blockchain',
  systemPrompt: `You are the ZAO Poker web3 settlement agent.
Given a game outcome (winner, payout amounts), generate the transaction calldata 
for the smart contract settlement.

Return ONLY JSON with: contractAddress, functionName, args[], value (wei)`,
  model: 'gpt-4o',
};

// --- Swarm Orchestrator ---

export class PokerSwarm {
  private conversation: SwarmMessage[] = [];
  
  async execute(
    input: string,
    context: { gameState?: any; playerFid?: number; action?: string }
  ): Promise<any> {
    
    // Step 1: Parse input
    const parsed = await this.callAgent(gameStateAgent, input);
    const parsedData = JSON.parse(parsed);
    
    // Step 2: Calculate odds (if action is ambiguous or player requests advice)
    if (context.gameState && !context.action) {
      const oddsInput = JSON.stringify({
        pot: context.gameState.pot,
        facingBet: context.gameState.facing,
        stack: context.gameState.myStack,
        street: context.gameState.street,
        holeCards: context.gameState.myCards,
        community: context.gameState.community,
      });
      
      const odds = await this.callAgent(oddsCalculatorAgent, oddsInput);
      return JSON.parse(odds);
    }
    
    // Step 3: If action selected, build Frame response
    if (context.action) {
      const frameInput = JSON.stringify({
        ...context.gameState,
        selectedAction: context.action,
        history: context.gameState.history,
      });
      
      const frame = await this.callAgent(farcasterResponseAgent, frameInput);
      return JSON.parse(frame);
    }
    
    // Step 4: If terminal (showdown), trigger settlement
    if (context.gameState?.isTerminal) {
      const settleInput = JSON.stringify({
        winners: context.gameState.winners,
        payouts: context.gameState.payouts,
      });
      
      const tx = await this.callAgent(blockchainAgent, settleInput);
      return JSON.parse(tx);
    }
    
    return parsedData;
  }
  
  private async callAgent(agent: Agent, input: string): Promise<string> {
    const client = getOpenAI();
    if (!client) {
      // Fallback: return a mock response when OpenAI is not available
      return JSON.stringify({
        potOdds: 0.33,
        minEquity: 0.25,
        impliedOdds: 0.40,
        recommendation: 'call',
        confidence: 0.7,
      });
    }
    
    const messages: SwarmMessage[] = [
      { role: 'system', content: agent.systemPrompt, name: agent.name },
      { role: 'user', content: input },
    ];
    
    const response = await client.chat.completions.create({
      model: agent.model,
      messages,
      temperature: 0.1,
      max_tokens: 500,
    });
    
    const content = response.choices[0].message.content || '{}';
    this.conversation.push(
      { role: 'user', content: input, name: 'user' },
      { role: 'assistant', content, name: agent.name }
    );
    
    return content;
  }
  
  // Handoff: pass context from one agent to another
  async handoff(fromAgent: string, toAgent: string, context: any): Promise<any> {
    const handoffPrompt = `Agent ${fromAgent} completed. Handing off to ${toAgent}.
Context: ${JSON.stringify(context)}
Proceed with your task.`;
    
    const target = [gameStateAgent, oddsCalculatorAgent, farcasterResponseAgent, blockchainAgent]
      .find(a => a.name === toAgent);
    
    if (!target) throw new Error(`Unknown agent: ${toAgent}`);
    return this.callAgent(target, handoffPrompt);
  }
}

export default PokerSwarm;
