import numpy as np
from pyswarms.single.global_best import GlobalBestPSO
from typing import List, Tuple
import json

# Your CFR engine interface (adapt to your existing C++ or Python CFR)
class CFREngine:
    def __init__(self, params: np.ndarray):
        """
        params[0]: regret matching temperature (exploration)
        params[1]: pruning threshold (0.0 - 1.0)
        params[2]: bucket granularity (0=coarse, 1=fine)
        params[3]: depth limit for Monte Carlo sampling
        """
        self.temp = max(0.1, params[0])
        self.prune = np.clip(params[1], 0.0, 0.95)
        self.buckets = int(5 + params[2] * 20)  # 5-25 buckets
        self.depth = int(50 + params[3] * 450)  # 50-500 depth
        
    def exploitability(self, iterations: int = 1000) -> float:
        """
        Run CFR for N iterations against itself.
        Return exploitability (lower is better Nash distance).
        """
        # TODO: Wire to your existing CFR implementation
        # Placeholder: simulate convergence metric
        base = 1000.0 / (iterations ** 0.5)
        noise = np.random.normal(0, self.temp * 10)
        pruning_penalty = self.prune * 50  # aggressive pruning = less optimal
        return base + noise + pruning_penalty + (25 - self.buckets) * 2

def objective(params_batch: np.ndarray) -> np.ndarray:
    """Vectorized objective for PySwarms. Lower is better."""
    results = np.zeros(params_batch.shape[0])
    for i, params in enumerate(params_batch):
        engine = CFREngine(params)
        # Run 3 independent evaluations to reduce variance
        scores = [engine.exploitability(500) for _ in range(3)]
        results[i] = np.mean(scores)
    return results

# Bounds: [temp, prune, buckets, depth] all normalized 0-1
lb = np.array([0.0, 0.0, 0.0, 0.0])
ub = np.array([1.0, 0.95, 1.0, 1.0])

options = {
    'c1': 1.5,  # cognitive
    'c2': 1.5,  # social
    'w': 0.7,   # inertia
}

optimizer = GlobalBestPSO(
    n_particles=20,
    dimensions=4,
    options=options,
    bounds=(lb, ub)
)

cost, pos = optimizer.optimize(objective, iters=50)

optimal = {
    'regret_temperature': float(pos[0]),
    'pruning_threshold': float(pos[1]),
    'bucket_count': int(5 + pos[2] * 20),
    'mc_depth': int(50 + pos[3] * 450),
    'exploitability': float(cost)
}

with open('cfr_optimal_params.json', 'w') as f:
    json.dump(optimal, f, indent=2)

print(f"Optimized CFR params: {optimal}")
