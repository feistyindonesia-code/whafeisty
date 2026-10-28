import { useState, useEffect } from 'react';
import { Users, Package, CreditCard, Check, X, Plus, Edit2, Trash2, Settings, ScrollText, Receipt, LayoutDashboard } from 'lucide-react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import WorkspaceShell, { WorkspaceNavItem } from '../components/WorkspaceShell';

const API_BASE = '/api/v1';

interface Package {
  id: string;
  name: string;
  price: number;
  device_limit: number;
  message_limit: number;
  duration_type?: string;
  duration_value?: number;
  description?: string;
  active: boolean | number | string;
  features?: Record<string, boolean> | string | null;
}

const packageFeatureOptions = [
  ['api_docs', 'Docs API'],
  ['crm', 'CRM'],
  ['broadcast', 'Broadcast'],
  ['automessage', 'Automessage'],
  ['customer_service', 'Customer Service'],
  ['advertising', 'Advertising'],
  ['professional', 'Professional'],
] as const;

const emptyPackageFeatures = Object.fromEntries(packageFeatureOptions.map(([key]) => [key, false]));

interface Payment {
  id: string;
  user_id: string;
  package_id: string;
  amount: number;
  status: string;
  proof_url?: string;
  created_at: string;
  name?: string;
  email?: string;
  package_name?: string;
}

interface Subscription {
  id: string;
  user_id: string;
  package_id: string;
  status: string;
  created_at: string;
  name?: string;
  email?: string;
  package_name?: string;
  payment_verified?: number | boolean;
  has_pending_payment?: number | boolean;
}

