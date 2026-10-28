import { FormEvent, useState } from 'react';
import axios from 'axios';
import { Link, useNavigate } from 'react-router-dom';

const API_BASE = '/api/v1/users';

function PasswordReset() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeRequested, setCodeRequested] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRequest = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await axios.post(`${API_BASE}/password/forgot`, { email });
      setMessage(response.data.message);
      setCodeRequested(true);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'Password reset could not be requested');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE}/password/reset`, { email, code, password });
      setMessage(response.data.message);
      window.setTimeout(() => navigate('/login', { replace: true }), 1800);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'Password could not be reset');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          {codeRequested ? 'Enter your reset code' : 'Forgot your password?'}
        </h1>
        <p className="text-sm text-gray-600 mb-6">
          {codeRequested
            ? 'Enter the 6-digit code sent to your email, then choose a new password. The code expires in 30 minutes.'
            : 'Enter your account email and we will send a reset code if it is registered.'}
        </p>

        {codeRequested ? (
          <form onSubmit={handleReset} className="space-y-4">
            <input
              type="email"
              autoComplete="email"
              placeholder="Email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={255}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            />
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit reset code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              maxLength={6}
              pattern="[0-9]{6}"
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg tracking-widest"
            />
            <input
              type="password"
              autoComplete="new-password"
              placeholder="New password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              maxLength={72}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            />
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={8}
              maxLength={72}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary-600 text-white py-2 rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Reset password'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRequest} className="space-y-4">
            <input
              type="email"
              autoComplete="email"
              placeholder="Email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={255}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary-600 text-white py-2 rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              {loading ? 'Sending...' : 'Send reset code'}
            </button>
          </form>
        )}

        {message && <p role="status" className="mt-4 text-sm text-green-700">{message}</p>}
        {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
        {codeRequested && (
          <button
            type="button"
            onClick={() => {
              setCodeRequested(false);
              setCode('');
              setPassword('');
              setConfirmPassword('');
              setMessage('');
              setError('');
            }}
            className="mt-3 w-full text-sm text-primary-600 hover:text-primary-700"
          >
            Use a different email
          </button>
        )}
        <p className="mt-6 text-center text-sm text-gray-600">
          <Link to="/login" className="text-primary-600 hover:text-primary-700">Back to login</Link>
        </p>
      </div>
    </div>
  );
}

export default PasswordReset;
