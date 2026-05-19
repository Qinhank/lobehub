/**
 * Market Auth Event System
 *
 * Provides a simple event-based communication mechanism for handling
 * Market API 401 errors across the application.
 */

export type MarketAuthEventType = 'market-unauthorized';

export interface MarketUnauthorizedEvent {
  path: string;
  timestamp: number;
}

type EventCallback = (event: MarketUnauthorizedEvent) => boolean | Promise<boolean | void> | void;

class MarketAuthEventEmitter {
  private listeners: Map<MarketAuthEventType, Set<EventCallback>> = new Map();
  private pendingRecovery?: Promise<boolean>;

  on(event: MarketAuthEventType, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  emit(event: MarketAuthEventType, data: MarketUnauthorizedEvent): void {
    if (event === 'market-unauthorized') {
      this.requestRecovery(data).catch((error) => {
        console.error('[MarketAuthEvents] Error requesting recovery:', error);
      });
    }
  }

  requestRecovery(data: MarketUnauthorizedEvent): Promise<boolean> {
    if (this.pendingRecovery) return this.pendingRecovery;

    const listeners = this.listeners.get('market-unauthorized');
    if (!listeners?.size) return Promise.resolve(false);

    this.pendingRecovery = Promise.all(
      Array.from(listeners).map(async (callback) => {
        try {
          return (await callback(data)) === true;
        } catch (error) {
          console.error('[MarketAuthEvents] Error in event callback:', error);
          return false;
        }
      }),
    )
      .then((results) => results.some(Boolean))
      .finally(() => {
        this.pendingRecovery = undefined;
      });

    return this.pendingRecovery;
  }
}

export const marketAuthEvents = new MarketAuthEventEmitter();
