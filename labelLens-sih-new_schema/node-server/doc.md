# LabelLens API Documentation & Integration Guide

Welcome to the LabelLens Node.js Fastify Server API documentation. This guide is crafted for frontend engineers, mobile developers (Flutter/React Native), and backend engineers collaborating on the LabelLens ecosystem.

---

## 1. System Architecture

LabelLens uses a decoupled microservices architecture:

- **Node.js Fastify Server (`node-server`)**: Owns the database (NeonDB PostgreSQL via Prisma ORM), authentication (JWT & RBAC), Cloudinary CDN file storage, and business workflow orchestration.
- **Python FastAPI Engine (`server`)**: A stateless, high-performance compute engine running RapidOCR text/font extraction, Legal Metrology 2011 rule compliance scoring, and universal video label unwrap algorithms.
- **PostgreSQL (NeonDB)**: Cloud database storing user accounts, scanned inspection records, product metadata, legal violations, and compliance rulesets.
- **Cloudinary CDN**: High-speed asset hosting for original scans and extracted video frames.

```
+-------------------------------------------------------------+
|               Mobile App / Web Dashboard                    |
+-------------------------------------------------------------+
                              |
                     HTTPS / JSON / Multipart
                              v
+-------------------------------------------------------------+
|             Node.js Fastify API (Port 3000)                 |
|   - Authentication (JWT & RBAC)                             |
|   - Prisma ORM (NeonDB PostgreSQL)                          |
|   - Cloudinary Upload Bridge                                |
|   - Orchestration Pipeline                                  |
+-------------------------------------------------------------+
          |                                      |
     Direct Upload                         HTTP (Internal)
          v                                      v
+-------------------+                  +----------------------+
|   Cloudinary CDN  |                  | FastAPI Compute      |
|   (Image Assets)  |                  | (RapidOCR / Unwrap)  |
+-------------------+                  +----------------------+
```

### Base URLs & Environments
- **Local Development**: `http://localhost:3000`
- **FastAPI Compute Engine**: `http://127.0.0.1:8000`

---

## 2. Authentication & Authorization

All protected routes expect a JSON Web Token (JWT) supplied in the standard HTTP `Authorization` header:

```http
Authorization: Bearer <YOUR_JWT_TOKEN>
```

### User Roles
LabelLens enforces Role-Based Access Control (RBAC) across four operational tiers:

| Role Code | Title | Description |
|---|---|---|
| `FIELD_INSPECTOR` | Field Inspector | Default role. Performs label inspections and uploads scans in retail stores. |
| `DISTRICT_OFFICER` | District Officer | Reviews inspections and violations within their assigned district. |
| `STATE_CONTROLLER` | State Controller | Oversees state-wide compliance statistics and inspection reports. |
| `ADMIN` | System Administrator | Full access to users, system rules, inspections, and configurations. |

---

## 3. Endpoints Reference

### 3.1. Health & Status

#### `GET /health`
Returns the status of the server.

- **Auth Required**: No
- **Response**: `200 OK`
```json
{
  "status": "ok",
  "timestamp": "2026-09-13T10:00:00.000Z"
}
```

---

### 3.2. Authentication Routes

#### `POST /api/v1/auth/register` (Alias: `/auth/register`)
Register a new inspector or officer account.

- **Auth Required**: No
- **Content-Type**: `application/json`
- **Request Body**:
  ```json
  {
    "email": "officer.sharma@labellens.gov.in",
    "password": "SecurePassword123!",
    "fullName": "Rajesh Sharma",
    "role": "FIELD_INSPECTOR",
    "district": "Varanasi",
    "state": "Uttar Pradesh",
    "badgeNumber": "UP-LM-4821"
  }
  ```
- **Response**: `201 Created`
  ```json
  {
    "message": "User registered successfully",
    "token": "eyJhbGciOiJIUzI1NiIsIn...",
    "user": {
      "id": "7b8c71b6-f5c2-49e0-811c-d7039a5f36e4",
      "fullName": "Rajesh Sharma",
      "email": "officer.sharma@labellens.gov.in",
      "role": "FIELD_INSPECTOR",
      "district": "Varanasi",
      "state": "Uttar Pradesh",
      "badgeNumber": "UP-LM-4821",
      "createdAt": "2026-09-13T10:05:00.000Z"
    }
  }
  ```
- **Errors**:
  - `400 Bad Request`: Missing fields or password length < 6 characters.
  - `409 Conflict`: User with this email already exists.

---

#### `POST /api/v1/auth/login` (Alias: `/auth/login`)
Authenticate with email and password to receive a JWT session token.

- **Auth Required**: No
- **Content-Type**: `application/json`
- **Request Body**:
  ```json
  {
    "email": "officer.sharma@labellens.gov.in",
    "password": "SecurePassword123!"
  }
  ```
