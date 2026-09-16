import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import Solutions from './pages/Solutions';
import RegulatoryStandards from './pages/RegulatoryStandards';
import CaseStudies from './pages/CaseStudies';
import Documentation from './pages/Documentation';
import Login from './pages/Login';
import Register from './pages/Register';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/solutions" element={<Solutions />} />
        <Route path="/regulatory-standards" element={<RegulatoryStandards />} />
        <Route path="/case-studies" element={<CaseStudies />} />
        <Route path="/documentation" element={<Documentation />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        {/* Dashboard route - we'll create this next */}
        <Route path="/dashboard" element={<div className="min-h-screen flex items-center justify-center"><h1>Dashboard - Coming Soon</h1></div>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
