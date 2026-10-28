import { FormEvent, useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';

const API_BASE = '/api/v1';

interface Package {
  id: string;
  name: string;
  price: number;
  description?: string;
}

function CheckoutPage() {
  const [searchParams] = useSearchParams();
  const packageId = searchParams.get('package_id') || '';
  const [selectedPackage, setSelectedPackage] = useState<Package | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const user = JSON.parse(localStorage.getItem('user') || 'null');

  useEffect(() => {
    if (!packageId) {
      setLoading(false);
      return;
    }

    axios.get(`${API_BASE}/packages/${encodeURIComponent(packageId)}`)
      .then((response) => setSelectedPackage(response.data.data))
      .catch((requestError) => {
        console.error('Failed to load selected package:', requestError);
        setError('Paket tidak tersedia. Silakan pilih paket yang masih aktif.');
      })
      .finally(() => setLoading(false));
  }, [packageId]);

  if (user?.role === 'superadmin') {
    return <Navigate to="/superadmin" replace />;
  }
  if (!packageId) {
    return <Navigate to="/packages" replace />;
  }

  const submitPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!proof) {
      setError('Pilih file bukti pembayaran terlebih dahulu.');
      return;
    }

    const formData = new FormData();
    formData.append('package_id', packageId);
    formData.append('proof', proof);

    setSubmitting(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      await axios.post(`${API_BASE}/payments/upload`, formData, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSubmitted(true);
    } catch (requestError: any) {
      console.error('Failed to submit payment proof:', requestError);
      setError(requestError.response?.data?.error || 'Bukti pembayaran gagal dikirim. Silakan coba lagi.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <main className="min-h-screen flex items-center justify-center text-gray-600">Memuat paket...</main>;
  }

  if (submitted) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <section className="bg-white p-8 rounded-lg shadow-md w-full max-w-lg text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Bukti pembayaran terkirim</h1>
          <p className="text-gray-600 mb-6">Pembayaran Anda sedang menunggu verifikasi SuperAdmin. Akses paket akan aktif setelah disetujui.</p>
          <Link to="/dashboard" className="inline-block bg-primary-600 text-white px-6 py-2 rounded-lg hover:bg-primary-700">
            Ke Dashboard
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <section className="bg-white p-8 rounded-lg shadow-md w-full max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Checkout paket</h1>
        {selectedPackage ? (
          <div className="border rounded-lg p-4 my-6">
            <h2 className="font-semibold text-lg">{selectedPackage.name}</h2>
            {selectedPackage.description && <p className="text-gray-600 mt-1">{selectedPackage.description}</p>}
            <p className="text-primary-700 font-bold text-xl mt-3">Rp {Number(selectedPackage.price).toLocaleString('id-ID')}</p>
          </div>
        ) : (
          <p role="alert" className="text-red-600 my-6">{error || 'Paket tidak ditemukan.'}</p>
        )}

        {selectedPackage && (
          <form onSubmit={submitPayment} className="space-y-4">
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 mb-2">Bukti pembayaran (JPG, PNG, atau PDF; maks. 5 MB)</span>
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                onChange={(event) => setProof(event.target.files?.[0] || null)}
                required
                className="block w-full text-sm text-gray-700"
              />
            </label>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-primary-600 text-white py-3 rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              {submitting ? 'Mengirim...' : 'Kirim bukti pembayaran'}
            </button>
          </form>
        )}

        <Link to="/packages" className="block text-center text-primary-600 hover:text-primary-700 mt-6">
          Kembali ke daftar paket
        </Link>
      </section>
    </main>
  );
}

export default CheckoutPage;
