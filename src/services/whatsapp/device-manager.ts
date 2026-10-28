import { DeviceLimitReachedError, DeviceModel } from '../database/models';
import { BaileysClient } from './baileys-client';
import { AccountModel } from '../database/models';
import type { Device, ApiResponse } from '../../types';

export class DeviceManager {
  static async createDevice(accountId: string): Promise<ApiResponse<Device>> {
    try {
      const account = await AccountModel.findById(accountId);
      if (!account) {
        return { success: false, error: 'Account not found' };
      }

      const device = await BaileysClient.createDevice(accountId);
      return { success: true, data: device };
    } catch (error) {
      if (error instanceof DeviceLimitReachedError || (error instanceof Error && error.message === 'No active subscription')) {
        return { success: false, error: error.message };
      }
      console.error('Error creating device:', error);
      return { success: false, error: 'Failed to create device' };
    }
  }

  static async getDevices(accountId: string): Promise<ApiResponse<Device[]>> {
    try {
      const devices = await DeviceModel.findByAccountId(accountId);
      return { success: true, data: devices };
    } catch (error) {
      console.error('Error fetching devices:', error);
      return { success: false, error: 'Failed to fetch devices' };
    }
  }

  static async getDevice(deviceId: string): Promise<ApiResponse<Device>> {
    try {
      const device = await DeviceModel.findById(deviceId);
      if (!device) {
        return { success: false, error: 'Device not found' };
      }
      return { success: true, data: device };
    } catch (error) {
      console.error('Error fetching device:', error);
      return { success: false, error: 'Failed to fetch device' };
    }
  }

  static async deleteDevice(deviceId: string): Promise<ApiResponse<void>> {
    try {
      await BaileysClient.disconnectDevice(deviceId);
      await DeviceModel.delete(deviceId);
      return { success: true };
    } catch (error) {
      console.error('Error deleting device:', error);
      return { success: false, error: 'Failed to delete device' };
    }
  }

  static async getQRCode(deviceId: string): Promise<ApiResponse<{ qr: string }>> {
    try {
      const device = await DeviceModel.findById(deviceId);
      if (!device) {
        return { success: false, error: 'Device not found' };
      }

      const qr = await BaileysClient.getQRCode(deviceId);
      return qr
        ? { success: true, data: { qr } }
        : { success: false, error: 'Pairing QR code is not available yet' };
    } catch (error) {
      console.error('Error generating QR code:', error);
      return { success: false, error: 'Failed to generate QR code' };
    }
  }

  static async reconnectDevice(deviceId: string): Promise<ApiResponse<Device>> {
    try {
      const device = await DeviceModel.findById(deviceId);
      if (!device) {
        return { success: false, error: 'Device not found' };
      }

      await BaileysClient.connectDevice(deviceId);

      return { success: true, data: device };
    } catch (error) {
      console.error('Error reconnecting device:', error);
      return { success: false, error: 'Failed to reconnect device' };
    }
  }

  static async getDeviceStatus(deviceId: string): Promise<ApiResponse<Device>> {
    try {
      const device = await DeviceModel.findById(deviceId);
      if (!device) {
        return { success: false, error: 'Device not found' };
      }
      return { success: true, data: device };
    } catch (error) {
      console.error('Error fetching device status:', error);
      return { success: false, error: 'Failed to fetch device status' };
    }
  }
}
