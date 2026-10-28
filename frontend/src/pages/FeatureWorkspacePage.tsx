import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, Bot, Briefcase, LifeBuoy, Megaphone, Users, Zap } from 'lucide-react';
import axios from 'axios';
import WorkspaceShell, { WorkspaceNavItem } from '../components/WorkspaceShell';
import CRMContacts from '../components/features/CRMContacts';
import BroadcastCampaigns from '../components/features/BroadcastCampaigns';
import AutomationRules from '../components/features/AutomationRules';
import CustomerServiceInbox from '../components/features/CustomerServiceInbox';
import AdvertisingCampaigns from '../components/features/AdvertisingCampaigns';
import ProfessionalFeatures from '../components/features/ProfessionalFeatures';

const featureDefinitions = {
  'api-docs': {
    key: 'api_docs',
    title: 'Docs API',
    description: 'Panduan untuk menghubungkan aplikasi Anda dengan Whafeisty.',
    icon: <BookOpen className="h-5 w-5" />,
  },
  crm: {
    key: 'crm',
    title: 'CRM',
    description: 'Ruang untuk mengelola kontak, segmentasi, dan aktivitas customer.',
    icon: <Users className="h-5 w-5" />,
  },
  broadcast: {
    key: 'broadcast',
    title: 'Broadcast',
    description: 'Rencanakan kampanye ke kontak yang memiliki consent aktif.',
    icon: <Megaphone className="h-5 w-5" />,
  },
  automessage: {
    key: 'automessage',
    title: 'Automessage',
    description: 'Rencanakan pesan otomatis berbasis pemicu dan aturan yang Anda tentukan.',
    icon: <Bot className="h-5 w-5" />,
  },
  'customer-service': {
    key: 'customer_service',
    title: 'Customer Service',
    description: 'Workspace mandiri untuk antrean percakapan dan layanan customer.',
    icon: <LifeBuoy className="h-5 w-5" />,
  },
  advertising: {
    key: 'advertising',
    title: 'Advertising',
    description: 'Kelola aset dan rencana promosi Anda di satu tempat.',
    icon: <Zap className="h-5 w-5" />,
  },
  professional: {
    key: 'professional',
    title: 'Professional',
    description: 'Fitur profesional yang dapat diaktifkan SuperAdmin untuk paket ini.',
    icon: <Briefcase className="h-5 w-5" />,
  },
} as const;

type FeatureSlug = keyof typeof featureDefinitions;

const customerFeatureNav: WorkspaceNavItem[] = Object.entries(featureDefinitions).map(([slug, feature]) => ({
  id: slug,
  label: feature.title,
  shortLabel: feature.title,
  icon: feature.icon,
}));

