import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import RegulatoryStandards from './pages/RegulatoryStandards';
import CaseStudies from './pages/CaseStudies';
import Documentation from './pages/Documentation';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import NewScan from './pages/NewScan';
import Inspections from './pages/Inspections';
import InspectionDetail from './pages/InspectionDetail';
import Reports from './pages/Reports';
import Complaints from './pages/Complaints';
import Settings from './pages/Settings';
import InspectorConsole from './pages/InspectorConsole';
import api from './services/api';

function ProtectedRoute({ children }) {
  const location = useLocation();
  const isAuth = api.isAuthenticated();

  if (!isAuth) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

function PublicAuthRoute({ children }) {
  const isAuth = api.isAuthenticated();
  if (isAuth) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/standards" element={<RegulatoryStandards />} />
        <Route path="/case-studies" element={<CaseStudies />} />
        <Route path="/docs" element={<Documentation />} />
        <Route
          path="/login"
          element={
            <PublicAuthRoute>
              <Login />
            </PublicAuthRoute>
          }
        />
        <Route
          path="/register"
          element={
            <PublicAuthRoute>
              <Register />
            </PublicAuthRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/scan"
          element={
            <ProtectedRoute>
              <NewScan />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/console"
          element={
            <ProtectedRoute>
              <InspectorConsole />
            </ProtectedRoute>
          }
        />
        <Route
          path="/console"
          element={
            <ProtectedRoute>
              <InspectorConsole />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/inspections"
          element={
            <ProtectedRoute>
              <Inspections />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/inspections/:id"
          element={
            <ProtectedRoute>
              <InspectionDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/reports"
          element={
            <ProtectedRoute>
              <Reports />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/complaints"
          element={
            <ProtectedRoute>
              <Complaints />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/settings"
          element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
