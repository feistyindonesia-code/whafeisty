import { Briefcase, Zap, ShieldCheck, Users, BarChart3, Rocket } from 'lucide-react';

const features = [
  {
    title: 'API Prioritas',
    description: 'Akses prioritas ke endpoint API dengan rate limit yang lebih tinggi dan dukungan webhook real-time.',
    icon: <Zap className="w-5 h-5" />,
  },
  {
    title: 'Multi-Device Unlimited',
    description: 'Hubungkan jumlah device WhatsApp yang lebih banyak tanpa batasan paket standar.',
    icon: <Users className="w-5 h-5" />,
  },
  {
    title: 'Analitik Lanjutan',
    description: 'Laporan detail mengenai pengiriman pesan, respons customer, dan performa kampanye.',
    icon: <BarChart3 className="w-5 h-5" />,
  },
  {
    title: 'Keamanan Enterprise',
    description: 'Enkripsi end-to-end, audit log lengkap, dan kontrol akses berbasis peran untuk tim Anda.',
    icon: <ShieldCheck className="w-5 h-5" />,
  },
  {
    title: 'Dukungan Prioritas',
    description: 'Tim support khusus dengan waktu respons terjamin untuk kebutuhan bisnis Anda.',
    icon: <Rocket className="w-5 h-5" />,
  },
  {
    title: 'Integrasi Custom',
    description: 'Dukungan untuk integrasi khusus dengan CRM, ERP, dan sistem eksternal lainnya.',
    icon: <Briefcase className="w-5 h-5" />,
  },
];

export default function ProfessionalFeatures() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Professional</h2>
          <p className="text-sm text-gray-500">Fitur profesional yang dapat diaktifkan SuperAdmin untuk paket Anda.</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-6">Fitur yang Tersedia</h3>
        <div className="grid gap-4 md:grid-cols-3">
          {features.map((feature, i) => (
            <div key={i} className="p-4 rounded-lg border border-gray-200 bg-gray-50">
              <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center mb-3 text-primary-600">
                {feature.icon}
              </div>
              <h4 className="font-medium text-gray-900 mb-1">{feature.title}</h4>
              <p className="text-sm text-gray-600">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-amber-50 rounded-lg border border-amber-200 p-6">
        <h3 className="font-semibold text-amber-900 mb-2">Aktifkan Fitur Professional</h3>
        <p className="text-sm text-amber-700 mb-4">Fitur Professional tidak secara default diaktifkan pada semua paket. Silakan hubungi SuperAdmin untuk mengaktifkan fitur ini pada pengaturan paket Anda.</p>
        <button className="w-full py-2 px-4 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm font-medium">
          Hubungi SuperAdmin
        </button>
      </div>
    </div>
  );
}