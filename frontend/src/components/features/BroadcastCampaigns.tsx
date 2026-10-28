import { useEffect, useState, useCallback } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import axios from 'axios';

const API_BASE = '/api/v1/features';
const DEVICES_API_BASE = '/api/v1';

interface BroadcastCampaign {
  id: string;
  account_id: string;
  device_id: string;
  name: string;
  content: string;
  status: 'draft' | 'ready' | 'sending' | 'completed' | 'cancelled';
  recipient_count: number;
  created_at: string;
  updated_at: string;
}

export default function BroadcastCampaigns() {
  const [campaigns, setCampaigns] = useState<BroadcastCampaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [openForm, setOpenForm] = useState(false);
  const [form, setForm] = useState({ name: '', device_id: '', content: '' });
  const [devices, setDevices] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: '', type: 'info' as 'success' | 'error' | 'info' });

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(API_BASE + '/broadcast/campaigns');
      setCampaigns(res.data.data || []);
    } catch (error: any) {
      setMessage({ text: error.response?.data?.error || 'Gagal memuat kampanye.', type: 'error' });
    } finally { setLoading(false); }
  }, []);

  const loadDevices = useCallback(async () => {
    try {
      const res = await axios.get(DEVICES_API_BASE + '/devices');
      setDevices(res.data.data || []);
    } catch (error: any) {
      console.error('Failed to load devices:', error);
    }
  }, []);

  useEffect(() => { loadCampaigns(); loadDevices(); }, [loadCampaigns, loadDevices]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await axios.post(API_BASE + '/broadcast/campaigns', {
        name: form.name.trim(), device_id: form.device_id, content: form.content.trim(),
      });
      setMessage({ text: 'Kampanye berhasil dibuat.', type: 'success' });
      setForm({ name: '', device_id: '', content: '' });
      setOpenForm(false);
      await loadCampaigns();
    } catch (error: any) {
      setMessage({ text: error.response?.data?.error || 'Gagal membuat kampanye.', type: 'error' });
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Yakin ingin menghapus kampanye ini?')) return;
    try {
      await axios.delete(API_BASE + '/broadcast/campaigns/' + id);
      setMessage({ text: 'Kampanye berhasil dihapus.', type: 'success' });
      await loadCampaigns();
    } catch (error: any) {
      setMessage({ text: error.response?.data?.error || 'Gagal menghapus kampanye.', type: 'error' });
    }
  };

  const handlePrepare = async (id: string) => {
    if (!window.confirm('Siapkan penerima untuk kampanye ini?')) return;
    try {
      await axios.post(API_BASE + '/broadcast/campaigns/' + id + '/prepare');
      setMessage({ text: 'Penerima kampanye telah disiapkan.', type: 'success' });
      await loadCampaigns();
    } catch (error: any) {
      setMessage({ text: error.response?.data?.error || 'Gagal menyiapkan penerima.', type: 'error' });
    }
  };

  const renderMessage = () => {
    if (!message.text) return null;
    let bgColor = 'bg-blue-50';
    let textColor = 'text-blue-700';
    let borderColor = 'border-blue-200';
    if (message.type === 'success') {
      bgColor = 'bg-green-50';
      textColor = 'text-green-700';
      borderColor = 'border-green-200';
    } else if (message.type === 'error') {
      bgColor = 'bg-red-50';
      textColor = 'text-red-700';
      borderColor = 'border-red-200';
    }
    return (
      <div className={'mb-4 p-3 rounded-lg text-sm ' + bgColor + ' ' + textColor + ' ' + borderColor}>
        {message.text}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Broadcast</h2>
          <p className="text-sm text-gray-500">Kirim pesan massal ke kontak yang telah memberikan consent.</p>
        </div>
        <button onClick={() => setOpenForm(true)} className="inline-flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 disabled:opacity-50" disabled={loading}>
          <Plus className="w-4 h-4" /> Kampanye Baru
        </button>
      </div>

      {renderMessage()}

      <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Cari nama kampanye..." className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Nama Kampanye</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Device</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Penerima</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Dibuat</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 w-40">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {campaigns.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-gray-500">{loading ? 'Memuat kampanye...' : 'Belum ada kampanye broadcast.'}</td></tr>
              ) : (
                campaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{c.device_id}</td>
                    <td className="px-4 py-3">
                      <span className={'inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ' + (c.status === 'completed' ? 'bg-green-100 text-green-800' : c.status === 'draft' ? 'bg-gray-100 text-gray-800' : c.status === 'ready' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800')}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">{c.recipient_count}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{new Date(c.created_at).toLocaleDateString('id-ID')}</td>
                    <td className="px-4 py-3 text-right">
                      {c.status === 'draft' && (
                        <button onClick={() => handlePrepare(c.id)} className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50" disabled={loading}>
                          Siapkan Penerima
                        </button>
                      )}
                      <button onClick={() => handleDelete(c.id)} className="ml-2 text-xs text-red-600 hover:text-red-700" disabled={loading}>
                        <Trash2 className="w-3 h-3 inline" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {openForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm" onClick={() => setOpenForm(false)} />
          <div className="relative bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-gray-900">Kampanye Broadcast Baru</h3>
              <button onClick={() => setOpenForm(false)} className="text-gray-400 hover:text-gray-600">
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nama Kampanye *</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" placeholder="Contoh: Promo Lebaran 2024" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Device WhatsApp *</label>
                <select value={form.device_id} onChange={(e) => setForm({ ...form, device_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" required>
                  <option value="">Pilih device</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>{d.device_id || 'New Device'} ({d.connection_status || 'unknown'})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Isi Pesan *</label>
                <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })}
                  rows={4} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" placeholder="Ketik pesan broadcast di sini..." required />
                <p className="mt-1 text-xs text-gray-500">Maksimal 4000 karakter. Pesan hanya akan dikirim ke kontak dengan consent aktif.</p>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button type="button" onClick={() => setOpenForm(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium">Batal</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 text-sm font-medium">
                  {saving ? 'Membuat...' : 'Buat Kampanye'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
