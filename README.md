# Chakra Industries Backend - Procurement Module

Production-ready backend API with proper CRUD operations, clean architecture, and separate routers for Vendors and Purchase Orders.

## Project Structure

```
chakraIndustries-backend/
├── config/
│   └── database.js                  # MongoDB connection
├── models/
│   ├── Vendor.js                   # Vendor schema with validation
│   └── PurchaseOrder.js            # Purchase Order schema
├── controllers/
│   ├── vendorController.js         # Vendor CRUD handlers
│   └── purchaseOrderController.js  # PO CRUD handlers
├── services/
│   ├── vendorService.js            # Vendor business logic
│   └── purchaseOrderService.js     # PO business logic
├── routes/
│   ├── vendorRoutes.js             # Vendor endpoints
│   └── purchaseOrderRoutes.js      # PO endpoints
├── server.js                        # Express app setup
├── package.json
├── .env
└── README.md
```

## Installation & Setup

1. Install dependencies:
```bash
npm install
```

2. Configure `.env`:
```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/chakra_industries
NODE_ENV=development
JWT_SECRET=your_jwt_secret_key_here
```

3. Start server:
```bash
npm start
```

Development mode with auto-reload:
```bash
npm run dev
```

## API Endpoints

### Vendor Routes (`/api/vendors`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/` | Create new vendor |
| GET | `/` | Get all vendors (with pagination & filters) |
| GET | `/stats` | Get vendor statistics |
| GET | `/status/:status` | Get vendors by status (Active/Inactive/Blacklisted) |
| GET | `/:id` | Get single vendor by ID |
| PUT | `/:id` | Update vendor details |
| DELETE | `/:id` | Delete vendor |

### Purchase Order Routes (`/api/purchase-orders`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/` | Create new purchase order |
| GET | `/` | Get all POs (with pagination & filters) |
| GET | `/stats` | Get PO statistics |
| GET | `/:id` | Get single PO by ID |
| PUT | `/:id` | Update PO details |
| PATCH | `/:id/status` | Update PO status only |
| DELETE | `/:id` | Delete PO |

## Request/Response Examples

### Create Vendor
```bash
POST /api/vendors
Content-Type: application/json

{
  "companyName": "Shree Metals Pvt Ltd",
  "category": "Raw Material",
  "contactPerson": "Ramesh Gupta",
  "phone": "9876543210",
  "email": "ramesh@shreemetals.com",
  "address": "123 Industrial Area",
  "city": "Pune",
  "state": "Maharashtra",
  "pincode": "411001",
  "gstNumber": "27AABCT1234H1Z0",
  "paymentTerms": "Net 30",
  "status": "Active"
}
```

### Create Purchase Order
```bash
POST /api/purchase-orders
Content-Type: application/json

{
  "vendorId": "507f1f77bcf86cd799439011",
  "poDate": "2024-04-15",
  "deliveryDate": "2024-04-30",
  "items": [
    {
      "itemName": "Bearing 6205",
      "quantity": 100,
      "basePrice": 450,
      "gstPercentage": 18
    }
  ],
  "deliveryAddress": "Warehouse A, Pune",
  "specialInstructions": "Handle with care"
}
```

### Get All Vendors with Filters
```bash
GET /api/vendors?status=Active&category=Raw%20Material&page=1&limit=10&search=Shree
```

### Update PO Status
```bash
PATCH /api/purchase-orders/:id/status
Content-Type: application/json

{
  "status": "Approved"
}
```

## Features

✅ **Complete CRUD Operations** - Create, Read, Update, Delete for all entities  
✅ **Pagination & Filtering** - Get vendors/POs with search, filters, and pagination  
✅ **Validation** - Input validation with meaningful error messages  
✅ **Auto-ID Generation** - Unique IDs (V-001, PO-2024-089, etc.)  
✅ **Calculations** - Automatic GST and total calculations for POs  
✅ **Statistics** - Aggregated stats for dashboards  
✅ **Error Handling** - Comprehensive error handling with proper HTTP status codes  
✅ **Timestamps** - Automatic createdAt and updatedAt tracking  
✅ **Relationships** - Proper MongoDB references between entities  

## Technologies

- **Express.js** - Web framework
- **MongoDB** - NoSQL database
- **Mongoose** - ODM with validation
- **Node.js** - Runtime

## Response Format

All responses follow a consistent format:

**Success:**
```json
{
  "success": true,
  "message": "Operation successful",
  "data": { /* entity data */ },
  "pagination": { /* optional */ }
}
```

**Error:**
```json
{
  "success": false,
  "message": "Error description"
}
```

## Status Codes

- `200` - OK
- `201` - Created
- `400` - Bad Request
- `404` - Not Found
- `500` - Server Error