function ApiDocsContent() {
  return (
    <div className="space-y-5">
      <section className="rounded-xl border bg-white p-5">
        <h2 className="text-lg font-semibold">Autentikasi</h2>
        <p className="mt-2 text-sm text-gray-600">Gunakan API key yang dibuat dari menu API & integrasi. Kirim secret melalui header Authorization dan simpan hanya di server Anda.</p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-gray-950 p-4 text-sm text-green-200">{`Authorization: Bearer <API_KEY>`}</pre>
      </section>
      <section className="rounded-xl border bg-white p-5">
        <h2 className="text-lg font-semibold">Endpoint yang tersedia</h2>
        <div className="mt-3 divide-y text-sm">
          {[
            ['GET', '/api/v1/devices/external', 'Melihat device pada akun (scope devices:read)'],
            ['POST', '/api/v1/messages/external', 'Mengirim pesan dengan consent aktif dan kuota tersedia (scope messages:send)'],
            ['GET', '/api/v1/messages/external/{deviceId}', 'Melihat riwayat pesan (scope messages:read)'],
          ].map(([method, path, description]) => (
            <div key={path} className="grid gap-1 py-3 sm:grid-cols-[70px_minmax(180px,1fr)_2fr] sm:items-center">
              <span className="font-semibold text-primary-700">{method}</span>
              <code className="break-all">{path}</code>
              <span className="text-gray-600">{description}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-gray-500">Endpoint pengiriman tetap menerapkan kuota, consent, opt-out, dan safety pause. API key tidak melewati kebijakan tersebut.</p>
      </section>
    </div>
  );
}

function FeatureWorkspacePage() {
  const { feature: routeFeature } = useParams<{ feature?: string }>();
  const standaloneCustomerService = window.location.pathname === '/customer-service';
  const slug = (standaloneCustomerService ? 'customer-service' : routeFeature) as FeatureSlug | undefined;
  const feature = slug ? featureDefinitions[slug] : undefined;
  const [enabledFeatures, setEnabledFeatures] = useState<Record<string, boolean> | null>(null);
  const [loadError, setLoadError] = useState('');
  const token = localStorage.getItem('token');

  useEffect(() => {
    if (!token) return;
    axios.get('/api/v1/packages/me/features', {
      headers: { Authorization: `Bearer ${token}` },
    }).then((response) => {
      setEnabledFeatures(response.data.data?.features || {});
    }).catch((error) => {
      console.error('Could not load package feature access:', error);
      setLoadError(error.response?.data?.error || 'Tidak dapat memeriksa akses paket saat ini.');
    });
  }, [token]);

  if (!feature || !slug) {
    return <main className="p-8">Halaman fitur tidak ditemukan. <Link className="text-primary-700 underline" to="/dashboard">Kembali ke dashboard</Link></main>;
  }

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
  };
  const allowed = enabledFeatures?.[feature.key] === true;

  if (standaloneCustomerService) {
    return (
      <main className="min-h-screen bg-slate-950 text-white">
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div><p className="font-semibold">Whafeisty · Customer Service</p><p className="text-xs text-slate-400">Standalone workspace</p></div>
          <div className="flex items-center gap-4">
            <Link className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white" to="/dashboard"><ArrowLeft className="h-4 w-4" /> Dashboard</Link>
            <button type="button" onClick={handleLogout} className="text-sm text-slate-300 hover:text-white">Keluar</button>
          </div>
        </header>
        <section className="mx-auto max-w-5xl p-6 md:p-10">
          <div className="mb-7 flex items-center gap-3">{feature.icon}<div><h1 className="text-2xl font-bold">{feature.title}</h1><p className="text-sm text-slate-400">{feature.description}</p></div></div>
          {loadError ? <div role="alert" className="rounded-xl border border-red-400/30 bg-red-950/50 p-5">{loadError}</div>
            : enabledFeatures === null ? <p className="text-slate-300">Memeriksa akses paket...</p>
              : !allowed ? <div className="rounded-xl border border-amber-400/30 bg-amber-950/40 p-5"><h2 className="font-semibold">Fitur tidak termasuk paket aktif</h2><p className="mt-1 text-sm text-slate-300">Minta SuperAdmin mengaktifkan Customer Service pada pengaturan paket Anda.</p></div>
                : <div className="rounded-xl border border-white/10 bg-slate-900 p-6"><h2 className="font-semibold">Workspace Customer Service sedang disiapkan</h2><p className="mt-2 text-sm text-slate-300">Akses paket aktif. Inbox percakapan dan penugasan agen belum diaktifkan; belum ada pesan yang diproses dari halaman ini.</p></div>}
        </section>
      </main>
    );
  }

  const navItems: WorkspaceNavItem[] = [
    { id: 'overview', label: 'Dashboard', shortLabel: 'Dashboard', icon: <ArrowLeft className="h-5 w-5" /> },
    ...customerFeatureNav,
  ];
  return (
    <WorkspaceShell
      title={feature.title}
      subtitle={feature.description}
      items={navItems}
      activeItem={slug}
      onNavigate={(id) => { window.location.href = id === 'overview' ? '/dashboard' : `/dashboard/features/${id}`; }}
      onLogout={handleLogout}
    >
      {loadError ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800">{loadError}</div>
        : enabledFeatures === null ? <div className="rounded-xl bg-white p-6">Memeriksa akses paket...</div>
          : !allowed ? <section className="rounded-xl border border-amber-200 bg-amber-50 p-6"><h2 className="font-semibold text-amber-900">Fitur belum termasuk paket aktif</h2><p className="mt-1 text-sm text-amber-800">Minta SuperAdmin mengaktifkan fitur ini pada pengaturan paket Anda.</p></section>
            : slug === 'api-docs' ? <ApiDocsContent />
              : slug === 'crm' ? <CRMContacts />
              : slug === 'broadcast' ? <BroadcastCampaigns />
              : slug === 'automessage' ? <AutomationRules />
              : slug === 'customer-service' ? <CustomerServiceInbox />
              : slug === 'advertising' ? <AdvertisingCampaigns />
              : slug === 'professional' ? <ProfessionalFeatures />
              : null}
    </WorkspaceShell>
  );
}

export default FeatureWorkspacePage;
