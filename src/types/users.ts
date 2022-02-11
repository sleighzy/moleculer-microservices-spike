export interface User {
  _id?: string;
  id: string;
  username: string;
  email: string;
  password?: string;
}

export interface UserIdentity extends User {
  token?: string;
}
