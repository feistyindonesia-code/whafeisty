import { FormEvent, useEffect, useState } from 'react';
import { KeyRound, Plus, RefreshCw, Trash2, Webhook } from 'lucide-react';
import axios from 'axios';

const API_BASE = '/api/v1';

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  permissions: string[] | string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used: string | null;
  created_at: string;
}

interface WebhookItem {
  id: string;
  url: string;
  events: string[] | string;
  active: boolean | number;
  created_at: string;
}

interface Props {
  token: string;
  packageInfo: { name: string; device_limit: number; message_limit: number } | null;
  billingOnly?: boolean;
}

function CustomerOperations({ token, packageInfo, billingOnly = false }: Props) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [deviceUsage, setDeviceUsage] = useState<any[]>([]);
  const [messageUsage, setMessageUsage] = useState<any[]>([]);
  const [keyName, setKeyName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['devices:read']);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [webhookEvents, setWebhookEvents] = useState('message.inbound');
  const [oneTimeSecret, setOneTimeSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  const loadIntegrations = async () => {
    const [keyResponse, webhookResponse] = await Promise.all([
      axios.get(`${API_BASE}/users/api-keys`, { headers }),
      axios.get(`${API_BASE}/webhooks`, { headers }),
    ]);
    setKeys(keyResponse.data.data || []);
    setWebhooks(webhookResponse.data.data || []);
  };

  const loadBilling = async () => {
    const [paymentResponse, subscriptionResponse, deviceResponse, messageResponse] = await Promise.all([
      axios.get(`${API_BASE}/payments/me`, { headers }),
      axios.get(`${API_BASE}/subscriptions/me`, { headers }),
      axios.get(`${API_BASE}/usage/devices`, { headers }),
      axios.get(`${API_BASE}/usage/messages`, { headers }),
    ]);
    setPayments(paymentResponse.data.data || []);
    setSubscriptions(subscriptionResponse.data.data || []);
    setDeviceUsage(deviceResponse.data.data || []);
    setMessageUsage(messageResponse.data.data || []);
  };

  useEffect(() => {
    if (!token) return;
    const load = billingOnly ? loadBilling() : loadIntegrations();
    load.catch((error) => {
      console.error('Customer workspace data failed to load:', error);
    });
  }, [token, billingOnly]);

  const createKey = async (event: FormEvent) => {
    event.preventDefault();
    if (!keyName.trim()) return;
    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE}/users/api-keys`, {
        name: keyName.trim(),
        scopes: selectedScopes,
        expires_at: null,
      }, { headers });
      setOneTimeSecret(response.data.data.secret);
      setKeyName('');
      await loadIntegrations();
    } catch (error: any) {
      alert(error.response?.data?.error || 'API key tidak dapat dibuat.');
    } finally {
      setLoading(false);
    }
  };

  const rotateKey = async (key: ApiKey) => {
    if (!confirm(`Rotasi API key "${key.name}"? Secret lama akan langsung tidak berlaku.`)) return;
    try {
      const response = await axios.post(`${API_BASE}/users/api-keys/${key.id}/rotate`, {}, { headers });
      setOneTimeSecret(response.data.data.secret);
      await loadIntegrations();
    } catch (error: any) {
      alert(error.response?.data?.error || 'API key tidak dapat dirotasi.');
    }
  };

  const revokeKey = async (key: ApiKey) => {
    if (!confirm(`Cabut API key "${key.name}"? Tindakan ini tidak dapat dibatalkan.`)) return;
    try {
      await axios.delete(`${API_BASE}/users/api-keys/${key.id}`, { headers });
      await loadIntegrations();
    } catch (error: any) {
      alert(error.response?.data?.error || 'API key tidak dapat dicabut.');
    }
  };

  const createWebhook = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      await axios.post(`${API_BASE}/webhooks`, {
        url: webhookUrl.trim(),
        events: webhookEvents.split(',').map((item) => item.trim()).filter(Boolean),
        secret: webhookSecret || undefined,
      }, { headers });
      setWebhookUrl('');
      setWebhookSecret('');
      await loadIntegrations();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Webhook tidak dapat dibuat.');
    } finally {
      setLoading(false);
    }
  };

  const deleteWebhook = async (webhook: WebhookItem) => {
    if (!confirm(`Hapus webhook ${webhook.url}?`)) return;
    try {
      await axios.delete(`${API_BASE}/webhooks/${webhook.id}`, { headers });
      await loadIntegrations();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Webhook tidak dapat dihapus.');
    }
  };

  const toggleScope = (scope: string) => {
    setSelectedScopes((current) => current.includes(scope)
      ? current.filter((item) => item !== scope)
      : [...current, scope]);
  };

  const formatJsonList = (value: string[] | string) => {
    if (Array.isArray(value)) return value.join(', ');
    try {
      const parsed = JSON.parse(value || '[]');
      return Array.isArray(parsed) ? parsed.join(', ') : String(value);
    } catch {
      return value;
    }
  };

  if (!billingOnly) {
    return (
      <section className="space-y-6">
        {oneTimeSecret && (
          <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-5">
            <h3 className="font-semibold text-amber-900">Salin secret sekarang</h3>
            <p className="mt-1 text-sm text-amber-800">Secret hanya ditampilkan sekali. Simpan di password manager atau secret store, jangan masukkan ke repository/log.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <code className="flex-1 break-all rounded-lg bg-white p-3 text-sm">{oneTimeSecret}</code>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(oneTimeSecret).then(() => alert('Secret disalin.')).catch(() => alert('Gagal menyalin secret.'))}
                className="rounded-lg bg-amber-700 px-4 py-2 text-white"
              >
                Salin
              </button>
              <button type="button" onClick={() => setOneTimeSecret('')} className="rounded-lg border px-4 py-2">Tutup</button>
            </div>
          </div>
        )}

        <section className="rounded-xl bg-white p-5 shadow-sm md:p-6">
          <div className="mb-5 flex items-center gap-3">
            <KeyRound className="h-6 w-6 text-primary-600" />
            <div>
              <h2 className="text-lg font-semibold">API keys</h2>
              <p className="text-sm text-gray-500">Buat kredensial integrasi dengan hak akses minimum yang diperlukan.</p>
            </div>
          </div>
          <form onSubmit={createKey} className="mb-6 grid gap-3 md:grid-cols-[1fr_auto]">
            <input
              value={keyName}
              onChange={(event) => setKeyName(event.target.value)}
              maxLength={100}
              required
              placeholder="Nama key, misalnya CRM production"
              className="rounded-lg border px-3 py-2"
            />
            <button disabled={loading || selectedScopes.length === 0} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white disabled:opacity-50">
              <Plus className="h-4 w-4" /> Buat key
            </button>
            <div className="flex flex-wrap gap-4 text-sm text-gray-700 md:col-span-2">
              {['devices:read', 'messages:read', 'messages:send'].map((scope) => (
                <label key={scope} className="flex items-center gap-2">
                  <input type="checkbox" checked={selectedScopes.includes(scope)} onChange={() => toggleScope(scope)} />
                  {scope}
                </label>
              ))}
            </div>
          </form>
          <div className="space-y-3">
            {keys.length === 0 && <p className="text-sm text-gray-500">Belum ada API key.</p>}
            {keys.map((key) => (
              <div key={key.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">{key.name}</p>
                  <p className="break-all text-xs text-gray-500">{key.key_prefix} · {formatJsonList(key.permissions)}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Terakhir dipakai: {key.last_used ? new Date(key.last_used).toLocaleString() : 'Belum pernah'} ·
                    {' '}Dibuat: {new Date(key.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" onClick={() => rotateKey(key)} title="Rotasi key" className="rounded-lg border p-2 text-gray-600 hover:bg-gray-50"><RefreshCw className="h-4 w-4" /></button>
                  <button type="button" onClick={() => revokeKey(key)} title="Cabut key" className="rounded-lg border p-2 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl bg-white p-5 shadow-sm md:p-6">
          <div className="mb-5 flex items-center gap-3">
            <Webhook className="h-6 w-6 text-primary-600" />
            <div>
              <h2 className="text-lg font-semibold">Webhooks</h2>
              <p className="text-sm text-gray-500">Daftarkan endpoint integrasi dan event yang ingin diterima.</p>
            </div>
          </div>
          <form onSubmit={createWebhook} className="mb-6 grid gap-3 md:grid-cols-2">
            <input type="url" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://example.com/webhook" required className="rounded-lg border px-3 py-2" />
            <input value={webhookEvents} onChange={(event) => setWebhookEvents(event.target.value)} placeholder="message.inbound (pisahkan koma)" required className="rounded-lg border px-3 py-2" />
            <input value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} placeholder="Signing secret (opsional)" className="rounded-lg border px-3 py-2" />
            <button disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white disabled:opacity-50"><Plus className="h-4 w-4" /> Tambah webhook</button>
          </form>
          <div className="space-y-3">
            {webhooks.length === 0 && <p className="text-sm text-gray-500">Belum ada webhook.</p>}
            {webhooks.map((webhook) => (
              <div key={webhook.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="break-all font-medium text-gray-900">{webhook.url}</p>
                  <p className="text-xs text-gray-500">{formatJsonList(webhook.events)} · {webhook.active ? 'Aktif' : 'Nonaktif'}</p>
                </div>
                <button type="button" onClick={() => deleteWebhook(webhook)} className="inline-flex items-center gap-2 self-start rounded-lg border px-3 py-2 text-sm text-red-600 sm:self-auto">
                  <Trash2 className="h-4 w-4" /> Hapus
                </button>
              </div>
            ))}
          </div>
        </section>
      </section>
    );
  }

  const deviceLimit = Number(packageInfo?.device_limit || 0);
  const devicePercent = deviceLimit ? Math.min(100, (deviceUsage.length / deviceLimit) * 100) : 0;
  const messageLimit = Number(packageInfo?.message_limit || 0);
  const currentMonth = new Date();
  const monthlyMessages = messageUsage.filter((item) => {
    const created = new Date(item.created_at);
    return created.getMonth() === currentMonth.getMonth() && created.getFullYear() === currentMonth.getFullYear();
  }).length;
  const messagePercent = messageLimit ? Math.min(100, (monthlyMessages / messageLimit) * 100) : 0;

  return (
    <section className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Penggunaan device</h2><span className="text-sm text-gray-500">{deviceUsage.length}/{deviceLimit || '—'}</span></div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-primary-600" style={{ width: `${devicePercent}%` }} /></div>
          <p className="mt-2 text-xs text-gray-500">{devicePercent >= 100 ? 'Batas paket tercapai' : 'Pemakaian sesuai paket aktif'}</p>
        </div>
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Aktivitas pesan bulan ini</h2><span className="text-sm text-gray-500">{monthlyMessages}/{messageLimit || '∞'}</span></div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${messagePercent}%` }} /></div>
          <p className="mt-2 text-xs text-gray-500">Dihitung dari pesan dalam riwayat yang tersedia.</p>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="border-b p-5"><h2 className="font-semibold">Riwayat pembayaran</h2><p className="text-sm text-gray-500">Status dan waktu transaksi akun Anda.</p></div>
        {payments.length === 0 ? <p className="p-5 text-sm text-gray-500">Belum ada riwayat pembayaran.</p> : (
          <div className="divide-y">
            {payments.map((payment) => (
              <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 p-5 text-sm">
                <div><p className="font-medium">{payment.package_name || `Paket ${payment.package_id}`}</p><p className="text-gray-500">{new Date(payment.created_at).toLocaleString()}</p></div>
                <div className="text-right"><p>Rp {Number(payment.amount).toLocaleString('id-ID')}</p><p className="capitalize text-gray-500">{payment.status}</p></div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="border-b p-5"><h2 className="font-semibold">Riwayat langganan</h2><p className="text-sm text-gray-500">Paket, status, dan periode berlangganan.</p></div>
        {subscriptions.length === 0 ? <p className="p-5 text-sm text-gray-500">Belum ada langganan.</p> : (
          <div className="divide-y">
            {subscriptions.map((subscription) => (
              <div key={subscription.id} className="flex flex-wrap items-center justify-between gap-2 p-5 text-sm">
                <div><p className="font-medium">{subscription.package_name || `Paket ${subscription.package_id}`}</p><p className="text-gray-500">{subscription.start_date ? new Date(subscription.start_date).toLocaleDateString() : 'Belum dimulai'} – {subscription.end_date ? new Date(subscription.end_date).toLocaleDateString() : '—'}</p></div>
                <span className="rounded-full bg-gray-100 px-3 py-1 capitalize">{subscription.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="text-right">
        <a href="/packages" className="inline-flex rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">Lihat pilihan paket</a>
      </div>
    </section>
  );
}

export default CustomerOperations;
