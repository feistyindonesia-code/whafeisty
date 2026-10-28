import { useState, useCallback } from 'react';
import { Plus, ToggleLeft, ToggleRight, Trash2, Edit } from 'lucide-react';
import axios from 'axios';

const API_BASE = '/api/v1/features';

interface AutomationRule {
  id: string;
  account_id: string;
  name: string;
  trigger_type: string;
  keyword: string | null;
  reply_text: string;
  enabled: boolean | number;
  created_at: string;
  updated_at: string;
}

export default function AutomationRules() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [openForm, setOpenForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', trigger_type: 'keyword', keyword: '', reply_text: '', enabled: true });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: '', type: 'info' as 'success' | 'error' | 'info' });

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(API_BASE + '/automations');
      setRules(res.data.data || []);
    } catch (error: any) {
      setMessage({ text: error.response?.data?.error || 'Gagal memuat aturan otomatis.', type: 'error' });
    } finally { setLoading(false); }
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await axios.post(API_BASE + '/automations', {
        name: form.name.trim(), trigger_type: form.trigger_type,
        keyword: form.keyword.trim() || null, reply_text: form.reply_text.trim(),
        enabled: form.enabled,
      });
      setMessage({ text: 'Aturan otomatis berhasil dibuat.', type: 'success' });
      setForm({ name: '', trigger_type: 'keyword', keyword: '', reply_text: '', enabled: true });
      setEditingId(null);
      setOpenForm(false);
      await loadRules();
    } catch (error: any) {
      setMessage({ text: error.response?.data?.error || 'Gagal membuat aturan otomatis.', type: 'error' });
    } finally { setSaving(false); }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    setSaving(true);
    try {
      await axios.patch(API_BASE + '/automations/' + editingId, {
        name: form.name.trim(), trigger_type: form.trigger_type,
        keyword: form.keyword.trim() || null, reply_text: form.reply_text.trim(),
        enabled: form.enabled,
      });
      setMessage({ text: 'Aturan otomatis berhasil diperbarui.', type: 'success' });
      setForm({ name: '', trigger_type: 'keyword', keyword: '', reply_text: '', enabled: true });
      setEditingId(null);
      setOpenForm(false);
      await loadRules();
    } catch (error: any) {
      setMessage({ text: error.response?.data?.error || 'Gagal memperbarui aturan otomatis.', type: 'error' });
    } finally { setSaving(false); }
  };

  const handleToggle = async (id: string, currentEnabled: boolean | number) => {
    try {
      await axios.patch(API_BASE + '/automations/' + id, { enabled: !currentEnabled ? 1 : 0 });
      await loadRules();
    } catch (error: any) {
      setMessage({ text: error.response?.data?.error || 'Gagal mengubah status aturan.', type: 'error' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Yakin ingin menghapus aturan ini?')) return;
    try {
      await axios.delete(API_BASE + '/automations/' + id);
      setMessage({ text: 'Aturan otomatis berhasil dihapus.', type: 'success' });
      await loadRules();
    } catch (error: any) {
      setMessage({ text: error.response?.data?.error || 'Gagal menghapus aturan otomatis.', type: 'error' });
    }
  };

  const handleEdit = (rule: AutomationRule) => {
    setEditingId(rule.id);
    setForm({ name: rule.name, trigger_type: rule.trigger_type, keyword: rule.keyword || '', reply_text: rule.reply_text, enabled: Boolean(rule.enabled) });
    setOpenForm(true);
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
          <h2 className="text-lg font-bold text-gray-900">Automessage</h2>
          <p className="text-sm text-gray-500">Balasan otomatis berdasarkan kata kunci atau pemicu tertentu.</p>
        </div>
        <button onClick={() => { setEditingId(null); setForm({ name: '', trigger_type: 'keyword', keyword: '', reply_text: '', enabled: true }); setOpenForm(true); }}
          className="inline-flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 disabled:opacity-50" disabled={loading}>
          <Plus className="w-4 h-4" /> Aturan Baru
        </button>
      </div>

      {renderMessage()}

      <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Nama Aturan</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Trigger</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Kata Kunci</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Balasan</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Aktif</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600 w-48">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {rules.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-gray-500">{loading ? 'Memuat aturan...' : 'Belum ada aturan otomatis.'}</td></tr>
            ) : (
              rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3 font-medium text-gray-900">{rule.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 capitalize">{rule.trigger_type}</td>
                  <td className="px-4 py-3 text-sm">{rule.keyword || <span className="text-gray-400 italic">-</span>}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 line-clamp-1">{rule.reply_text}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleToggle(rule.id, rule.enabled)} className={'p-1 rounded-full transition ' + (rule.enabled ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400')} title={rule.enabled ? 'Matikan' : 'Aktifkan'}>
                      {rule.enabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleEdit(rule)} className="text-primary-600 hover:text-primary-700 text-sm mr-3" disabled={loading}>
                      <Edit className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(rule.id)} className="text-red-600 hover:text-red-700 text-sm" disabled={loading}>
                      <Trash2 className="w-4 h-4" />
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
              <h3 className="text-lg font-bold text-gray-900">{editingId ? 'Ubah Aturan' : 'Aturan Otomatis Baru'}</h3>
              <button onClick={() => setOpenForm(false)} className="text-gray-400 hover:text-gray-600">
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={editingId ? handleUpdate : handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nama Aturan *</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" placeholder="Contoh: Balasan Otomatis Halo" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipe Trigger *</label>
                <select value={form.trigger_type} onChange={(e) => setForm({ ...form, trigger_type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" required>
                  <option value="keyword">Kata Kunci</option>
                  <option value="welcome">Pesan Sambutan</option>
                  <option value="away">Pesan Luar Jam</option>
                </select>
              </div>
              {form.trigger_type === 'keyword' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Kata Kunci *</label>
                  <input type="text" value={form.keyword} onChange={(e) => setForm({ ...form, keyword: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" placeholder="Contoh: halo, hi, info" required />
                  <p className="mt-1 text-xs text-gray-500">Balasan akan dikirim ketika customer mengirim kata kunci ini.</p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Balasan *</label>
                <textarea value={form.reply_text} onChange={(e) => setForm({ ...form, reply_text: e.target.value })}
                  rows={4} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" placeholder="Ketik balasan otomatis..." required />
              </div>
              <div className="flex items-center gap-3 pt-4 border-t border-gray-200">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                  <span className="text-sm text-gray-700">Aktifkan aturan ini</span>
                </label>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button type="button" onClick={() => setOpenForm(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium">Batal</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 text-sm font-medium">
                  {saving ? 'Menyimpan...' : editingId ? 'Perbarui' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
