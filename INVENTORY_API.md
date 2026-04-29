# Inventory Module API Documentation

## Overview
Complete backend API for the Inventory Management System including warehouses, stock, movements, batches, picking lists, and defective stock tracking.

## Base URL
```
http://localhost:5000/api
```

## Authentication
All endpoints require authentication. Include JWT token in Authorization header:
```
Authorization: Bearer <token>
```

---

## 1. Inventory Management

### Get All Inventory Items
```http
GET /inventory
```

**Query Parameters:**
- `status` (optional): Filter by status (Active, Critical, Dead, Inactive)
- `warehouse` (optional): Filter by warehouse ID
- `search` (optional): Search by SKU or item name

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "sku": "SKU-1042",
      "name": "Bearing 6205",
      "warehouse": { "warehouseId": "WH-01", "name": "Main Warehouse" },
      "quantity": 12,
      "minQuantity": 50,
      "status": "Critical",
      "batch": "B-2024-04",
      "location": {
        "zone": "Z-A",
        "rack": "R-A1",
        "shelf": "S-A1-1",
        "bin": "BIN-A1-1-01"
      },
      "unitPrice": 120,
      "totalValue": 1440
    }
  ]
}
```

### Get Single Inventory Item
```http
GET /inventory/:id
```

### Create Inventory Item
```http
POST /inventory
```

**Request Body:**
```json
{
  "sku": "SKU-1042",
  "name": "Bearing 6205",
  "category": "category_id",
  "warehouse": "warehouse_id",
  "quantity": 12,
  "minQuantity": 50,
  "unit": "units",
  "batch": "B-2024-04",
  "unitPrice": 120,
  "location": {
    "zone": "Z-A",
    "rack": "R-A1",
    "shelf": "S-A1-1",
    "bin": "BIN-A1-1-01"
  }
}
```

### Update Inventory Item
```http
PUT /inventory/:id
```

### Delete Inventory Item
```http
DELETE /inventory/:id
```

### Adjust Stock Quantity
```http
PATCH /inventory/:id/adjust
```

**Request Body:**
```json
{
  "quantity": 100,
  "reason": "Physical count adjustment",
  "reference": "ADJ-001"
}
```

### Get Dashboard Statistics
```http
GET /inventory/stats
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalStock": 867,
    "lowStock": 3,
    "deadStock": 1,
    "activeSkus": 7,
    "stockByCategory": [
      { "label": "Raw Materials", "value": 420 },
      { "label": "Finished Goods", "value": 310 }
    ]
  }
}
```

---

## 2. Warehouse Management

### Get All Warehouses
```http
GET /warehouses
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "warehouseId": "WH-01",
      "name": "Main Warehouse",
      "location": "Pune - Sector 4",
      "capacity": 5000,
      "used": 3200,
      "manager": "Rajesh Patil",
      "status": "Active",
      "skus": 142,
      "zones": [...]
    }
  ]
}
```

### Get Single Warehouse
```http
GET /warehouses/:id
```

### Create Warehouse
```http
POST /warehouses
```

**Request Body:**
```json
{
  "warehouseId": "WH-04",
  "name": "New Warehouse",
  "location": "Mumbai - Andheri",
  "capacity": 3000,
  "manager": "John Doe",
  "status": "Active"
}
```

### Update Warehouse
```http
PUT /warehouses/:id
```

### Delete Warehouse
```http
DELETE /warehouses/:id
```

### Add Zone to Warehouse
```http
POST /warehouses/:id/zones
```

**Request Body:**
```json
{
  "zoneId": "Z-D",
  "name": "Zone D — Packaging",
  "color": "#f59e0b",
  "racks": [
    {
      "rackId": "R-D1",
      "name": "Rack D1",
      "shelves": [
        {
          "shelfId": "S-D1-1",
          "bins": ["BIN-D1-1-01", "BIN-D1-1-02"]
        }
      ]
    }
  ]
}
```

### Update Zone
```http
PUT /warehouses/:id/zones/:zoneId
```

---

## 3. Stock Movement

### Get All Stock Movements
```http
GET /stock-movements
```

**Query Parameters:**
- `type` (optional): Filter by type (Inward, Outward, Transfer, Adjustment)
- `startDate` (optional): Filter from date
- `endDate` (optional): Filter to date

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "movementId": "MV-001",
      "type": "Inward",
      "inventory": { "sku": "SKU-3301", "name": "Piston Ring 80mm" },
      "quantity": 200,
      "from": "Supplier",
      "to": "WH-01",
      "reference": "GRN-0234",
      "performedBy": { "name": "John Doe" },
      "createdAt": "2024-04-14T09:15:00Z"
    }
  ]
}
```

