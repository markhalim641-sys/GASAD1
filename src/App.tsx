import { Suspense, lazy } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import NotFound from './pages/NotFound';

// تحميل الصفحات عند الحاجة فقط (بدل حزمة واحدة ضخمة)
const Home = lazy(() => import('./pages/Home'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Pending = lazy(() => import('./pages/Pending'));
const Shell = lazy(() => import('./pages/Shell').then(m => ({ default: m.Shell })));
const Dashboard = lazy(() => import('./pages/AdminDashboard'));
const Registrations = lazy(() => import('./pages/Registrations'));
const Attendance = lazy(() => import('./pages/Attendance'));
const Users = lazy(() => import('./pages/Shell').then(m => ({ default: m.Users })));
const Soon = lazy(() => import('./pages/Shell').then(m => ({ default: m.Soon })));
const Preparations = lazy(() => import('./pages/Preparations'));
const Warehouse = lazy(() => import('./pages/Warehouse').then(m => ({ default: m.Warehouse })));
const WarehouseRequests = lazy(() => import('./pages/Warehouse').then(m => ({ default: m.WarehouseRequests })));
const Fallback = () => <div className="route-fallback" aria-busy="true" />;
export default function App() {
  const loc = useLocation();
  return (
    <>
      {!loc.pathname.startsWith('/app') && <Navbar />}
      <Suspense fallback={<Fallback />}>
        <main>
          <Routes location={loc}>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/pending" element={<Pending />} />
            <Route path="/app" element={<Shell />}>
              <Route index element={<Dashboard />} />
              <Route path="registrations" element={<Registrations />} />
              <Route path="users" element={<Users />} />
              <Route path="preparations" element={<Preparations />} />
              <Route path="attendance" element={<Attendance />} />
              <Route path="warehouse" element={<Warehouse />} />
              <Route path="warehouse-requests" element={<WarehouseRequests />} />
              <Route path=":page" element={<Soon />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </Suspense>
    </>
  );
}
