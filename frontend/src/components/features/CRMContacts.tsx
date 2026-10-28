import { useEffect, useState, useCallback } from 'react';
import { Plus, Edit, Trash2, Search, Phone } from 'lucide-react';
import axios from 'axios';

const API_BASE = '/api/v1/features';

interface CRMContact {
  id: string;
  phone_number: string;
  name: string | null;
  email: string | null;
  company: string | null;
  tags: string[] | string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export default function CRMContacts() {
  const [contacts, setContacts] = useState<CRMContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [openForm, setOpenForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ phone_number: '', name: '', email: '', company: '', notes: '', tags: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: '', type: 'info' as 'success' | 'error' | 'info' });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(API_BASE + '/crm/contacts', { params: { q: search, limit: 100, offset: 0 } });
      setContacts(res.data.data || []);
    } catch (error: any) {
      setMessage({ text: error.response?.data?.error || 'Gagal memuat kontak.', type: 'error' });
    } finally { setLoading(false); }
  }, [search]);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const tagsArray = form.tags.split(',').map((t) => t.trim()).filter(Boolean);
      await axios.post(API_BASE + '/crm/contacts', {
        phone_number: form.phone_number, name: form.name || null,
        email: form.email || null, company: form.company || null,
        notes: form.notes || null, tags: tagsArray,
      });
      setMessage({ text: 'Kontak berhasil dibuat.', type: 'success' });
      setForm({ phone_number: '', name: '', email: '', company: '', notes: '', tags: '' });
      setOpenForm(false);
      await loadContacts();
    } catch (error: any) {
      setMessage({ text: error.response?.data?.error || 'Gagal membuat kontak.', type: 'error' });
    } finally { setSaving(false); }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    setSaving(true);
    try {
      const tagsArray = form.tags.split(',').map((t) => t.trim()).filter(Boolean);
      await axios.patch(API_BASE + '/crm/contacts/' + editingId, {
        name: form.name || null, email: form.email || null,
        company: form.company || null, notes: form.notes || null, tags: tagsArray,
      });
      setMessage({ text: 'Kontak berhasil diperbarui.', type: 'success' });
      setForm({ phone_number: '', name: '', email: '', company: '', notes: '', tags: '' });
      setEditingId(null);
      setOpenForm(false);
      await loadContacts();
    } catch (error: any) {
      setMessage({ text: error.response?.data?.error || 'Gagal memperbarui kontak.', type: 'error' });
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Yakin ingin menghapus kontak ini?')) return;
    setDeletingId(id);
    try {
      await axios.delete(API_BASE + '/crm/contacts/' + id);
      setMessage({ text: 'Kontak berhasil dihapus.', type: 'success' });
      await loadContacts();
    } catch (error: any) {
      setMessage({ text: error.response?.data?.error || 'Gagal menghapus kontak.', type: 'error' });
    } finally { setDeletingId(null); }
  };

  const handleEdit = (contact: CRMContact) => {
    setEditingId(contact.id);
    setForm({ phone_number: contact.phone_number, name: contact.name || '', email: contact.email || '', company: contact.company || '', notes: contact.notes || '', tags: Array.isArray(contact.tags) ? contact.tags.join(', ') : String(contact.tags || '') });
    setOpenForm(true);
  };

  const renderMessage = () => {
    if (!message.text) return null;
    let bgColor = 'bg-blue-50';
    let textColor = 'text-blue-700';
    let borderColor = 'border-blue-200';
    if (message.type === 'success') { bgColor = 'bg-green-50'; textColor = 'text-green-700'; borderColor = 'border-green-200'; }
    else if (message.type === 'error') { bgColor = 'bg-red-50'; textColor = 'text-red-700'; borderColor = 'border-red-200'; }
    return <div className={'mb-4 p-3 rounded-lg text-sm ' + bgColor + ' ' + textColor + ' ' + borderColor}>{message.text}</div>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Kontak CRM</h2>
          <p className="text-sm text-gray-500">Kelola kontak customer untuk broadcast dan pesan otomatis.</p>
        </div>
        <button onClick={() => { setEditingId(null); setForm({ phone_number: '', name: '', email: '', company: '', notes: '', tags: '' }); setOpenForm(true); }}
          className="inline-flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 disabled:opacity-50" disabled={loading}>
          <Plus className="w-4 h-4" /> Tambah Kontak
        </button>
      </div>

      {renderMessage()}

      <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Cari nama, nomor, email, atau perusahaan..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Nomor Telepon</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Nama</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Perusahaan</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Tags</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Dibuat</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 w-32">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {contacts.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-gray-500">{loading ? 'Memuat kontak...' : 'Belum ada kontak. Klik "Tambah Kontak" untuk memulai.'}</td></tr>
              ) : (
                contacts.map((contact) => (
                  <tr key={contact.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3"><div className="flex items-center gap-2"><Phone className="w-4 h-4 text-gray-400" /><span className="font-medium text-gray-900">{contact.phone_number}</span></div></td>
                    <td className="px-4 py-3">{contact.name || <span className="text-gray-400 italic">Tanpa nama</span>}</td>
                    <td className="px-4 py-3">{contact.email || <span className="text-gray-400 italic">-</span>}</td>
                    <td className="px-4 py-3">{contact.company || <span className="text-gray-400 italic">-</span>}</td>
                    <td className="px-4 py-3">
                      {Array.isArray(contact.tags) && contact.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">{contact.tags.slice(0, 3).map((tag, i) => <span key={i} className="text-xs px-2 py-1 rounded bg-primary-50 text-primary-700 border border-primary-100">{tag}</span>)}{contact.tags.length > 3 && <span className="text-xs text-gray-500">+{contact.tags.length - 3}</span>}</div>
                      ) : <span className="text-gray-400 italic">-</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{new Date(contact.created_at).toLocaleDateString('id-ID')}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleEdit(contact)} className="text-primary-600 hover:text-primary-700 text-sm" disabled={loading || deletingId !== null}><Edit className="w-4 h-4" /> Ubah</button>
                      <button onClick={() => handleDelete(contact.id)} className="ml-4 text-red-600 hover:text-red-700 text-sm" disabled={loading || deletingId === contact.id}>{deletingId === contact.id ? 'Menghapus...' : <Trash2 className="w-4 h-4 inline" />}</button>
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
              <h3 className="text-lg font-bold text-gray-900">{editingId ? 'Ubah Kontak' : 'Tambah Kontak'}</h3>
              <button onClick={() => setOpenForm(false)} className="text-gray-400 hover:text-gray-600"><Trash2 className="w-5 h-5" /></button>
            </div>
            <form onSubmit={editingId ? handleUpdate : handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nomor Telepon *</label>
                <input type="tel" value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" placeholder="08123456789" required />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nama</label>
                  <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" placeholder="Nama lengkap" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" placeholder="email@contoh.com" />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Perusahaan</label>
                  <input type="text" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" placeholder="Nama perusahaan" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tags (pisahkan dengan koma)</label>
                  <input type="text" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" placeholder="vip, lead, kaltim" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Catatan</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" placeholder="Catatan tambahan..." />
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button type="button" onClick={() => setOpenForm(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium">Batal</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 text-sm font-medium">{saving ? 'Menyimpan...' : editingId ? 'Perbarui' : 'Simpan'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