### Get Single Movement
```http
GET /stock-movements/:id
```

### Create Stock Movement
```http
POST /stock-movements
```

**Request Body:**
```json
{
  "type": "Inward",
  "inventoryId": "inventory_id",
  "quantity": 200,
  "from": "Supplier",
  "to": "WH-01",
  "reference": "GRN-0234",
  "remarks": "New stock received"
}
```

### Transfer Stock Between Warehouses
```http
POST /stock-movements/transfer
```

**Request Body:**
```json
{
  "inventoryId": "inventory_id",
  "quantity": 50,
  "fromWarehouse": "warehouse_id_1",
  "toWarehouse": "warehouse_id_2",
  "reference": "TR-0045",
  "remarks": "Stock transfer"
}
```

### Delete Movement
```http
DELETE /stock-movements/:id
```

---

## 4. Batch Management

### Get All Batches
```http
GET /batches
```

**Query Parameters:**
- `status` (optional): Filter by status
- `warehouse` (optional): Filter by warehouse ID

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "batchNumber": "B-2024-04",
      "inventory": { "sku": "SKU-3301", "name": "Piston Ring 80mm" },
      "quantity": 340,
      "warehouse": { "name": "WH-03" },
      "manufacturingDate": "2024-04-01",
      "expiryDate": "2026-04-01",
      "status": "Active",
      "shelfLifePercentage": 90
    }
  ]
}
```

### Get Single Batch
```http
GET /batches/:id
```

### Create Batch
```http
POST /batches
```

**Request Body:**
```json
{
  "inventoryId": "inventory_id",
  "quantity": 340,
  "warehouse": "warehouse_id",
  "manufacturingDate": "2024-04-01",
  "expiryDate": "2026-04-01"
}
```

### Update Batch
```http
PUT /batches/:id
```

### Delete Batch
```http
DELETE /batches/:id
```

### Get Ageing Stock Report
```http
GET /batches/ageing-report
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "batchNumber": "B-2024-04",
      "sku": "SKU-1042",
      "itemName": "Bearing 6205",
      "warehouse": "WH-01",
      "quantity": 12,
      "lastMovement": "2024-02-01",
      "days": 45,
      "bucket": "31–60",
      "value": "₹1,440",
      "action": "Monitor",
      "actionColor": "#f59e0b"
    }
  ]
}
```

---

## 5. Picking Lists

### Get All Picking Lists
```http
GET /picking-lists
```

**Query Parameters:**
- `status` (optional): Filter by status (Pending, In Progress, Completed, Cancelled)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "pickId": "PCK-001",
      "orderId": "ORD-2024-089",
      "items": [
        {
          "inventory": { "sku": "SKU-3301", "name": "Piston Ring 80mm" },
          "quantity": 50,
          "location": "WH-01 / A3",
          "picked": true
        }
      ],
      "picker": { "name": "Ramesh" },
      "status": "Completed"
    }
  ]
}
```

### Get Single Picking List
```http
GET /picking-lists/:id
```

### Create Picking List
```http
POST /picking-lists
```

**Request Body:**
```json
{
  "orderId": "ORD-2024-089",
  "items": [
    {
      "inventoryId": "inventory_id",
      "quantity": 50,
      "location": "WH-01 / A3"
    }
  ],
  "pickerId": "user_id"
}
```

### Update Picking List
```http
PUT /picking-lists/:id
```

### Mark Item as Picked
```http
PATCH /picking-lists/:id/items/:itemId/pick
```

### Delete Picking List
```http
DELETE /picking-lists/:id
```

---

## 6. Defective Stock

### Get All Defective Stock
```http
GET /defective-stock
```