- **Response**: `200 OK`
  ```json
  {
    "message": "Login successful",
    "token": "eyJhbGciOiJIUzI1NiIsIn...",
    "user": {
      "id": "7b8c71b6-f5c2-49e0-811c-d7039a5f36e4",
      "fullName": "Rajesh Sharma",
      "email": "officer.sharma@labellens.gov.in",
      "role": "FIELD_INSPECTOR",
      "district": "Varanasi",
      "state": "Uttar Pradesh",
      "badgeNumber": "UP-LM-4821",
      "createdAt": "2026-09-13T10:05:00.000Z"
    }
  }
  ```
- **Errors**:
  - `401 Unauthorized`: Invalid email or password.

---

#### `GET /api/v1/auth/me` (Alias: `/auth/me`)
Fetch the authenticated user's profile.

- **Auth Required**: Yes (`Bearer <token>`)
- **Response**: `200 OK`
  ```json
  {
    "user": {
      "id": "7b8c71b6-f5c2-49e0-811c-d7039a5f36e4",
      "fullName": "Rajesh Sharma",
      "email": "officer.sharma@labellens.gov.in",
      "role": "FIELD_INSPECTOR",
      "district": "Varanasi",
      "state": "Uttar Pradesh",
      "badgeNumber": "UP-LM-4821",
      "createdAt": "2026-09-13T10:05:00.000Z"
    }
  }
  ```

---

### 3.3. File Storage Bridge

#### `POST /api/v1/uploads/raw`
Upload a single image file directly to Cloudinary without running OCR.

- **Auth Required**: Optional
- **Content-Type**: `multipart/form-data`
- **Body Fields**:
  - `file`: File binary (JPEG, PNG, WEBP, GIF, BMP)
- **Response**: `200 OK`
  ```json
  {
    "message": "File uploaded successfully",
    "filename": "sample_label.jpg",
    "secure_url": "https://res.cloudinary.com/upgtqlmf/image/upload/v1/labellens/scans/sample.jpg",
    "public_id": "labellens/scans/b653-sample",
    "format": "jpg",
    "bytes": 241902
  }
  ```

---

### 3.4. Photo Scan Pipeline (End-to-End)

#### `POST /api/v1/uploads/image` (Alias: `POST /api/v1/scans/photo`)
The primary scanning endpoint for mobile and web apps.
Orchestrates: Cloudinary upload -> FastAPI RapidOCR -> Compliance rule validation -> NeonDB persistence.

- **Auth Required**: Optional (If `Bearer <token>` is supplied, inspection is automatically linked to the inspector).
- **Content-Type**: `multipart/form-data`
- **Form Fields**:
  - `file`: Image file binary (JPEG, PNG, WEBP, etc.)
- **Response**: `200 OK`
  ```json
  {
    "scan_id": "f5e6a7b8-1234-5678-9abc-def012345678",
    "status": "NON_COMPLIANT",
    "image_path": "https://res.cloudinary.com/upgtqlmf/image/upload/v1/labellens/scans/scan_123.jpg",
    "cloudinary_public_id": "labellens/scans/scan_123",
    "created_at": "2026-09-13T10:15:30.000Z",
    "compliance_score": 75.0,
    "overall_result": "FAIL",
    "extracted_declarations": [
      {
        "id": "mrp",
        "field_name": "Maximum Retail Price (MRP)",
        "extracted_text": "MRP Rs. 250.00 (Incl. of all taxes)",
        "parsed_value": "250.00",
        "confidence": 0.94,
        "font_size_mm_est": 2.2,
        "status": "COMPLIANT"
      },
      {
        "id": "net_quantity",
        "field_name": "Net Quantity",
        "extracted_text": "Net Wt. 400g",
        "parsed_value": "400g",
        "confidence": 0.91,
        "font_size_mm_est": 2.5,
        "status": "COMPLIANT"
      }
    ],
    "violations": [
      {
        "id": "v1a2b3c4-9876-5432-10fe-dcba98765432",
        "rule_code": "consumer_care",
        "severity": "MAJOR",
        "title": "Consumer Care Details - MISSING",
        "description": "Mandatory declaration 'Consumer Care Details' was not detected on the packaging.",
        "evidence_bbox": null
      }
    ]
  }
  ```

---

#### `GET /api/v1/uploads/:scanId`
Retrieve full inspection details, OCR output, declarations, and violations by ID.

- **Auth Required**: No
- **URL Parameters**:
  - `scanId`: UUID of the inspection
- **Response**: `200 OK`
  ```json
  {
    "scan_id": "f5e6a7b8-1234-5678-9abc-def012345678",
    "status": "NON_COMPLIANT",
    "image_path": "https://res.cloudinary.com/upgtqlmf/image/upload/v1/labellens/scans/scan_123.jpg",
    "created_at": "2026-09-13T10:15:30.000Z",
    "compliance_score": 75.0,
    "extracted_declarations": [ ... ],
    "inspector": {
      "id": "7b8c71b6-f5c2-49e0-811c-d7039a5f36e4",
      "fullName": "Rajesh Sharma",
      "email": "officer.sharma@labellens.gov.in",
      "role": "FIELD_INSPECTOR"
    },
    "violations": [ ... ]
  }
  ```
