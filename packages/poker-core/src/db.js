// Helper to normalize
export function normalizeDb(db) {
    return {
        execute: async (opt) => {
            if (typeof opt === 'string') {
                return db.execute({ sql: opt });
            }
            return db.execute(opt);
        }
    };
}
