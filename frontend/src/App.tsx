import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/Register';
import CustomerDashboard from './pages/CustomerDashboard';
import SuperAdminDashboard from './pages/SuperAdminDashboard';
import SuperAdminLogin from './pages/SuperAdminLogin';
import LandingPage from './pages/LandingPage';
import PackagesPage from './pages/PackagesPage';
import CheckoutPage from './pages/CheckoutPage';
import PasswordReset from './pages/PasswordReset';
import FeatureWorkspacePage from './pages/FeatureWorkspacePage';

function RequireAuth() {
  const isAuthenticated = !!localStorage.getItem('token');
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

function AuthRedirect() {
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  return <Navigate to={user?.role === 'superadmin' ? '/superadmin' : '/dashboard'} replace />;
}

function App() {
  const isAuthenticated = !!localStorage.getItem('token');

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/packages" element={<PackagesPage />} />
      <Route path="/login" element={isAuthenticated ? <AuthRedirect /> : <Login />} />
      <Route path="/forgot-password" element={<PasswordReset />} />
      <Route path="/reset-password" element={<PasswordReset />} />
      <Route path="/register" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Register />} />
      <Route path="/superadmin/login" element={<SuperAdminLogin />} />

      <Route element={<RequireAuth />}>
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/dashboard" element={<CustomerDashboard />} />
        <Route path="/dashboard/:section" element={<CustomerDashboard />} />
        <Route path="/dashboard/features/:feature" element={<FeatureWorkspacePage />} />
        <Route path="/customer-service" element={<FeatureWorkspacePage />} />
        <Route path="/superadmin" element={<SuperAdminDashboard />} />
        <Route path="/superadmin/:section" element={<SuperAdminDashboard />} />
      </Route>
    </Routes>
  );
}

export default App