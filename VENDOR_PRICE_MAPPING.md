# Vendor Price Mapping Feature - Implementation Guide

## Overview
The Vendor Price Mapping feature allows you to track and manage product-specific pricing for each vendor. This enables:
- Vendor-specific pricing comparison
- Bulk PO creation with accurate vendor rates
- Price history tracking
- Lead time management per vendor

## Database Schema

### VendorPrice Model
```javascript
{
  vendor: ObjectId (ref: Vendor),           // Vendor reference
  productName: String,                      // Product name (required)
  productCode: String,                      // SKU/Product code (optional)
  unit: String,                             // Unit type (pcs, kg, ltr, mtr, etc.)
  unitPrice: Number,                        // Price per unit (required)
  currency: String,                         // Currency (default: INR)
  minOrderQty: Number,                      // Minimum order quantity
  leadTimeDays: Number,                     // Lead time in days
  isActive: Boolean,                        // Active/Inactive status
  notes: String,                            // Additional notes
  createdAt: Date,                          // Created timestamp
  updatedAt: Date                           // Updated timestamp
}
```

## API Endpoints

### 1. Get All Prices for a Vendor
**GET** `/api/vendors/:vendorId/prices`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "vendor": "507f1f77bcf86cd799439010",
      "productName": "Steel Rod 10mm",
      "productCode": "SKU-1042",
      "unit": "kg",
      "unitPrice": 45.50,
      "minOrderQty": 100,
      "leadTimeDays": 3,
      "isActive": true,
      "notes": "High quality steel",
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### 2. Add Price Entry for a Vendor
**POST** `/api/vendors/:vendorId/prices`

**Request Body:**
```json
{
  "productName": "Steel Rod 10mm",
  "productCode": "SKU-1042",
  "unit": "kg",
  "unitPrice": 45.50,
  "minOrderQty": 100,
  "leadTimeDays": 3,
  "isActive": true,
  "notes": "High quality steel"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "vendor": "507f1f77bcf86cd799439010",
    "productName": "Steel Rod 10mm",
    "productCode": "SKU-1042",
    "unit": "kg",
    "unitPrice": 45.50,
    "minOrderQty": 100,
    "leadTimeDays": 3,
    "isActive": true,
    "notes": "High quality steel",
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:00Z"
  }
}
```

### 3. Update Price Entry
**PUT** `/api/vendors/:vendorId/prices/:priceId`

**Request Body:** (same as POST)

**Response:** Updated price object

### 4. Delete Price Entry
**DELETE** `/api/vendors/:vendorId/prices/:priceId`

**Response:**
```json
{
  "success": true,
  "message": "Price entry deleted"
}
```

### 5. Compare Prices Across Vendors
**GET** `/api/vendors/prices/product?productCode=SKU-1042&productName=Steel`

**Query Parameters:**
- `productCode` (optional): Filter by product code
- `productName` (optional): Filter by product name (case-insensitive)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "vendor": {
        "_id": "507f1f77bcf86cd799439010",
        "companyName": "Vendor A",
        "vendorId": "V-001",
        "rating": 4.5
      },
      "productName": "Steel Rod 10mm",
      "productCode": "SKU-1042",
      "unitPrice": 45.50,
      "unit": "kg",
      "minOrderQty": 100,
      "leadTimeDays": 3,
      "isActive": true
    },
    {
      "_id": "507f1f77bcf86cd799439012",
      "vendor": {
        "_id": "507f1f77bcf86cd799439011",
        "companyName": "Vendor B",
        "vendorId": "V-002",
        "rating": 4.2
      },
      "productName": "Steel Rod 10mm",
      "productCode": "SKU-1042",
      "unitPrice": 42.00,
      "unit": "kg",
      "minOrderQty": 50,
      "leadTimeDays": 5,
      "isActive": true
    }
  ]
}
```

## Frontend Usage

### VendorPriceMapping Component
Located at: `src/pages/procurement/components/VendorPriceMapping.jsx`

**Props:**
- `vendorId` (string): The vendor's MongoDB ID
- `vendorName` (string): The vendor's company name
- `onClose` (function): Callback when closing the component

**Features:**
- View all prices for a vendor
- Add new price entries
- Edit existing prices
- Delete price entries
- Real-time validation

**Example Usage:**
```jsx
import VendorPriceMapping from './VendorPriceMapping';

<VendorPriceMapping 
  vendorId={vendor._id} 
  vendorName={vendor.companyName}
  onClose={() => setShowPriceMapping(false)}
/>
```

### API Client
Located at: `src/api/vendorPriceApi.js`

**Methods:**
```javascript
// Get all prices for a vendor
vendorPriceApi.getVendorPrices(vendorId)

// Add a new price entry
vendorPriceApi.addPrice(vendorId, data)

// Update a price entry
vendorPriceApi.updatePrice(vendorId, priceId, data)

// Delete a price entry
vendorPriceApi.deletePrice(vendorId, priceId)

// Compare prices across vendors
vendorPriceApi.getPricesByProduct({ productCode, productName })
```

## Integration with Bulk PO Upload

The vendor price mapping data will be used in the Bulk PO Upload feature to:
1. Auto-populate unit prices when creating POs
2. Validate minimum order quantities
3. Calculate lead times for delivery scheduling
4. Suggest best vendors based on pricing

## Testing the Feature

### Manual Testing Steps:

1. **Add a Vendor**
   - Navigate to Procurement → Vendors
   - Click "Add New Vendor"
   - Fill in vendor details and save

2. **Add Price Entries**
   - Click "View" on the vendor
   - Click "Price Mapping" tab
   - Click "Add Price"
   - Fill in product details and save

3. **Edit Price Entries**
   - Click the edit icon on any price entry
   - Modify the details
   - Click "Save Price"

4. **Compare Prices**
   - Go to Procurement → Purchase Orders
   - When creating a PO, the system will show prices from all vendors for the selected product

5. **Delete Price Entries**
   - Click the delete icon on any price entry
   - Confirm deletion

## Troubleshooting

### Issue: Prices not loading
- Check browser console for errors
- Verify vendor ID is correct
- Ensure authentication token is valid
- Check backend logs for API errors

### Issue: Cannot add price
- Verify product name is not empty
- Ensure unit price is greater than 0
- Check that vendor exists in the system

### Issue: Price comparison not working
- Verify product code or name is entered correctly
- Check that prices exist for multiple vendors
- Ensure prices are marked as "Active"

## Future Enhancements

1. **Price History Tracking**
   - Track price changes over time
   - Generate price trend reports

2. **Bulk Price Import**
   - Import prices from Excel/CSV
   - Update multiple prices at once

3. **Price Alerts**
   - Alert when vendor prices change
   - Notify when prices exceed thresholds

4. **Discount Management**
   - Volume-based discounts
   - Seasonal discounts
   - Loyalty discounts

5. **Price Approval Workflow**
   - Require approval for price changes
   - Audit trail for price modifications
