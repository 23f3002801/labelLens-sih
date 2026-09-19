import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
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
import Settings from './pages/Settings';
import InspectorConsole from './pages/InspectorConsole';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/standards" element={<RegulatoryStandards />} />
        <Route path="/case-studies" element={<CaseStudies />} />
        <Route path="/docs" element={<Documentation />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/dashboard/scan" element={<NewScan />} />
        <Route path="/dashboard/console" element={<InspectorConsole />} />
        <Route path="/console" element={<InspectorConsole />} />
        <Route path="/dashboard/inspections" element={<Inspections />} />
        <Route path="/dashboard/inspections/:id" element={<InspectionDetail />} />
        <Route path="/dashboard/reports" element={<Reports />} />
        <Route path="/dashboard/settings" element={<Settings />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;