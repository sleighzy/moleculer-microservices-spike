import { UUID } from './types';

export enum InventoryState {
  AVAILABLE = 'Available',
  NOT_AVAILABLE = 'Not Available',
  RESERVED = 'Reserved',
  SHIPPED = 'Shipped',
}

export interface InventoryItem {
  _id?: string;
  productId: UUID;
  product: string;
  state: InventoryState;
  created: number;
  updated: number;
}

export interface InventoryItemsResult {
  rows: InventoryItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
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
