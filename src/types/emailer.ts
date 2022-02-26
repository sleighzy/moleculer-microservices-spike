import { UUID } from './types';

export interface Message {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export enum OrderEventType {
  ORDER_CREATED = 'OrderCreated',
  ORDER_UPDATED = 'OrderUpdated',
}

export interface OrderEvent {
  eventType: OrderEventType;
  order: {
    customerId: UUID;
    product: string;
    quantity: number;
  };
}
