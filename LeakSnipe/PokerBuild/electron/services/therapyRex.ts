// Therapy Rex Integration - Mental Game Coaching & Tilt Detection
// Ported from therapy-rex-integration.js for Electron main process

interface Hand {
  amt_won?: number;
  date_played?: string;
  flg_vpip?: boolean;
  flg_pfr?: boolean;
  flg_saw_f?: boolean;
  flg_saw_r?: boolean;
  flg_won_hand?: boolean;
  [key: string]: any;
}

interface TiltEvent {
  type: string;
  severity: 'low' | 'medium' | 'high';
  handIndex: number;
  amount?: number;
  description: string;
  timestamp?: string;
}

interface Recommendation {
  category: string;
  priority: string;
  title: string;
  description: string;
  action: string;
}

interface SessionAnalysis {
  sessionId: string;
  duration: number;
  handCount: number;
  tiltEvents: TiltEvent[];
  emotionalState: string;
  composureScore: number;
  recommendations: Recommendation[];
  strengths: string[];
  concerns: any[];
}

export class TherapyRexEngine {
  private tiltThresholds = {
    lossStreak: 3,
    bigLoss: 50,
    rapidActions: 5,
    sessionLength: 180
  };

  async analyzeSession(sessionData: { id_session?: string; hands: Hand[]; duration: number }): Promise<SessionAnalysis> {
    const hands = sessionData.hands || [];
    const duration = sessionData.duration || 0;

    const analysis: SessionAnalysis = {
      sessionId: sessionData.id_session || 'unknown',
      duration,
      handCount: hands.length,
      tiltEvents: [],
      emotionalState: this.assessEmotionalState(hands),
      composureScore: 0,
      recommendations: [],
      strengths: [],
      concerns: []
    };

    analysis.tiltEvents = this.detectTiltEvents(hands);
    analysis.composureScore = this.calculateComposureScore(hands, analysis.tiltEvents);
    analysis.recommendations = this.generateRecommendations(analysis);
    analysis.strengths = this.identifyStrengths(hands);
    analysis.concerns = this.identifyConcerns(hands, duration);

    return analysis;
  }

  detectTiltEvents(hands: Hand[]): TiltEvent[] {
    const events: TiltEvent[] = [];
    let lossStreak = 0;
    let previousTime: string | null = null;

    for (let i = 0; i < hands.length; i++) {
      const hand = hands[i];
      const result = hand.amt_won || 0;

      if (result < 0) {
        lossStreak++;
        if (lossStreak >= this.tiltThresholds.lossStreak) {
          events.push({
            type: 'loss_streak', severity: 'medium', handIndex: i,
            description: `${lossStreak} losing hands in a row`,
            timestamp: hand.date_played
          });
        }
      } else {
        lossStreak = 0;
      }

      if (result < -this.tiltThresholds.bigLoss) {
        events.push({
          type: 'big_loss', severity: 'high', handIndex: i, amount: result,
          description: `Large loss of ${result} in single hand`,
          timestamp: hand.date_played
        });
      }

      if (previousTime && hand.date_played) {
        const timeDiff = (new Date(hand.date_played).getTime() - new Date(previousTime).getTime()) / 60000;
        if (timeDiff < 0.2) {
          events.push({
            type: 'rapid_play', severity: 'low', handIndex: i,
            description: 'Very quick decision-making',
            timestamp: hand.date_played
          });
        }
      }
      previousTime = hand.date_played || null;
    }
    return events;
  }

  assessEmotionalState(hands: Hand[]): string {
    if (hands.length === 0) return 'neutral';
    const recent = hands.slice(-10);
    const winRate = recent.filter(h => (h.amt_won || 0) > 0).length / recent.length;
    const avgResult = recent.reduce((sum, h) => sum + (h.amt_won || 0), 0) / recent.length;
    const variance = this.calcVariance(recent.map(h => h.amt_won || 0));

    if (variance > 100 && avgResult < 0) return 'frustrated';
    if (winRate < 0.3) return 'discouraged';
    if (winRate > 0.7) return 'confident';
    if (avgResult > 20) return 'excited';
    return 'neutral';
  }

  private calcVariance(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  }

  calculateComposureScore(hands: Hand[], tiltEvents: TiltEvent[]): number {
    let score = 10;
    for (const event of tiltEvents) {
      if (event.severity === 'high') score -= 2;
      else if (event.severity === 'medium') score -= 1;
      else score -= 0.5;
    }
    if (hands.length >= 10) {
      const vpipRates: number[] = [];
      for (let i = 0; i < hands.length; i += 10) {
        const chunk = hands.slice(i, i + 10);
        vpipRates.push(chunk.filter(h => h.flg_vpip).length / chunk.length);
      }
      const consistency = Math.max(0, 1 - this.calcVariance(vpipRates));
      score += consistency * 0.5;
    }
    return Math.max(0, Math.min(10, Math.round(score * 10) / 10));
  }

