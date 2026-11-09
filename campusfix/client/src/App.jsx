import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import { Login, Register } from './pages/AuthPages';
import Dashboard from './pages/Dashboard';
import RequestForm from './pages/RequestForm';
import RequestList from './pages/RequestList';
import RequestDetail from './pages/RequestDetail';
import { Users, AuditLog } from './pages/Admin';
import { useAuth } from './auth';

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to="/" replace /> : <Register />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="requests" element={<RequestList />} />
          <Route path="requests/:id" element={<RequestDetail />} />
          <Route element={<ProtectedRoute roles={['requester', 'admin']} />}>
            <Route path="requests/new" element={<RequestForm />} />
          </Route>
          <Route element={<ProtectedRoute roles={['admin']} />}>
            <Route path="admin/users" element={<Users />} />
            <Route path="admin/audit" element={<AuditLog />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
