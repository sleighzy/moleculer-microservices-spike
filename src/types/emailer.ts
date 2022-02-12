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
    customerId: string;
    product: string;
    quantity: number;
  };
}
