import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import axios from 'axios';

const API_BASE = '/api/v1/features';

interface AdCampaign {
  id: string;
  account_id: string;
  name: string;
  platform: string;
  objective: string;
  landing_url: string | null;
  budget: number;
  status: 'draft' | 'active' | 'paused' | 'completed';
  created_at: string;
}

export default function AdvertisingCampaigns() {
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [openForm, setOpenForm] = useState(false);
  const [, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', platform: 'meta', objective: '', landing_url: '', budget: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: '', type: 'info' as 'success' | 'error' | 'info' });

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(API_BASE + '/advertising/campaigns');
      setCampaigns(res.data.data || []);
    } catch (error: any) {
      setMessage({ text: error.response?.data?.error || 'Gagal memuat kampanye iklan.', type: 'error' });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await axios.post(API_BASE + '/advertising/campaigns', {
        name: form.name.trim(), platform: form.platform, objective: form.objective.trim(),
        landing_url: form.landing_url.trim() || null, budget: Number(form.budget),
      });
      setMessage({ text: 'Kampanye iklan berhasil dibuat.', type: 'success' });
      setForm({ name: '', platform: 'meta', objective: '', landing_url: '', budget: '' });
      setEditingId(null);
      setOpenForm(false);
      await loadCampaigns();
    } catch (error: any) {
      setMessage({ text: error.response?.data?.error || 'Gagal membuat kampanye iklan.', type: 'error' });
    } finally { setSaving(false); }
  };

  const handleUpdateStatus = async (id: string, status: string) => {
    try {
      await axios.patch(API_BASE + '/advertising/campaigns/' + id + '/status', { status });
      setMessage({ text: 'Status kampanye diperbarui.', type: 'success' });
      await loadCampaigns();
    } catch (error: any) {
      setMessage({ text: error.response?.data?.error || 'Gagal memperbarui status.', type: 'error' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Yakin ingin menghapus kampanye ini?')) return;
    try {
      await axios.delete(API_BASE + '/advertising/campaigns/' + id);
      setMessage({ text: 'Kampanye iklan berhasil dihapus.', type: 'success' });
      await loadCampaigns();
    } catch (error: any) {
      setMessage({ text: error.response?.data?.error || 'Gagal menghapus kampanye.', type: 'error' });
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
          <h2 className="text-lg font-bold text-gray-900">Advertising</h2>
          <p className="text-sm text-gray-500">Kelola kampanye promosi di Meta, Google, dan platform lainnya.</p>
        </div>
        <button onClick={() => setOpenForm(true)} className="inline-flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 disabled:opacity-50" disabled={loading}>
          <Plus className="w-4 h-4" /> Kampanye Baru
        </button>
      </div>

      {renderMessage()}

      <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Nama Kampanye</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Platform</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Tujuan</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Anggaran</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Dibuat</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600 w-48">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {campaigns.length === 0 ? (
              <tr><td colSpan={7} className="p-8 text-center text-gray-500">{loading ? 'Memuat kampanye...' : 'Belum ada kampanye iklan.'}</td></tr>
            ) : (
              campaigns.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 capitalize">{c.platform}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{c.objective}</td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">Rp {Number(c.budget).toLocaleString('id-ID')}</td>
                  <td className="px-4 py-3">
                    <span className={'inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ' + (c.status === 'active' ? 'bg-green-100 text-green-800' : c.status === 'paused' ? 'bg-yellow-100 text-yellow-800' : c.status === 'completed' ? 'bg-gray-100 text-gray-800' : 'bg-blue-100 text-blue-800')}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{new Date(c.created_at).toLocaleDateString('id-ID')}</td>
                  <td className="px-4 py-3 text-right">
                    <select value={c.status} onChange={(e) => handleUpdateStatus(c.id, e.target.value)}
                      className="text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none">
                      <option value="draft">Draft</option>
                      <option value="active">Aktif</option>
                      <option value="paused">Jeda</option>
                      <option value="completed">Selesai</option>
                    </select>
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

      {openForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm" onClick={() => setOpenForm(false)} />
          <div className="relative bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-gray-900">Kampanye Iklan Baru</h3>
              <button onClick={() => setOpenForm(false)} className="text-gray-400 hover:text-gray-600">
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nama Kampanye *</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" placeholder="Contoh: Promo Produk Baru" required />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Platform *</label>
                  <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" required>
                    <option value="meta">Meta (Facebook/Instagram)</option>
                    <option value="google">Google Ads</option>
                    <option value="other">Lainnya</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tujuan *</label>
                  <input type="text" value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" placeholder="Contoh: Brand awareness, Konversi" required />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL Halaman Landing</label>
                <input type="url" value={form.landing_url} onChange={(e) => setForm({ ...form, landing_url: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" placeholder="https://contoh.com" />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Anggaran (Rp) *</label>
                  <input type="number" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" placeholder="0" required />
                </div>
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
