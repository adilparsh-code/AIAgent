// Base repository interface for CRUD operations
export interface Repository<T, ID = string> {
  getAll(): Promise<T[]>;
  getById(id: ID): Promise<T | null>;
  create(item: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): Promise<T>;
  update(id: ID, item: Partial<T>): Promise<T | null>;
  delete(id: ID): Promise<boolean>;
}

// Helper to generate UUIDs
export function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Helper to get current ISO timestamp
export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}