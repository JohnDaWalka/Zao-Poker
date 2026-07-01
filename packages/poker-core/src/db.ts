// Simple DB interface for shared game logic
export interface GameDb {
  execute(options: { sql: string; args?: any[] } | string): Promise<{ rows: any[] }>;
}

// Helper to normalize
export function normalizeDb(db: any): GameDb {
  return {
    execute: async (opt: any) => {
      if (typeof opt === 'string') {
        return db.execute({ sql: opt });
      }
      return db.execute(opt);
    }
  };
}