- **Errors**:
  - `404 Not Found`: Inspection ID does not exist.

---

### 3.5. Video Scan Pipeline (End-to-End)

#### `POST /api/v1/video/frames` (Alias: `POST /api/v1/video/image`)
Extracts multiple faces from cylindrical or 360-degree packaged goods (cans, bottles, boxes).
Orchestrates: FastAPI Universal Unwrap -> Multi-frame parallel Cloudinary upload -> Keyframe OCR & compliance evaluation -> NeonDB persistence.

- **Auth Required**: Optional
- **Content-Type**: `multipart/form-data`
- **Form Fields**:
  - `file`: Video binary (`.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`)
- **Response**: `200 OK`
  ```json
  {
    "scan_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "COMPLIANT",
    "image_path": "https://res.cloudinary.com/upgtqlmf/image/upload/v1/labellens/scans/video_frame_0.jpg",
    "frames_count": 3,
    "frames": [
      {
        "frame_index": 0,
        "image_url": "https://res.cloudinary.com/upgtqlmf/image/upload/v1/labellens/scans/video_frame_0.jpg",
        "cloudinary_public_id": "labellens/scans/video_frame_0_face1"
      },
      {
        "frame_index": 1,
        "image_url": "https://res.cloudinary.com/upgtqlmf/image/upload/v1/labellens/scans/video_frame_1.jpg",
        "cloudinary_public_id": "labellens/scans/video_frame_1_face2"
      }
    ],
    "compliance_score": 100.0,
    "overall_result": "PASS",
    "extracted_declarations": [ ... ],
    "violations": []
  }
  ```

---

#### `GET /api/v1/video/:scanId` (Alias: `/api/v1/video/frames/:scanId`)
Get video inspection results by ID. Returns the same structure as `GET /api/v1/uploads/:scanId`.

---

### 3.6. Inspections Dashboard & Listing

#### `GET /api/v1/inspections`
Paginated inspection listings for dashboard tables, history views, and audit logging.

- **Auth Required**: No
- **Query Parameters**:
  - `page` (integer, default: `1`): Page number.
  - `limit` (integer, default: `20`, max: `100`): Items per page.
  - `status` (string, optional): Filter by `"COMPLIANT"`, `"NON_COMPLIANT"`, or `"PROCESSING"`.
- **Response**: `200 OK`
  ```json
  {
    "page": 1,
    "limit": 20,
    "total": 55,
    "total_pages": 3,
    "items": [
      {
        "scan_id": "f5e6a7b8-1234-5678-9abc-def012345678",
        "status": "NON_COMPLIANT",
        "image_path": "https://res.cloudinary.com/...",
        "compliance_score": 75.0,
        "violations_count": 1,
        "created_at": "2026-09-13T10:15:30.000Z"
      }
    ]
  }
  ```

---

## 4. Frontend Integration Examples

### 4.1. React / Next.js Photo Upload

```tsx
import React, { useState } from "react";
import axios from "axios";

export function LabelScanner() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleScan = async () => {
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const response = await axios.post("http://localhost:3000/api/v1/uploads/image", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      setResult(response.data);
    } catch (err: any) {
      alert(err.response?.data?.message || "Scan failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      <button onClick={handleScan} disabled={loading}>
        {loading ? "Analyzing Label..." : "Scan Product"}
      </button>

      {result && (
        <div>
          <h3>Status: {result.status} (Score: {result.compliance_score}%)</h3>
          <h4>Violations: {result.violations.length}</h4>
          <ul>
            {result.violations.map((v: any) => (
              <li key={v.id}>
                <strong>[{v.severity}] {v.title}:</strong> {v.description}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

### 4.2. React Native / Mobile File Upload

```ts
import * as ImagePicker from "expo-image-picker";

export async function uploadFromCamera(token?: string) {
  const pickerResult = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.9,
  });

  if (pickerResult.canceled) return;

  const photo = pickerResult.assets[0];
  const formData = new FormData();

  formData.append("file", {
    uri: photo.uri,
    name: "label_photo.jpg",
    type: "image/jpeg",
  } as any);

  const response = await fetch("http://YOUR_SERVER_IP:3000/api/v1/uploads/image", {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  return await response.json();
}
```

---

## 5. Developer & Environment Setup

### Environment Variables (`.env`)
Create a `.env` file inside `node-server/`:
`see .env.example`

### Useful CLI Commands

```bash
# Install dependencies
npm install

# Start in development mode with nodemon auto-restart
npm run dev

# Start in production mode
npm start

# Run the complete Fastify integration test suite
npm test

# Push schema changes to PostgreSQL database
npm run prisma:push

# Re-generate Prisma Client
npm run prisma:generate

# Seed default Legal Metrology rules
npm run prisma:seed
```
