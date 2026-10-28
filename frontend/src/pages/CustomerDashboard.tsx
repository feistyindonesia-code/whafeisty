import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Smartphone, MessageSquare, Plus, Trash2, LayoutDashboard, ShieldCheck, Plug, Receipt, BookOpen, Bot, Briefcase, LifeBuoy, Megaphone, Users, Zap, Key, Lock, User } from 'lucide-react';
import axios from 'axios';
import io from 'socket.io-client';
import WorkspaceShell, { WorkspaceNavItem } from '../components/WorkspaceShell';
import CustomerOperations from '../components/CustomerOperations';

const API_BASE = '/api/v1';

interface Device {
  id: string;
  device_id: string;
  status: string;
  connection_status: string;
  last_seen: string | null;
  created_at: string;
}

interface Message {
  id: string;
  to_number: string;
  from_number?: string;
  content: string;
  status: string;
  direction: string;
  created_at: string;
}

interface Package {
  id: string;
  name: string;
  price: number;
  device_limit: number;
  message_limit: number;
  duration_type?: string;
  duration_value?: number;
  description?: string;
}

interface ContactConsent {
  phone_number: string;
  status: 'opted_in' | 'opted_out';
  purpose: string | null;
  consent_source: string;
  evidence: string;
  consented_at: string | null;
  revoked_at: string | null;
}

interface SendingSafetyState {
  consecutive_failures: number;
  paused_until: string | null;
  pause_reason: string | null;
  contact_daily_limit: number;
  contact_weekly_limit: number;
}