**Query Parameters:**
- `stage` (optional): Filter by stage (QC Hold, Defective Bin, Repair, Disposed, Returned)
- `source` (optional): Filter by source

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "defectId": "DEF-001",
      "inventory": { "sku": "SKU-1042", "name": "Bearing 6205" },
      "quantity": 3,
      "defectType": "Dimensional",
      "source": "GRN Inspection",
      "stage": "QC Hold",
      "daysAged": 1,
      "reportedBy": { "name": "John Doe" }
    }
  ]
}
```

### Get Single Defective Stock
```http
GET /defective-stock/:id
```

### Create Defective Stock Record
```http
POST /defective-stock
```

**Request Body:**
```json
{
  "inventoryId": "inventory_id",
  "quantity": 3,
  "defectType": "Dimensional",
  "source": "GRN Inspection",
  "remarks": "Out of tolerance"
}
```

### Update Defective Stock
```http
PUT /defective-stock/:id
```

### Update Defective Stock Stage
```http
PATCH /defective-stock/:id/stage
```

**Request Body:**
```json
{
  "stage": "Repair",
  "remarks": "Sent for repair"
}
```

### Delete Defective Stock
```http
DELETE /defective-stock/:id
```

---

## Error Responses

All endpoints return consistent error responses:

```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error message (in development mode)"
}
```

**Common HTTP Status Codes:**
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `404` - Not Found
- `500` - Internal Server Error

---

## Models Schema Reference

### Inventory
- `sku` (String, required, unique)
- `name` (String, required)
- `category` (ObjectId, ref: Category)
- `warehouse` (ObjectId, ref: Warehouse, required)
- `quantity` (Number, required, default: 0)
- `minQuantity` (Number, required, default: 0)
- `unit` (String, required, default: 'units')
- `batch` (String)
- `status` (String, enum: Active/Critical/Dead/Inactive)
- `location` (Object: zone, rack, shelf, bin)
- `unitPrice` (Number, default: 0)
- `totalValue` (Number, auto-calculated)

### Warehouse
- `warehouseId` (String, required, unique)
- `name` (String, required)
- `location` (String, required)
- `capacity` (Number, required)
- `used` (Number, default: 0)
- `manager` (String)
- `status` (String, enum: Active/Inactive/Maintenance)
- `zones` (Array of zone objects)

### StockMovement
- `movementId` (String, required, unique)
- `type` (String, enum: Inward/Outward/Transfer/Adjustment)
- `inventory` (ObjectId, ref: Inventory)
- `sku` (String, required)
- `itemName` (String, required)
- `quantity` (Number, required)
- `from` (String, required)
- `to` (String, required)
- `reference` (String)
- `remarks` (String)
- `performedBy` (ObjectId, ref: User)

### Batch
- `batchNumber` (String, required, unique)
- `inventory` (ObjectId, ref: Inventory)
- `sku` (String, required)
- `itemName` (String, required)
- `quantity` (Number, required)
- `warehouse` (ObjectId, ref: Warehouse)
- `manufacturingDate` (Date, required)
- `expiryDate` (Date)
- `status` (String, enum: Active/Critical/Dead/Expired)
- `shelfLifePercentage` (Number, auto-calculated)

### PickingList
- `pickId` (String, required, unique)
- `orderId` (String, required)
- `items` (Array of item objects)
- `picker` (ObjectId, ref: User)
- `status` (String, enum: Pending/In Progress/Completed/Cancelled)

### DefectiveStock
- `defectId` (String, required, unique)
- `inventory` (ObjectId, ref: Inventory)
- `sku` (String, required)
- `itemName` (String, required)
- `quantity` (Number, required)
- `defectType` (String, enum: Dimensional/Surface Defect/Packaging Damage/Material Defect/Other)
- `source` (String, enum: GRN Inspection/Production/Customer Return/Internal Audit)
- `stage` (String, enum: QC Hold/Defective Bin/Repair/Disposed/Returned)
- `daysAged` (Number, default: 0)
- `remarks` (String)
- `reportedBy` (ObjectId, ref: User)

---

## Seeding Data

To seed sample inventory data:

```bash
node seedInventory.js
```

This will create:
- 3 Warehouses with zones and racks
- 8 Inventory items with different statuses
- 3 Batches
- 3 Stock movements
- 2 Defective stock records
- 2 Picking lists