function SuperAdminDashboard() {
  const navigate = useNavigate();
  const { section } = useParams<{ section?: string }>();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [activeTab, setActiveTab] = useState<'payments' | 'packages' | 'subscriptions' | 'customers' | 'billing' | 'settings' | 'audit'>('packages');
  const [approvingSubscriptionId, setApprovingSubscriptionId] = useState<string | null>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [paymentHistory, setPaymentHistory] = useState<any[]>([]);
  const [platformSettings, setPlatformSettings] = useState<Record<string, string>>({});
  const [savingSettings, setSavingSettings] = useState(false);
  const [showPackageForm, setShowPackageForm] = useState(false);
  const [editingPackage, setEditingPackage] = useState<Package | null>(null);
    const [packageForm, setPackageForm] = useState({
    name: '',
    price: '',
    device_limit: '',
    message_limit: '',
    duration_type: 'monthly',
    duration_value: '1',
    description: '',
    active: true,
    features: emptyPackageFeatures,
  });

  const token = localStorage.getItem('token');
  const headers = { Authorization: `Bearer ${token}` };
  const navigationItems: WorkspaceNavItem[] = [
    { id: 'packages', label: 'Paket', icon: <Package className="h-5 w-5" /> },
    { id: 'payments', label: 'Pembayaran pending', shortLabel: 'Pending', icon: <CreditCard className="h-5 w-5" /> },
    { id: 'subscriptions', label: 'Langganan pending', shortLabel: 'Langganan', icon: <Users className="h-5 w-5" /> },
    { id: 'customers', label: 'Customer', icon: <LayoutDashboard className="h-5 w-5" /> },
    { id: 'billing', label: 'Riwayat billing', shortLabel: 'Billing', icon: <Receipt className="h-5 w-5" /> },
    { id: 'settings', label: 'Pengaturan lanjutan', shortLabel: 'Settings', icon: <Settings className="h-5 w-5" /> },
    { id: 'audit', label: 'Audit log', shortLabel: 'Audit', icon: <ScrollText className="h-5 w-5" /> },
  ];

  useEffect(() => {
    if (!token) {
      window.location.href = '/superadmin/login';
      return;
    }
    fetchPackages();
    fetchPayments();
    fetchSubscriptions();
    fetchCustomers();
    fetchPaymentHistory();
    fetchAuditLogs();
    fetchPlatformSettings();
  }, [token]);

  const fetchCustomers = async (search = customerSearch) => {
    try {
      const res = await axios.get(`${API_BASE}/users/admin/customers`, {
        headers,
        params: search.trim() ? { q: search.trim() } : undefined,
      });
      setCustomers(res.data.data || []);
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  };

  const fetchPaymentHistory = async () => {
    try {
      const res = await axios.get(`${API_BASE}/payments/admin/history`, { headers });
      setPaymentHistory(res.data.data || []);
    } catch (error) {
      console.error('Error fetching payment history:', error);
    }
  };

  const fetchAuditLogs = async () => {
    try {
      const res = await axios.get(`${API_BASE}/users/admin/audit`, { headers });
      setAuditLogs(res.data.data || []);
    } catch (error) {
      console.error('Error fetching admin audit logs:', error);
    }
  };

  const fetchPlatformSettings = async () => {
    try {
      const res = await axios.get(`${API_BASE}/settings`, { headers });
      setPlatformSettings(res.data.data || {});
    } catch (error) {
      console.error('Error fetching platform settings:', error);
    }
  };

  const navigateSection = (id: string) => {
    setActiveTab(id as typeof activeTab);
    navigate(id === 'packages' ? '/superadmin' : `/superadmin/${id}`);
  };

  useEffect(() => {
    const validSections = ['payments', 'packages', 'subscriptions', 'customers', 'billing', 'settings', 'audit'];
    if (section && validSections.includes(section)) {
      setActiveTab(section as typeof activeTab);
    } else if (!section) {
      setActiveTab('packages');
    } else {
      navigate('/superadmin', { replace: true });
    }
  }, [section, navigate]);

  const savePlatformSettings = async () => {
    setSavingSettings(true);
    try {
      const numericKeys = [
        'contact_daily_message_limit',
        'contact_weekly_message_limit',
        'send_failure_pause_threshold',
        'send_failure_pause_minutes',
      ];
      const settings: Record<string, number | boolean> = Object.fromEntries(
        numericKeys.map((key) => [key, Number(platformSettings[key])])
      );
      settings.customer_registration_enabled = platformSettings.customer_registration_enabled === 'true';
      const response = await axios.put(`${API_BASE}/settings`, { settings }, { headers });
      setPlatformSettings(response.data.data || {});
      await fetchAuditLogs();
      alert('Pengaturan platform berhasil disimpan.');
    } catch (error: any) {
      alert(error.response?.data?.error || 'Pengaturan platform gagal disimpan.');
    } finally {
      setSavingSettings(false);
    }
  };

  const changeCustomerSubscription = async (customer: any, action: 'suspend' | 'reactivate') => {
    const label = action === 'suspend' ? 'menangguhkan' : 'mengaktifkan kembali';
    if (!confirm(`Yakin ${label} langganan ${customer.email}?`)) return;
    try {
      await axios.patch(`${API_BASE}/users/admin/customers/${customer.id}/subscription`, { action }, { headers });
      await Promise.all([fetchCustomers(), fetchAuditLogs()]);
    } catch (error: any) {
      alert(error.response?.data?.error || 'Status langganan tidak dapat diubah.');
    }
  };

  const fetchPayments = async () => {
    try {
      const res = await axios.get(`${API_BASE}/payments/pending`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setPayments(res.data.data || []);
    } catch (error) {
      console.error('Error fetching payments:', error);
    }
  };

  const fetchPackages = async () => {
    try {
      const res = await axios.get(`${API_BASE}/packages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setPackages(res.data.data || []);
    } catch (error) {
      console.error('Error fetching packages:', error);
    }
  };

  const fetchSubscriptions = async () => {
    try {
      const res = await axios.get(`${API_BASE}/subscriptions/pending`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSubscriptions(res.data.data || []);
    } catch (error) {
      console.error('Error fetching subscriptions:', error);
    }
  };

  const handleCreatePackage = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await axios.post(
        `${API_BASE}/packages`,
        {
          name: packageForm.name,
          price: parseFloat(packageForm.price),
          device_limit: parseInt(packageForm.device_limit),
          message_limit: packageForm.message_limit === '~' ? 0 : parseInt(packageForm.message_limit),
          duration_type: packageForm.duration_type,
          duration_value: parseInt(packageForm.duration_value),
          description: packageForm.description,
          active: packageForm.active,
          features: packageForm.features,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setPackageForm({ name: '', price: '', device_limit: '', message_limit: '', duration_type: 'monthly', duration_value: '1', description: '', active: true, features: emptyPackageFeatures });
      setShowPackageForm(false);
      fetchPackages();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to create package');
    }
  };

  const handleUpdatePackage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPackage) return;
    try {
      await axios.put(
        `${API_BASE}/packages/${editingPackage.id}`,
        {
          name: packageForm.name,
          price: parseFloat(packageForm.price),
          device_limit: parseInt(packageForm.device_limit),
          message_limit: packageForm.message_limit === '~' ? 0 : parseInt(packageForm.message_limit),
          duration_type: packageForm.duration_type,
          duration_value: parseInt(packageForm.duration_value),
          description: packageForm.description,
          active: packageForm.active,
          features: packageForm.features,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setEditingPackage(null);
      setPackageForm({ name: '', price: '', device_limit: '', message_limit: '', duration_type: 'monthly', duration_value: '1', description: '', active: true, features: emptyPackageFeatures });
      setShowPackageForm(false);
      fetchPackages();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to update package');
    }
  };

  const handleDeletePackage = async (id: string) => {
    if (!confirm('Are you sure you want to delete this package?')) return;
    try {
      await axios.delete(`${API_BASE}/packages/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchPackages();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to delete package');
    }
  };

  const handleEditPackage = (pkg: Package) => {
    setEditingPackage(pkg);
    setPackageForm({
      name: pkg.name,
      price: pkg.price.toString(),
      device_limit: pkg.device_limit.toString(),
      message_limit: pkg.message_limit === 0 ? '~' : pkg.message_limit.toString(),
      duration_type: pkg.duration_type || 'monthly',
      duration_value: pkg.duration_value?.toString() || '1',
      description: pkg.description || '',
      active: pkg.active === true || pkg.active === 1 || pkg.active === '1',
      features: typeof pkg.features === 'string'
        ? JSON.parse(pkg.features)
        : { ...emptyPackageFeatures, ...(pkg.features || {}) },
    });
    setShowPackageForm(true);
  };

  const approvePayment = async (id: string) => {
    try {
      await axios.post(`${API_BASE}/payments/${id}/approve`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchPayments();
      fetchSubscriptions();
    } catch (error) {
      console.error('Error approving payment:', error);
    }
  };

  const rejectPayment = async (id: string) => {
    try {
      await axios.post(`${API_BASE}/payments/${id}/reject`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchPayments();
    } catch (error) {
      console.error('Error rejecting payment:', error);
    }
  };

  const downloadPaymentProof = async (payment: Payment) => {
    try {
      const response = await axios.get(`${API_BASE}/payments/${payment.id}/proof`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      const extension = payment.proof_url?.split('.').pop() || 'file';
      link.href = url;
      link.download = `payment-${payment.id}.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      console.error('Error downloading payment proof:', error);
      alert('Failed to download payment proof');
    }
  };

  const approveSubscription = async (id: string) => {
    setApprovingSubscriptionId(id);
    try {
      await axios.post(`${API_BASE}/subscriptions/${id}/approve`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await Promise.all([fetchSubscriptions(), fetchPayments()]);
    } catch (error) {
      console.error('Error approving subscription:', error);
      const requestError = error as any;
      if (requestError.response?.status === 409) {
        await Promise.all([fetchSubscriptions(), fetchPayments()]);
      }
      alert(requestError.response?.data?.error || 'Gagal menyetujui langganan.');
    } finally {
      setApprovingSubscriptionId(null);
    }
  };

  const rejectSubscription = async (id: string) => {
    try {
      await axios.post(`${API_BASE}/subscriptions/${id}/reject`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchSubscriptions();
    } catch (error) {
      console.error('Error rejecting subscription:', error);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/superadmin/login';
  };

  return (
    <WorkspaceShell
      title="SuperAdmin"
      subtitle="Kelola customer, billing, paket, dan kebijakan platform"
      items={navigationItems}
      activeItem={activeTab}
      onNavigate={navigateSection}
      onLogout={handleLogout}
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Customer', customers.length],
          ['Pembayaran pending', payments.length],
          ['Langganan pending', subscriptions.length],
          ['Paket aktif', packages.filter((item) => item.active).length],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">{label}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

        {activeTab === 'payments' && (
          <div id="payments" className="rounded-xl bg-white shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Pending Payments</h2>
            </div>
            {payments.length === 0 ? (
              <div className="p-6 text-center text-gray-500">No pending payments</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Package</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Proof</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {payments.map((payment) => (
                      <tr key={payment.id}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div>
                            <div className="text-sm font-medium text-gray-900">{payment.name || 'Unknown'}</div>
                            <div className="text-sm text-gray-500">{payment.email || 'N/A'}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{payment.package_name || 'N/A'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">Rp {payment.amount}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {payment.proof_url ? (
                            <button onClick={() => downloadPaymentProof(payment)} className="text-primary-600 hover:text-primary-700">Download</button>
                          ) : (
                            <span className="text-gray-400">No proof</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <button
                            onClick={() => approvePayment(payment.id)}
                            className="text-green-600 hover:text-green-700 mr-2"
                          >
                            <Check className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => rejectPayment(payment.id)}
                            className="text-red-600 hover:text-red-700"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'packages' && (
          <div id="packages" className="rounded-xl bg-white shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-semibold">Packages</h2>
              <button
                onClick={() => {
                  setEditingPackage(null);
                  setPackageForm({ name: '', price: '', device_limit: '', message_limit: '', duration_type: 'monthly', duration_value: '1', description: '', active: true, features: emptyPackageFeatures });
                  setShowPackageForm(true);
                }}
                className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 flex items-center"
              >
                <Plus className="w-5 h-5 mr-2" />
                Create Package
              </button>
            </div>

            {showPackageForm && (
              <div className="px-6 py-4 border-b bg-gray-50">
                <form onSubmit={editingPackage ? handleUpdatePackage : handleCreatePackage} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <input
                      type="text"
                      placeholder="Package Name"
                      value={packageForm.name}
                      onChange={(e) => setPackageForm({ ...packageForm, name: e.target.value })}
                      className="px-4 py-2 border border-gray-300 rounded-lg"
                      required
                    />
                    <input
                      type="number"
                      placeholder="Price"
                      value={packageForm.price}
                      onChange={(e) => setPackageForm({ ...packageForm, price: e.target.value })}
                      className="px-4 py-2 border border-gray-300 rounded-lg"
                      required
                    />
                    <input
                      type="number"
                      placeholder="Device Limit"
                      value={packageForm.device_limit}
                      onChange={(e) => setPackageForm({ ...packageForm, device_limit: e.target.value })}
                      className="px-4 py-2 border border-gray-300 rounded-lg"
                      required
                    />
                    <input
                      type="text"
                      placeholder="Message Limit (~ for unlimited)"
                      value={packageForm.message_limit}
                      onChange={(e) => setPackageForm({ ...packageForm, message_limit: e.target.value })}
                      className="px-4 py-2 border border-gray-300 rounded-lg"
                      required
                    />
                    <select
                      value={packageForm.duration_type}
                      onChange={(e) => setPackageForm({ ...packageForm, duration_type: e.target.value })}
                      className="px-4 py-2 border border-gray-300 rounded-lg"
                    >
                      <option value="daily">Harian</option>
                      <option value="weekly">Pekanan</option>
                      <option value="monthly">Bulanan</option>
                      <option value="yearly">Tahunan</option>
                    </select>
                    <input
                      type="number"
                      placeholder="Duration Value"
                      value={packageForm.duration_value}
                      onChange={(e) => setPackageForm({ ...packageForm, duration_value: e.target.value })}
                      className="px-4 py-2 border border-gray-300 rounded-lg"
                      required
                    />
                    <textarea
                      placeholder="Description"
                      value={packageForm.description}
                      onChange={(e) => setPackageForm({ ...packageForm, description: e.target.value })}
                      className="px-4 py-2 border border-gray-300 rounded-lg col-span-2"
                      rows={2}
                    />
                    <label className="flex items-center col-span-2">
                      <input
                        type="checkbox"
                        checked={packageForm.active}
                        onChange={(e) => setPackageForm({ ...packageForm, active: e.target.checked })}
                        className="mr-2"
                      />
                      <span className="text-sm text-gray-700">Active</span>
                    </label>
                    <fieldset className="col-span-2 rounded-lg border border-gray-200 p-4">
                      <legend className="px-1 text-sm font-semibold text-gray-700">Fitur yang termasuk dalam paket</legend>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {packageFeatureOptions.map(([key, label]) => (
                          <label key={key} className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={Boolean(packageForm.features[key])}
                              onChange={(event) => setPackageForm({
                                ...packageForm,
                                features: { ...packageForm.features, [key]: event.target.checked },
                              })}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                      <p className="mt-3 text-xs text-gray-500">Semua fitur baru nonaktif secara default; centang hanya yang dijual pada paket ini.</p>
                    </fieldset>
                  </div>
                  <div className="flex space-x-2">
                    <button type="submit" className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700">
                      {editingPackage ? 'Update' : 'Create'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowPackageForm(false);
                        setEditingPackage(null);
                      }}
                      className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            {packages.length === 0 ? (
              <div className="p-6 text-center text-gray-500">No packages yet. Create one above.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Price</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Device Limit</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Message Limit</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Active</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {packages.map((pkg) => (
                      <tr key={pkg.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{pkg.name}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">Rp {pkg.price}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{pkg.device_limit}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{pkg.message_limit === 0 ? '~' : pkg.message_limit}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{pkg.duration_value} {pkg.duration_type}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{pkg.active ? 'Yes' : 'No'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <button
                            onClick={() => handleEditPackage(pkg)}
                            className="text-blue-600 hover:text-blue-700 mr-2"
                          >
                            <Edit2 className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleDeletePackage(pkg.id)}
                            className="text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'subscriptions' && (
          <div id="subscriptions" className="rounded-xl bg-white shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Pending Subscriptions</h2>
            </div>
            {subscriptions.length === 0 ? (
              <div className="p-6 text-center text-gray-500">No pending subscriptions</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Package</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {subscriptions.map((sub) => (
                      <tr key={sub.id}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div>
                            <div className="text-sm font-medium text-gray-900">{sub.name || 'Unknown'}</div>
                            <div className="text-sm text-gray-500">{sub.email || 'N/A'}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{sub.package_name || 'N/A'}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">
                            {sub.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{new Date(sub.created_at).toLocaleDateString()}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {sub.payment_verified ? (
                            <button
                              onClick={() => approveSubscription(sub.id)}
                              disabled={approvingSubscriptionId === sub.id}
                              className="text-green-600 hover:text-green-700 mr-2"
                              title="Aktifkan langganan terverifikasi"
                            >
                              {approvingSubscriptionId === sub.id
                                ? <span className="text-xs">Memproses...</span>
                                : <Check className="w-5 h-5" />}
                            </button>
                          ) : sub.has_pending_payment ? (
                            <button
                              onClick={() => navigateSection('payments')}
                              className="text-primary-600 hover:text-primary-700 mr-2"
                            >
                              Verifikasi pembayaran
                            </button>
                          ) : (
                            <span className="text-gray-500 mr-2">Menunggu bukti pembayaran</span>
                          )}
                          <button
                            onClick={() => rejectSubscription(sub.id)}
                            className="text-red-600 hover:text-red-700"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'customers' && (
          <section id="customers" className="overflow-hidden rounded-xl bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
              <div><h2 className="text-lg font-semibold">Manajemen customer</h2><p className="text-sm text-gray-500">Cari akun, pantau paket, dan kelola status langganan.</p></div>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  fetchCustomers(customerSearch);
                }}
              >
                <input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Nama atau email" className="min-w-0 rounded-lg border px-3 py-2" />
                <button className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white">Cari</button>
              </form>
            </div>
            {customers.length === 0 ? <p className="p-6 text-center text-sm text-gray-500">Tidak ada customer yang cocok.</p> : (
              <div className="divide-y">
                {customers.map((customer) => (
                  <div key={customer.id} className="flex flex-col gap-3 p-5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">{customer.name || 'Tanpa nama'}</p>
                      <p className="break-all text-sm text-gray-500">{customer.email}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        Paket: {customer.package_name || 'Belum ada'} · Device: {customer.device_count || 0}/{customer.max_devices || '—'} ·
                        {' '}Status: <span className="capitalize">{customer.subscription_status || 'none'}</span>
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {customer.subscription_status === 'active' ? (
                        <button type="button" onClick={() => changeCustomerSubscription(customer, 'suspend')} className="rounded-lg border border-amber-300 px-3 py-2 text-sm text-amber-800 hover:bg-amber-50">Tangguhkan</button>
                      ) : customer.subscription_status === 'suspended' ? (
                        <button type="button" onClick={() => changeCustomerSubscription(customer, 'reactivate')} className="rounded-lg border border-emerald-300 px-3 py-2 text-sm text-emerald-800 hover:bg-emerald-50">Aktifkan kembali</button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="border-t px-5 py-3 text-xs text-gray-500">Menampilkan paling banyak 200 customer terbaru.</p>
          </section>
        )}

        {activeTab === 'billing' && (
          <section id="billing" className="overflow-hidden rounded-xl bg-white shadow-sm">
            <div className="border-b p-5"><h2 className="text-lg font-semibold">Riwayat billing</h2><p className="text-sm text-gray-500">Transaksi terbaru dan status verifikasinya (maksimum 250).</p></div>
            {paymentHistory.length === 0 ? <p className="p-6 text-center text-sm text-gray-500">Belum ada pembayaran.</p> : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500"><tr>
                    <th className="px-5 py-3">Customer</th><th className="px-5 py-3">Paket</th><th className="px-5 py-3">Jumlah</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Waktu</th><th className="px-5 py-3">Verifikator</th>
                  </tr></thead>
                  <tbody className="divide-y">
                    {paymentHistory.map((payment) => (
                      <tr key={payment.id}>
                        <td className="px-5 py-3"><p className="font-medium">{payment.name || '—'}</p><p className="text-xs text-gray-500">{payment.email}</p></td>
                        <td className="px-5 py-3">{payment.package_name}</td>
                        <td className="whitespace-nowrap px-5 py-3">Rp {Number(payment.amount).toLocaleString('id-ID')}</td>
                        <td className="px-5 py-3 capitalize">{payment.status}</td>
                        <td className="whitespace-nowrap px-5 py-3">{new Date(payment.created_at).toLocaleString()}</td>
                        <td className="px-5 py-3">{payment.verified_by_email || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {activeTab === 'settings' && (
          <section id="settings" className="rounded-xl bg-white p-5 shadow-sm md:p-6">
            <h2 className="text-lg font-semibold">Pengaturan operasional lanjutan</h2>
            <p className="mb-6 mt-1 text-sm text-gray-500">Kebijakan ini berlaku lintas customer dan digunakan langsung oleh backend setelah disimpan.</p>
            <div className="grid gap-5 md:grid-cols-2">
              {[
                ['contact_daily_message_limit', 'Batas pesan per kontak / 24 jam'],
                ['contact_weekly_message_limit', 'Batas pesan per kontak / 7 hari'],
                ['send_failure_pause_threshold', 'Kegagalan beruntun sebelum jeda'],
                ['send_failure_pause_minutes', 'Durasi jeda pengiriman (menit)'],
              ].map(([key, label]) => (
                <label key={key} className="block text-sm font-medium text-gray-700">
                  {label}
                  <input
                    type="number"
                    min={1}
                    max={1_000_000}
                    value={platformSettings[key] || ''}
                    onChange={(event) => setPlatformSettings({ ...platformSettings, [key]: event.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2"
                  />
                </label>
              ))}
            </div>
            <label className="mt-5 flex items-start gap-3 rounded-lg border p-4">
              <input
                type="checkbox"
                checked={platformSettings.customer_registration_enabled === 'true'}
                onChange={(event) => setPlatformSettings({
                  ...platformSettings,
                  customer_registration_enabled: String(event.target.checked),
                })}
                className="mt-1"
              />
              <span><span className="block text-sm font-medium">Izinkan registrasi customer baru</span><span className="text-xs text-gray-500">Jika dimatikan, endpoint pendaftaran baru menolak registrasi; login customer tetap berfungsi.</span></span>
            </label>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button type="button" disabled={savingSettings} onClick={savePlatformSettings} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{savingSettings ? 'Menyimpan...' : 'Simpan pengaturan'}</button>
              <p className="text-xs text-gray-500">Perubahan langsung memengaruhi enforcement keselamatan pesan.</p>
            </div>
          </section>
        )}

        {activeTab === 'audit' && (
          <section id="audit" className="overflow-hidden rounded-xl bg-white shadow-sm">
            <div className="border-b p-5"><h2 className="text-lg font-semibold">Audit log admin</h2><p className="text-sm text-gray-500">Aksi paket, billing, pengaturan, dan status langganan terbaru.</p></div>
            {auditLogs.length === 0 ? <p className="p-6 text-center text-sm text-gray-500">Belum ada aktivitas admin tercatat.</p> : (
              <div className="divide-y">
                {auditLogs.map((log) => (
                  <div key={log.id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div><p className="font-medium text-gray-900">{String(log.action).replace(/_/g, ' ')}</p><p className="text-xs text-gray-500">{log.actor_name || log.actor_email || 'Admin tidak diketahui'} · {log.entity_type}{log.entity_id ? ` · ${log.entity_id}` : ''}</p></div>
                    <time className="text-xs text-gray-500">{new Date(log.created_at).toLocaleString()}</time>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
    </WorkspaceShell>
  );
}

export default SuperAdminDashboard;