  generateRecommendations(analysis: SessionAnalysis): Recommendation[] {
    const recs: Recommendation[] = [];
    if (analysis.composureScore < 5) {
      recs.push({ category: 'mental_game', priority: 'high', title: 'Take a Break',
        description: 'Your composure score is low. Consider a 15-minute reset.', action: 'step_away' });
    }
    if (analysis.tiltEvents.filter(e => e.severity === 'high').length > 0) {
      recs.push({ category: 'tilt_management', priority: 'high', title: 'Acute Tilt Detected',
        description: 'Significant emotional events occurred. Review the Mental Game Playbook.', action: 'review_playbook' });
    }
    if (analysis.emotionalState === 'frustrated' || analysis.emotionalState === 'discouraged') {
      recs.push({ category: 'emotional_regulation', priority: 'medium', title: 'Emotional Reset Needed',
        description: 'Try the 3-breath grounding technique before the next hand.', action: 'breathing_exercise' });
    }
    if (analysis.duration > this.tiltThresholds.sessionLength) {
      recs.push({ category: 'fatigue', priority: 'medium', title: 'Long Session Alert',
        description: "You've been playing for over 3 hours. Decision quality may be declining.", action: 'consider_ending' });
    }
    return recs;
  }

  identifyStrengths(hands: Hand[]): string[] {
    if (hands.length === 0) return [];
    const strengths: string[] = [];
    const total = hands.length;
    const vpipRate = hands.filter(h => h.flg_vpip).length / total;
    const pfrRate = hands.filter(h => h.flg_pfr).length / total;
    const winRate = hands.filter(h => (h.amt_won || 0) > 0).length / total;
    const sawFlopRate = hands.filter(h => h.flg_saw_f).length / total;

    if (vpipRate >= 0.15 && vpipRate <= 0.25) strengths.push('Solid VPIP — maintaining discipline');
    if (pfrRate >= 0.10 && pfrRate <= 0.20) strengths.push('Good aggression frequency');
    if (winRate > 0.55) strengths.push('Strong win rate this session');
    if (sawFlopRate < 0.30) strengths.push('Good flop selectivity');
    return strengths;
  }

  identifyConcerns(hands: Hand[], duration: number): any[] {
    if (hands.length === 0) return [];
    const concerns: any[] = [];
    const totalResult = hands.reduce((sum, h) => sum + (h.amt_won || 0), 0);
    const vpipRate = hands.filter(h => h.flg_vpip).length / hands.length;

    if (totalResult < -100) concerns.push({ type: 'financial', severity: 'high', description: 'Significant losses this session', metric: totalResult });
    if (vpipRate > 0.35) concerns.push({ type: 'strategy', severity: 'medium', description: 'VPIP is high — may be playing too many hands', metric: (vpipRate * 100).toFixed(1) + '%' });
    if (vpipRate < 0.10 && hands.length > 50) concerns.push({ type: 'strategy', severity: 'low', description: 'VPIP is very low — may be too tight', metric: (vpipRate * 100).toFixed(1) + '%' });
    if (duration > 240) concerns.push({ type: 'fatigue', severity: 'high', description: 'Extremely long session — high risk of fatigue mistakes', metric: duration + ' minutes' });
    return concerns;
  }

  generateSessionDebrief(analysis: SessionAnalysis): {
    summary: string;
    talkingPoints: string[];
    keyMoments: string[];
    overallGrade: string;
  } {
    const grade = analysis.composureScore >= 8 ? 'A' : analysis.composureScore >= 6 ? 'B' :
                  analysis.composureScore >= 4 ? 'C' : 'D';

    const talkingPoints: string[] = [];
    talkingPoints.push(`Session lasted ${analysis.duration} minutes with ${analysis.handCount} hands.`);
    talkingPoints.push(`Composure score: ${analysis.composureScore}/10 (${analysis.emotionalState}).`);

    if (analysis.tiltEvents.length > 0) {
      talkingPoints.push(`${analysis.tiltEvents.length} tilt event(s) detected — let's discuss what triggered them.`);
    }
    for (const s of analysis.strengths) talkingPoints.push(`✅ ${s}`);
    for (const c of analysis.concerns) talkingPoints.push(`⚠️ ${c.description} (${c.metric})`);
    for (const r of analysis.recommendations) talkingPoints.push(`💡 ${r.title}: ${r.description}`);

    return {
      summary: `Grade ${grade} session: ${analysis.handCount} hands, composure ${analysis.composureScore}/10, ${analysis.tiltEvents.length} tilt events.`,
      talkingPoints,
      keyMoments: analysis.tiltEvents.map(e => `Hand #${e.handIndex + 1}: ${e.description}`),
      overallGrade: grade
    };
  }
}
