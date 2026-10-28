import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import axios from 'axios';
import { Link, useLocation, useNavigate } from 'react-router-dom';

const API_BASE = '/api/v1';

function Login() {
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/users/login`, { email, password });
      localStorage.setItem('token', res.data.data.token);
      if (res.data.data.user) {
        localStorage.setItem('user', JSON.stringify(res.data.data.user));
      }
      const destination = location.state?.from;
      if (destination?.pathname) {
        navigate(`${destination.pathname}${destination.search || ''}`, { replace: true });
      } else {
        navigate(res.data.data.user?.role === 'superadmin' ? '/superadmin' : '/dashboard', { replace: true });
      }
    } catch (error: any) {
      alert(error.response?.data?.error || 'Login failed');
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
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Login</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
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
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary-600 text-white py-2 rounded-lg hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
        <p className="mt-3 text-right text-sm">
          <Link to="/forgot-password" className="text-primary-600 hover:text-primary-700">Forgot password?</Link>
        </p>
        <p className="mt-4 text-center text-sm text-gray-600">
          Don't have an account?{' '}
          <a href="/register" className="text-primary-600 hover:text-primary-700">Register</a>
        </p>
      </div>
    </div>
  );
}

export default Login;
