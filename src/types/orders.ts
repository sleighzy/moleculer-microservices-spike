import { UUID } from './types';

export enum OrderEventType {
  ORDER_CREATED = 'OrderCreated',
  ORDER_UPDATED = 'OrderUpdated',
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
  productId: UUID;
  product: string;
  quantity: number;
}

export interface OrderEvent {
  eventType: OrderEventType;
  order: Order;
}
