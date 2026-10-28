import { useState, useEffect } from 'react';
import { MessageSquare, Zap, Shield, Globe, ArrowRight, Check } from 'lucide-react';
import axios from 'axios';
import { Link } from 'react-router-dom';

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
  active: boolean;
}

function LandingPage() {
  const [packages, setPackages] = useState<Package[]>([]);

  useEffect(() => {
    axios.get(`${API_BASE}/packages`).then((res) => {
      setPackages(res.data.data || []);
    });
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <MessageSquare className="w-8 h-8 text-primary-600" />
            <h1 className="text-2xl font-bold text-gray-900">Whafeisty</h1>
          </div>
          <div className="flex space-x-4">
            <Link to="/login" className="text-gray-600 hover:text-gray-900">Login</Link>
            <Link to="/register" className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700">Get Started</Link>
          </div>
        </div>
      </nav>

      <section className="bg-gradient-to-b from-primary-50 to-white py-20">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <h1 className="text-5xl font-bold text-gray-900 mb-6">
            WhatsApp API <span className="text-primary-600">Unofficial</span> untuk Bisnis Anda
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
            Whafeisty menyediakan WhatsApp API unofficial yang mudah diintegrasikan dengan aplikasi Anda.
            Kirim pesan, kelola kontak, dan otomatisasi komunikasi dengan WhatsApp.
          </p>
          <div className="flex justify-center space-x-4">
            <Link to="/register" className="bg-primary-600 text-white px-8 py-3 rounded-lg hover:bg-primary-700 flex items-center">
              Mulai Sekarang <ArrowRight className="w-5 h-5 ml-2" />
            </Link>
            <Link to="/packages" className="bg-white text-primary-600 border border-primary-600 px-8 py-3 rounded-lg hover:bg-primary-50">
              Lihat Paket
            </Link>
          </div>
        </div>
      </section>

      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">Mengapa Memilih Whafeisty?</h2>
            <p className="text-xl text-gray-600">Fitur lengkap untuk kebutuhan WhatsApp API Anda</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-gray-50 p-8 rounded-lg">
              <Zap className="w-12 h-12 text-primary-600 mb-4" />
              <h3 className="text-2xl font-semibold text-gray-900 mb-2">Cepat & Andal</h3>
              <p className="text-gray-600">API yang cepat dan stabil dengan uptime tinggi. Pesan terkirim dalam hitungan detik.</p>
            </div>
            <div className="bg-gray-50 p-8 rounded-lg">
              <Shield className="w-12 h-12 text-primary-600 mb-4" />
              <h3 className="text-2xl font-semibold text-gray-900 mb-2">Aman & Terpercaya</h3>
              <p className="text-gray-600">Keamanan data Anda adalah prioritas kami. Enkripsi end-to-end untuk semua komunikasi.</p>
            </div>
            <div className="bg-gray-50 p-8 rounded-lg">
              <Globe className="w-12 h-12 text-primary-600 mb-4" />
              <h3 className="text-2xl font-semibold text-gray-900 mb-2">Mudah Diintegrasikan</h3>
              <p className="text-gray-600">REST API yang mudah diintegrasikan dengan aplikasi Anda. Dokumentasi lengkap tersedia.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">Pilih Paket yang Tepat</h2>
            <p className="text-xl text-gray-600">Berbagai pilihan paket sesuai kebutuhan bisnis Anda</p>
          </div>
          <div className="relative">
            <div className="flex space-x-6 overflow-x-auto pb-4 scrollbar-hide" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              {packages.filter((pkg) => pkg.active).map((pkg) => (
                <div
                  key={pkg.id}
                  className="bg-white rounded-lg shadow-lg p-8 min-w-[300px] flex-shrink-0 hover:shadow-xl transition"
                >
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
                  <Link
                    to="/register"
                    className="block w-full bg-primary-600 text-white py-3 rounded-lg text-center hover:bg-primary-700"
                  >
                    Select Package
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">Siap Memulai?</h2>
          <p className="text-xl text-gray-600 mb-8">Daftar sekarang dan dapatkan akses ke Whafeisty API</p>
          <Link to="/register" className="inline-block bg-primary-600 text-white px-8 py-3 rounded-lg hover:bg-primary-700">
            Daftar Sekarang
          </Link>
        </div>
      </section>

      <footer className="bg-gray-900 text-white py-8">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p> Whafeisty. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

export default LandingPage;
