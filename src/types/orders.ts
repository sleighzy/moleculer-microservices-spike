import { UUID } from './types';

export enum OrderEventType {
  ORDER_CREATED = 'OrderCreated',
  ORDER_UPDATED = 'OrderUpdated',
  ORDER_CANCELLED = 'OrderCancelled',
}

export enum OrderState {
  APPROVED = 'Approved',
  CANCELLED = 'Cancelled',
  COMPLETED = 'Completed',
  PENDING = 'Pending',
  REJECTED = 'Rejected',
}

export interface Order {
  _id: UUID;
  customerId: UUID;
  items: UUID[];
  state: OrderState;
  created?: number;
  updated?: number;
}

export interface OrderEvent {
  eventType: OrderEventType;
  order: Order;
}
