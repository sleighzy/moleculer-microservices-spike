import { UUID } from './types';

export interface User {
  _id?: string;
  id: string;
  customerId: UUID;
  username: string;
  email: string;
  password?: string;
}

export interface UserIdentity extends User {
  token?: string;
}

export enum UserEventType {
  USER_CREATED = 'UserCreated',
  USER_DELETED = 'UserDeleted',
  USER_UPDATED = 'UserUpdated',
}

export interface UserEvent {
  eventType: UserEventType;
  user: User;
}
