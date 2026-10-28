import { useState, useEffect } from 'react';
import { MessageSquare } from 'lucide-react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';

const API_BASE = '/api/v1';

function Register() {
  const [searchParams] = useSearchParams();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [packageId, setPackageId] = useState(searchParams.get('package_id') || '');
  const [packages, setPackages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    axios.get(`${API_BASE}/packages`).then((res) => {
      setPackages(res.data.data || []);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/users/register`, { name, email, password, package_id: packageId });
      localStorage.setItem('token', res.data.data.token);
      if (res.data.data.user) {
        localStorage.setItem('user', JSON.stringify(res.data.data.user));
      }
      window.location.href = `/checkout?package_id=${encodeURIComponent(packageId)}`;
    } catch (error: any) {
      alert(error.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <div className="flex items-center justify-center mb-6">
          <MessageSquare className="w-8 h-8 text-primary-600 mr-2" />
          <h1 className="text-2xl font-bold text-gray-900">Whafeisty</h1>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Register</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            required
          />
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            required
          />
          <select
            value={packageId}
            onChange={(e) => setPackageId(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            required
          >
            <option value="">Select Package</option>
            {packages.map((pkg) => (
              <option key={pkg.id} value={pkg.id}>
                {pkg.name} - Rp {pkg.price} ({pkg.device_limit} devices)
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary-600 text-white py-2 rounded-lg hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? 'Registering...' : 'Register'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-600">
          Already have an account?{' '}
          <a href="/login" className="text-primary-600 hover:text-primary-700">Login</a>
        </p>
      </div>
    </div>
  );
}

export default Register;
