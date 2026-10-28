import { useState, useEffect } from 'react';
import { Package, Check } from 'lucide-react';
import axios from 'axios';

const API_BASE = '/api/v1';

function PackagesPage() {
  const [packages, setPackages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get(`${API_BASE}/packages`)
      .then((res) => {
        setPackages(res.data.data || []);
      })
      .catch((requestError) => {
        console.error('Failed to load packages:', requestError);
        setError('Paket belum dapat dimuat. Coba muat ulang halaman.');
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSelectPackage = (packageId: string) => {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    if (localStorage.getItem('token')) {
      window.location.href = user?.role === 'superadmin'
        ? '/superadmin'
        : `/checkout?package_id=${encodeURIComponent(packageId)}`;
      return;
    }
    window.location.href = `/register?package_id=${encodeURIComponent(packageId)}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-12">
          <Package className="w-16 h-16 text-primary-600 mx-auto mb-4" />
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Choose Your Package</h1>
          <p className="text-xl text-gray-600">Select the perfect plan for your WhatsApp API needs</p>
        </div>

        {loading && <p className="text-center text-gray-600">Memuat paket...</p>}
        {!loading && error && <p role="alert" className="text-center text-red-600">{error}</p>}
        {!loading && !error && packages.length === 0 && (
          <p className="text-center text-gray-600">Belum ada paket aktif. Silakan coba lagi nanti.</p>
        )}
        {!loading && !error && packages.length > 0 && <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {packages.map((pkg) => (
            <div key={pkg.id} className="bg-white rounded-lg shadow-lg p-8 hover:shadow-xl transition">
              <h3 className="text-2xl font-bold text-gray-900 mb-2">{pkg.name}</h3>
              <p className="text-4xl font-bold text-primary-600 mb-4">Rp {pkg.price}</p>
              <p className="text-gray-600 mb-6">{pkg.description}</p>
              <ul className="space-y-3 mb-8">
                <li className="flex items-center">
                  <Check className="w-5 h-5 text-green-500 mr-2" />
                  <span>{pkg.device_limit} Devices</span>
                </li>
                <li className="flex items-center">
                  <Check className="w-5 h-5 text-green-500 mr-2" />
                  <span>{pkg.message_limit === 0 ? 'Unlimited Messages' : `${pkg.message_limit} Messages`}</span>
                </li>
                <li className="flex items-center">
                  <Check className="w-5 h-5 text-green-500 mr-2" />
                  <span>{pkg.duration_value} {pkg.duration_type}</span>
                </li>
              </ul>
              <button
                onClick={() => handleSelectPackage(pkg.id)}
                className="w-full bg-primary-600 text-white py-3 rounded-lg hover:bg-primary-700"
              >
                Select Package
              </button>
            </div>
          ))}
        </div>}
      </div>
    </div>
  );
}

export default PackagesPage;
