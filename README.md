# ALMAC (Automated Legal Metrology Compliance Engine)

**ALMAC** is an enterprise-grade statutory verification platform designed to automate compliance inspections across the Legal Metrology (Packaged Commodities) Rules, 2011, and subsequent Gazette notifications of the Government of India. 

ALMAC empowers packaging, regulatory, and QC teams to instantly verify statutory declarations, mandatory ratios, principal display panels, net quantity standards, and statutory MRP syntax using automated computer vision and AI.

---

## 🌟 Key Features

- **Automated OCR & Compliance:** Identifies and validates all 8 statutory packaging fields under Rule 6(1).
- **Geometric Verification:** Sub-millimeter precision checking for font heights and Principal Display Panel (PDP) area ratios.
- **MRP & Syntax Engine:** Validates exact statutory phrasing ("inclusive of all taxes") and Unit Sale Price (USP) calculations.
- **360-Degree Video Scanning:** Cylindrical unwrapping and frame-by-frame analysis for complex packaging.
- **Role-Based Access Control:** Secure JWT authentication for Field Inspectors, District Officers, and State Controllers.
- **Audit-Ready Reports:** Generates cryptographically stamped, time-stamped proof logs for legal defense.

---

## 🛠️ Tech Stack

### Frontend
- **Framework:** React 18 + Vite
- **Styling:** Tailwind CSS v4 (Stitch Design System)
- **Routing:** React Router v6
- **State Management:** React Context / Local State

### Backend
- **Runtime:** Node.js
- **Framework:** Fastify (High-performance HTTP server)
- **Database ORM:** Prisma
- **Database:** PostgreSQL (Hosted on NeonDB)
- **Authentication:** JWT (JSON Web Tokens) + Bcrypt

### Infrastructure & AI
- **Media Storage:** Cloudinary CDN
- **Compute Engine:** Python FastAPI (Internal host for ML/CV models)
- **Testing:** Custom Fastify Integration Test Suite

---

## 📁 Project Structure

```text
labelLens-sih-node_server/
├── node-server/          # Backend API (Fastify + Prisma)
│   ├── src/
│   │   ├── config/       # Database & Prisma config
│   │   ├── controllers/  # Route handlers (Auth, Uploads, Scans)
│   │   ├── routes/       # Fastify route definitions
│   │   └── server.js     # Main server entry point
│   ├── prisma/           # Schema, migrations, and seed data
│   ── test_suite.js     # Integration tests
├── web/                  # Frontend Application (React + Vite)
│   ├── public/           # Static assets
│   ── src/
│       ├── components/   # Reusable UI components
│       ├── pages/        # Route pages (Landing, Login, Dashboard)
│       └── services/     # API service layer
└── README.md             # Project documentation