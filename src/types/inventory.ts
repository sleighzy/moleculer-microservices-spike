export interface InventoryItem {
  id: number;
  product: string;
  state: InventoryState;
  updated: number;
}

export interface InventoryQuery {
  product: string;
  state: string;
}

export enum InventoryEventType {
  ITEM_ADDED = 'ItemAdded',
  ITEM_REMOVED = 'ItemRemoved',
  ITEM_UPDATED = 'ItemUpdated',
}

export interface InventoryEvent {
  eventType: InventoryEventType;
  item: InventoryItem;
}

export enum InventoryState {
  AVAILABLE = 'Available',
  NOT_AVAILABLE = 'Not Available',
  RESERVED = 'Reserved',
  SHIPPED = 'Shipped',
}