function CustomerDashboard() {
  const navigate = useNavigate();
  const { section: routeSection } = useParams<{ section?: string }>();
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState({ to_number: '', content: '' });
  const [loading, setLoading] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [packageInfo, setPackageInfo] = useState<Package | null>(null);
  const [subscription, setSubscription] = useState<any>(null);
  const [pendingSubscription, setPendingSubscription] = useState<any>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(true);
  const [subscriptionError, setSubscriptionError] = useState('');
  const [consents, setConsents] = useState<ContactConsent[]>([]);
  const [safetyState, setSafetyState] = useState<SendingSafetyState | null>(null);
  const [consentForm, setConsentForm] = useState({ phone_number: '', purpose: '', source: '', evidence: '' });
  const [savingConsent, setSavingConsent] = useState(false);
  const activeSection = routeSection || 'overview';

  // Profile state
  const [profileData, setProfileData] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: '', email: '' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState({ text: '', type: 'info' as 'success' | 'error' | 'info' });

  // Password change state
  const [passwordForm, setPasswordForm] = useState({ current_password: '', new_password: '' });
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState({ text: '', type: 'info' as 'success' | 'error' | 'info' });

  const token = localStorage.getItem('token');
  const navigationItems: WorkspaceNavItem[] = [
    { id: 'overview', label: 'Ringkasan', icon: <LayoutDashboard className="h-5 w-5" /> },
    { id: 'devices', label: 'Perangkat', shortLabel: 'Device', icon: <Smartphone className="h-5 w-5" /> },
    { id: 'messages', label: 'Pesan', icon: <MessageSquare className="h-5 w-5" /> },
    { id: 'consent', label: 'Kontak & consent', shortLabel: 'Kontak', icon: <ShieldCheck className="h-5 w-5" /> },
    { id: 'integrations', label: 'API & integrasi', shortLabel: 'API', icon: <Plug className="h-5 w-5" /> },
    { id: 'billing', label: 'Paket & tagihan', shortLabel: 'Tagihan', icon: <Receipt className="h-5 w-5" /> },
    { id: 'api-docs', label: 'Docs API', shortLabel: 'Docs', icon: <BookOpen className="h-5 w-5" /> },
    { id: 'crm', label: 'CRM', icon: <Users className="h-5 w-5" /> },
    { id: 'broadcast', label: 'Broadcast', icon: <Megaphone className="h-5 w-5" /> },
    { id: 'automessage', label: 'Automessage', shortLabel: 'Auto', icon: <Bot className="h-5 w-5" /> },
    { id: 'customer-service', label: 'Customer Service', shortLabel: 'CS', icon: <LifeBuoy className="h-5 w-5" /> },
    { id: 'advertising', label: 'Advertising', icon: <Zap className="h-5 w-5" /> },
    { id: 'professional', label: 'Professional', icon: <Briefcase className="h-5 w-5" /> },
    { id: 'profile', label: 'Profil & Pengaturan', shortLabel: 'Profil', icon: <User className="h-5 w-5" /> },
  ];

  const navigateSection = (id: string) => {
    if (['overview', 'devices', 'messages', 'consent', 'integrations', 'billing', 'profile'].includes(id)) {
      navigate(id === 'overview' ? '/dashboard' : `/dashboard/${id}`);
    } else if (id === 'customer-service') {
      navigate('/customer-service');
    } else {
      navigate(`/dashboard/features/${id}`);
    }
  };

  useEffect(() => {
    if (!token) {
      window.location.href = '/login';
      return;
    }
    fetchSubscription();
    fetchProfile();
  }, [token]);

  const fetchProfile = async () => {
    setProfileLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setProfileData(res.data.data);
      setProfileForm({ name: res.data.data.name || '', email: res.data.data.email || '' });
    } catch (error: any) {
      console.error('Failed to fetch profile:', error);
    } finally {
      setProfileLoading(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileForm.name.trim() || !profileForm.email.trim()) {
      setProfileMessage({ text: 'Nama dan email harus diisi.', type: 'error' });
      return;
    }
    setSavingProfile(true);
    try {
      const res = await axios.put(`${API_BASE}/users/me`, {
        name: profileForm.name.trim(),
        email: profileForm.email.trim(),
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setProfileData(res.data.data);
      setProfileMessage({ text: 'Profil berhasil diperbarui.', type: 'success' });
    } catch (error: any) {
      setProfileMessage({ text: error.response?.data?.error || 'Gagal memperbarui profil.', type: 'error' });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordForm.current_password || !passwordForm.new_password) {
      setPasswordMessage({ text: 'Password lama dan password baru harus diisi.', type: 'error' });
      return;
    }
    if (passwordForm.new_password.length < 8) {
      setPasswordMessage({ text: 'Password baru minimal 8 karakter.', type: 'error' });
      return;
    }
    setChangingPassword(true);
    try {
      await axios.put(`${API_BASE}/users/password`, {
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setPasswordMessage({ text: 'Password berhasil diubah. Silakan login kembali dengan password baru.', type: 'success' });
      setPasswordForm({ current_password: '', new_password: '' });
    } catch (error: any) {
      setPasswordMessage({ text: error.response?.data?.error || 'Gagal mengubah password.', type: 'error' });
    } finally {
      setChangingPassword(false);
    }
  };

  useEffect(() => {
    if (!token || !selectedDevice) return;

    const socketUrl = import.meta.env.DEV ? 'http://localhost:4000' : window.location.origin;
    const socket = io(socketUrl, {
      auth: { token },
    });

    socket.on('connect', () => {
      socket.emit('device.subscribe', selectedDevice.id);
    });

    socket.on('message.inbound', (message: Message) => {
      setMessages(prev => [message, ...prev]);
    });

    socket.on('device.connected', () => {
      fetchDevices();
    });

    return () => {
      socket.emit('device.unsubscribe', selectedDevice.id);
      socket.disconnect();
    };
  }, [token, selectedDevice]);

  const fetchDevices = async () => {
    try {
      const res = await axios.get(`${API_BASE}/devices`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setDevices(res.data.data || []);
    } catch (error) {
      console.error('Error fetching devices:', error);
    }
  };

  const fetchSubscription = async () => {
    setSubscriptionError('');
    try {
      const res = await axios.get(`${API_BASE}/packages/me/active`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSubscription(res.data.data);
      if (res.data.data) {
        setPendingSubscription(null);
        const pkgRes = await axios.get(`${API_BASE}/packages/${res.data.data.package_id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setPackageInfo(pkgRes.data.data);
        await Promise.all([fetchDevices(), fetchCompliance()]);
      } else {
        setPackageInfo(null);
        setDevices([]);
        const subscriptionsRes = await axios.get(`${API_BASE}/subscriptions/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const pending = (subscriptionsRes.data.data || []).find((item: any) => item.status === 'pending');
        setPendingSubscription(pending || null);
      }
    } catch (error) {
      console.error('Error fetching subscription:', error);
      setSubscriptionError('Status paket tidak dapat dimuat dari server. Coba lagi; jika berlanjut, periksa log backend dan status migration database.');
    } finally {
      setSubscriptionLoading(false);
    }
  };

  const fetchCompliance = async () => {
    try {
      const [consentResponse, safetyResponse] = await Promise.all([
        axios.get(`${API_BASE}/contacts/consents`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`${API_BASE}/messages/safety`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      setConsents(consentResponse.data.data || []);
      setSafetyState(safetyResponse.data.data);
    } catch (error) {
      console.error('Error fetching contact consent and safety settings:', error);
    }
  };

  const recordConsent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingConsent(true);
    try {
      await axios.post(`${API_BASE}/contacts/consents`, consentForm, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setConsentForm({ phone_number: '', purpose: '', source: '', evidence: '' });
      await fetchCompliance();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Gagal mencatat persetujuan kontak.');
    } finally {
      setSavingConsent(false);
    }
  };

  const revokeConsent = async (phoneNumber: string) => {
    if (!confirm(`Cabut izin dan blokir pengiriman ke ${phoneNumber}?`)) return;
    try {
      await axios.post(`${API_BASE}/contacts/consents/revoke`, { phone_number: phoneNumber }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchCompliance();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Gagal mencabut persetujuan kontak.');
    }
  };

  const resumeSending = async () => {
    if (!confirm('Pastikan masalah koneksi/provider sudah diperiksa. Lanjutkan pengiriman?')) return;
    try {
      await axios.post(`${API_BASE}/messages/safety/resume`, { confirmed: true }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchCompliance();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Gagal melanjutkan pengiriman.');
    }
  };

  const createDevice = async () => {
    try {
      setLoading(true);
      const res = await axios.post(
        `${API_BASE}/devices`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setDevices([...devices, res.data.data]);
    } catch (error: any) {
      console.error('Error creating device:', error);
      alert(error.response?.data?.error || 'Failed to create device');
    } finally {
      setLoading(false);
    }
  };

  const getQRCode = async (deviceId: string) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const res = await axios.get(`${API_BASE}/devices/${deviceId}/qrcode`, {
        headers: { Authorization: `Bearer ${token}` },
      });
        setQrCode(res.data.data.qr);
        return;
      } catch (error: any) {
        if (error.response?.status !== 409 || attempt === 9) {
          console.error('Error fetching QR code:', error);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  };

  const deleteDevice = async (deviceId: string) => {
    if (!confirm('Are you sure you want to disconnect this device?')) return;

    try {
      await axios.delete(`${API_BASE}/devices/${deviceId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setDevices(devices.filter(d => d.id !== deviceId));
      if (selectedDevice?.id === deviceId) {
        setSelectedDevice(null);
        setMessages([]);
      }
    } catch (error) {
      console.error('Error deleting device:', error);
    }
  };

  const fetchMessages = async () => {
    if (!selectedDevice) return;
    try {
      const res = await axios.get(`${API_BASE}/messages/${selectedDevice.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setMessages(res.data.data || []);
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  useEffect(() => {
    if (selectedDevice) {
      fetchMessages();
    }
  }, [selectedDevice]);

  const sendMessage = async () => {
    if (!selectedDevice || !newMessage.to_number.trim() || !newMessage.content.trim() || sendingMessage) return;

    try {
      setSendingMessage(true);
      await axios.post(
        `${API_BASE}/messages`,
        {
          device_id: selectedDevice.id,
          to_number: newMessage.to_number,
          content: newMessage.content,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setNewMessage({ to_number: '', content: '' });
      fetchMessages();
    } catch (error: any) {
      console.error('Error sending message:', error);
      alert(error.response?.data?.error || 'Gagal mengirim pesan. Periksa koneksi device dan coba lagi.');
    } finally {
      setSendingMessage(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
  };

  if (subscriptionLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-600">
        Memuat status langganan...
      </div>
    );
  }

  if (subscriptionError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div role="alert" className="w-full max-w-lg rounded-xl border border-red-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-red-800">Gagal memuat status paket</h1>
          <p className="mt-2 text-sm text-gray-600">{subscriptionError}</p>
          <button
            type="button"
            onClick={() => { setSubscriptionLoading(true); void fetchSubscription(); }}
            className="mt-4 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white"
          >
            Coba lagi
          </button>
        </div>
      </div>
    );
  }

  if (!subscription) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">
            {pendingSubscription ? 'Langganan menunggu aktivasi' : 'Belum ada langganan aktif'}
          </h1>
          <p className="text-gray-600 mb-4">
            {pendingSubscription
              ? 'Langganan Anda masih menunggu pembayaran diverifikasi. Setelah disetujui, dashboard akan terbuka.'
              : 'Pilih paket untuk memulai langganan dan kirim bukti pembayarannya.'}
          </p>
          <a
            href={pendingSubscription
              ? `/checkout?package_id=${encodeURIComponent(pendingSubscription.package_id)}`
              : '/packages'}
            className="block w-full bg-primary-600 text-white py-2 rounded-lg text-center hover:bg-primary-700"
          >
            {pendingSubscription ? 'Lanjutkan pembayaran' : 'Lihat Paket'}
          </a>
        </div>
      </div>
    );
  }

  return (
    <WorkspaceShell
      title="Workspace Customer"
      subtitle="Kelola perangkat, pesan, kontak, integrasi, dan langganan"
      items={navigationItems}
      activeItem={activeSection}
      onNavigate={navigateSection}
      onLogout={handleLogout}
    >
      {activeSection === 'overview' && <div id="overview" className="scroll-mt-24">
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-2">Subscription: {packageInfo?.name}</h2>
          <p className="text-gray-600">Price: Rp {packageInfo?.price} | Devices: {devices.length}/{packageInfo?.device_limit}</p>
          <p className="text-sm text-gray-500">Duration: {packageInfo?.duration_value} {packageInfo?.duration_type} | Status: {subscription?.status}</p>
        </div>
      </div>}

        {activeSection === 'consent' && <section id="consent" className="scroll-mt-24 bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
            <div>
              <h2 className="text-lg font-semibold">Consent & keamanan pengiriman</h2>
              <p className="text-sm text-gray-600 mt-1">
                Pesan hanya dapat dikirim ke kontak dengan persetujuan aktif yang dapat dibuktikan.
                Jangan catat persetujuan tanpa izin nyata dari penerima.
              </p>
            </div>
            {safetyState && (
              <div className="text-sm text-gray-700">
                <p>Batas per kontak: {safetyState.contact_daily_limit}/24 jam, {safetyState.contact_weekly_limit}/7 hari</p>
                {safetyState.paused_until && new Date(safetyState.paused_until) > new Date() && (
                  <div className="mt-2 text-amber-700">
                    <p>Pengiriman dijeda sampai {new Date(safetyState.paused_until).toLocaleString()}</p>
                    <p>{safetyState.pause_reason}</p>
                    <button onClick={resumeSending} className="underline mt-1">Lanjutkan setelah diperiksa</button>
                  </div>
                )}
              </div>
            )}
          </div>

          <form onSubmit={recordConsent} className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
            <input
              required
              type="tel"
              value={consentForm.phone_number}
              onChange={(event) => setConsentForm({ ...consentForm, phone_number: event.target.value })}
              placeholder="Nomor dengan kode negara, contoh 62812..."
              className="px-3 py-2 border border-gray-300 rounded-lg"
            />
            <input
              required
              value={consentForm.purpose}
              onChange={(event) => setConsentForm({ ...consentForm, purpose: event.target.value })}
              placeholder="Tujuan yang disetujui penerima"
              className="px-3 py-2 border border-gray-300 rounded-lg"
            />
            <input
              required
              value={consentForm.source}
              onChange={(event) => setConsentForm({ ...consentForm, source: event.target.value })}
              placeholder="Sumber persetujuan (formulir, toko, dll.)"
              className="px-3 py-2 border border-gray-300 rounded-lg"
            />
            <input
              required
              value={consentForm.evidence}
              onChange={(event) => setConsentForm({ ...consentForm, evidence: event.target.value })}
              placeholder="Referensi bukti nyata, misalnya ID formulir dan waktu"
              className="px-3 py-2 border border-gray-300 rounded-lg"
            />
            <button
              type="submit"
              disabled={savingConsent}
              className="md:col-span-2 justify-self-start bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              {savingConsent ? 'Menyimpan...' : 'Catat persetujuan kontak'}
            </button>
          </form>

          <div className="overflow-x-auto">
            {consents.length === 0 ? (
              <p className="py-4 text-center text-gray-500">Belum ada catatan persetujuan. Pengiriman akan diblokir sampai persetujuan dicatat.</p>
            ) : (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-4">Nomor</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Tujuan</th>
                    <th className="py-2 pr-4">Sumber & bukti</th>
                    <th className="py-2">Tindakan</th>
                  </tr>
                </thead>
                <tbody>
                  {consents.map((consent) => (
                    <tr key={consent.phone_number} className="border-b last:border-0">
                      <td className="py-3 pr-4">{consent.phone_number}</td>
                      <td className={`py-3 pr-4 ${consent.status === 'opted_in' ? 'text-green-700' : 'text-red-700'}`}>
                        {consent.status === 'opted_in' ? 'Diizinkan' : 'Opt-out'}
                      </td>
                      <td className="py-3 pr-4">{consent.purpose || '-'}</td>
                      <td className="py-3 pr-4">{consent.consent_source}: {consent.evidence}</td>
                      <td className="py-3">
                        {consent.status === 'opted_in' && (
                          <button onClick={() => revokeConsent(consent.phone_number)} className="text-red-600 hover:underline">
                            Cabut izin
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>}

        {(activeSection === 'devices' || activeSection === 'messages') && <div id="devices" className={`scroll-mt-24 grid grid-cols-1 ${activeSection === 'devices' ? 'lg:grid-cols-3' : ''} gap-6`}>
          {activeSection === 'devices' && <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold flex items-center">
                  <Smartphone className="w-5 h-5 mr-2" />
                  Devices
                </h2>
                <button
                  onClick={createDevice}
                  disabled={loading || devices.length >= (packageInfo?.device_limit || 5)}
                  className="bg-primary-600 text-white p-2 rounded-lg hover:bg-primary-700 disabled:opacity-50"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-gray-500 mb-4">{devices.length}/{packageInfo?.device_limit || 5} devices</p>
              <div className="space-y-2">
                {devices.map((device) => (
                  <div
                    key={device.id}
                    onClick={() => setSelectedDevice(device)}
                    className={`p-4 rounded-lg border-2 cursor-pointer transition ${
                      selectedDevice?.id === device.id ? 'border-primary-600 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900">{device.device_id || 'New Device'}</p>
                        <p className="text-sm text-gray-500">{device.status}</p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteDevice(device.id); }}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {device.connection_status === 'disconnected' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); getQRCode(device.id); }}
                        className="mt-2 text-sm text-primary-600 hover:text-primary-700"
                      >
                        Show QR Code
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>}

          {activeSection === 'messages' && <div id="messages" className="scroll-mt-24">
            {selectedDevice ? (
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold mb-4">Messages - {selectedDevice.device_id || 'New Device'}</h2>
                <div className="mb-4">
                  <input
                    type="text"
                    placeholder="Phone number"
                    value={newMessage.to_number}
                    onChange={(e) => setNewMessage({ ...newMessage, to_number: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg mb-2"
                  />
                  <textarea
                    placeholder="Message content"
                    value={newMessage.content}
                    onChange={(e) => setNewMessage({ ...newMessage, content: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg mb-2"
                    rows={3}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={sendingMessage || !newMessage.to_number.trim() || !newMessage.content.trim() || selectedDevice.connection_status !== 'connected'}
                    className="bg-primary-600 text-white px-6 py-2 rounded-lg hover:bg-primary-700 disabled:opacity-50"
                  >
                    {sendingMessage ? 'Sending...' : selectedDevice.connection_status === 'connected' ? 'Send Message' : 'Connect device to send'}
                  </button>
                </div>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {messages.map((msg) => (
                    <div key={msg.id} className={`p-4 rounded-lg ${msg.direction === 'outbound' ? 'bg-primary-50 ml-8' : 'bg-gray-100 mr-8'}`}>
                      <p className="text-sm text-gray-600">{msg.direction === 'outbound' ? 'To' : 'From'}: {msg.to_number || msg.from_number}</p>
                      <p className="text-gray-900">{msg.content}</p>
                      <p className="text-xs text-gray-500 mt-1">{new Date(msg.created_at).toLocaleString()} - {msg.status}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow p-12 text-center">
                <Smartphone className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-gray-900 mb-2">No Device Selected</h2>
                <p className="text-gray-600">Select a device from the sidebar or create a new one</p>
              </div>
            )}
          </div>}
        </div>}

      {activeSection === 'integrations' && <div id="integrations" className="scroll-mt-24 mb-6">
        <CustomerOperations token={token || ''} packageInfo={packageInfo} />
      </div>}

      {activeSection === 'billing' && <div id="billing" className="scroll-mt-24">
        <CustomerOperations token={token || ''} packageInfo={packageInfo} billingOnly />
      </div>}

      {activeSection === 'profile' && (
        <section id="profile" className="scroll-mt-24 space-y-6">
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Informasi Akun</h2>
            {profileLoading ? (
              <div className="flex items-center justify-center py-8 text-gray-500">Memuat profil...</div>
            ) : profileData ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                  <p className="text-sm text-gray-500 uppercase tracking-wider">Nama</p>
                  <p className="font-medium text-gray-900">{profileData.name || 'Tanpa nama'}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                  <p className="text-sm text-gray-500 uppercase tracking-wider">Email</p>
                  <p className="font-medium text-gray-900 break-all">{profileData.email}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                  <p className="text-sm text-gray-500 uppercase tracking-wider">Role</p>
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-100 text-blue-800 text-xs font-medium">
                    {profileData.role === 'superadmin' ? 'SuperAdmin' : 'Customer'}
                  </span>
                </div>
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                  <p className="text-sm text-gray-500 uppercase tracking-wider">Paket</p>
                  <p className="font-medium text-gray-900">{profileData.package_name || 'Belum ada paket'}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                  <p className="text-sm text-gray-500 uppercase tracking-wider">Status Langganan</p>
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                    profileData.subscription_status === 'active' ? 'bg-green-100 text-green-800' :
                    profileData.subscription_status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                    profileData.subscription_status === 'expired' ? 'bg-red-100 text-red-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {profileData.subscription_status || 'none'}
                  </span>
                </div>
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                  <p className="text-sm text-gray-500 uppercase tracking-wender">Device</p>
                  <p className="font-medium text-gray-900">{profileData.device_count || 0} / {profileData.max_devices || '—'}</p>
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-500 py-8">Data profil tidak tersedia.</div>
            )}
          </div>
                    {/* Update Profile Form */}
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Ubah Profil</h2>
            {profileMessage.text && (
              <div className={`mb-4 p-3 rounded-lg text-sm ${
                profileMessage.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
                'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {profileMessage.text}
              </div>
            )}
            <form onSubmit={handleUpdateProfile} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nama Lengkap</label>
                  <input
                    type="text"
                    value={profileForm.name}
                    onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                    placeholder="Masukkan nama lengkap"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={profileForm.email}
                    onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                    placeholder="Masukkan email"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={savingProfile}
                className="w-full bg-primary-600 text-white py-2 rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {savingProfile ? (
                  <span className="flex items-center gap-1">Menyimpan... <Key className="w-4 h-4" /></span>
                ) : (
                  <span>Simpan Perubahan <Key className="w-4 h-4" /></span>
                )}
              </button>
            </form>
          </div>

          {/* Change Password Form */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Ubah Password</h2>
            {passwordMessage.text && (
              <div className={`mb-4 p-3 rounded-lg text-sm ${
                passwordMessage.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
                'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {passwordMessage.text}
              </div>
            )}
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password Saat Ini</label>
                <input
                  type="password"
                  value={passwordForm.current_password}
                  onChange={(e) => setPasswordForm({ ...passwordForm, current_password: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  placeholder="Masukkan password saat ini"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password Baru</label>
                <input
                  type="password"
                  value={passwordForm.new_password}
                  onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  placeholder="Masukkan password baru (minimal 8 karakter)"
                />
              </div>
              <button
                type="submit"
                disabled={changingPassword}
                className="w-full bg-primary-600 text-white py-2 rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {changingPassword ? (
                  <span className="flex items-center gap-1">Mengubah... <Lock className="w-4 h-4" /></span>
                ) : (
                  <span>Ubah Password <Lock className="w-4 h-4" /></span>
                )}
              </button>
            </form>
          </div>
        </section>
      )}

      {qrCode && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-8 rounded-lg max-w-md">
            <h3 className="text-xl font-semibold mb-4">Scan QR Code</h3>
            <img src={qrCode} alt="QR Code" className="w-full mb-4" />
            <button onClick={() => setQrCode(null)} className="w-full bg-gray-200 text-gray-800 py-2 rounded-lg hover:bg-gray-300">Close</button>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}

export default CustomerDashboard;
