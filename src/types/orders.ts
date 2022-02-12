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

export interface OrderEvent {
  eventType: OrderEventType;
  order: {
    customerId: string;
    product: string;
    quantity: number;
  };
}
