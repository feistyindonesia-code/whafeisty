export interface User {
  id: string;
  email: string;
  password_hash: string;
  role: 'customer' | 'superadmin';
  name?: string;
  created_at: Date;
  updated_at: Date;
}

export interface Package {
  id: string;
  name: string;
  price: number;
  device_limit: number;
  message_limit: number;
  description?: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Subscription {
  id: string;
  user_id: string;
  package_id: string;
  status: 'active' | 'pending' | 'expired' | 'suspended';
  start_date?: Date;
  end_date?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface Payment {
  id: string;
  user_id: string;
  package_id: string;
  amount: number;
  method?: string;
  status: 'pending' | 'paid' | 'rejected' | 'expired';
  proof_url?: string;
  paid_at?: Date;
  verified_by?: string;
  verified_at?: Date;
  created_at: Date;
}

export interface Account {
  id: string;
  user_id: string;
  package_id?: string;
  name: string;
  max_devices: number;
  created_at: Date;
  updated_at: Date;
}

export interface Device {
  id: string;
  account_id: string;
  device_id: string;
  status: 'online' | 'offline' | 'disconnected';
  connection_status: 'connected' | 'connecting' | 'disconnected';
  last_seen: Date | null;
  created_at: Date;
}

export interface ApiKey {
  id: string;
  account_id: string;
  key: string;
  name: string;
  permissions: any;
  expires_at?: Date;
  created_at: Date;
  last_used?: Date;
}

export interface Message {
  id: string;
  from_number: string;
  to_number: string;
  content: string;
  media_url?: string;
  status: 'sent' | 'delivered' | 'read' | 'error';
  message_id: string;
  direction: 'outbound' | 'inbound';
  device_id: string;
  created_at: Date;
}

export interface Contact {
  id: string;
  device_id: string;
  phone_number: string;
  name?: string;
  profile_picture_url?: string;
  created_at: Date;
}

export interface Webhook {
  id: string;
  account_id: string;
  url: string;
  events: string[];
  secret?: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateDeviceRequest {
  account_id: string;
}

export interface SendMessageRequest {
  device_id: string;
  to_number: string;
  content?: string;
  media_id?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}
