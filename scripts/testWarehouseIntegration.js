import axios from 'axios';

const API_BASE = 'http://localhost:5001/api/api/api';

// Mock auth token (replace with real token)
const headers = {
  'Authorization': 'Bearer test-token',
  'Content-Type': 'application/json'
};

const tests = {
  async testGetWarehouses() {
    try {
      console.log('\n📦 Testing: Get All Warehouses');
      const response = await axios.get(`${API_BASE}/warehouses`, { headers });
      console.log('✓ Success:', response.data.data.length, 'warehouses found');
      return response.data.data[0]?._id;
    } catch (error) {
      console.error('✗ Error:', error.response?.data?.message || error.message);
    }
  },

  async testGetWarehousesWithData() {
    try {
      console.log('\n📊 Testing: Get Warehouses with Automatic Data');
      const response = await axios.get(`${API_BASE}/warehouses/data/all`, { headers });
      const wh = response.data.data[0];
      console.log('✓ Success:');
      console.log('  - Warehouse:', wh.name);
      console.log('  - SKUs:', wh.skus);
      console.log('  - Total Quantity:', wh.totalQuantity);
      console.log('  - Capacity:', wh.capacityPercent + '%');
      console.log('  - Status:', wh.capacityStatus);
    } catch (error) {
      console.error('✗ Error:', error.response?.data?.message || error.message);
    }
  },

  async testGetWarehouseSummary(warehouseId) {
    try {
      console.log('\n📋 Testing: Get Warehouse Summary');
      const response = await axios.get(`${API_BASE}/warehouses/${warehouseId}/summary`, { headers });
      const data = response.data.data;
      console.log('✓ Success:');
      console.log('  - Warehouse:', data.name);
      console.log('  - Location:', data.location);
      console.log('  - Total Capacity:', data.totalCapacity);
      console.log('  - Used Capacity:', data.usedCapacity);
      console.log('  - Capacity %:', data.capacityPercent + '%');
      console.log('  - SKU Count:', data.skuCount);
      console.log('  - Total Quantity:', data.totalQuantity);
      console.log('  - Zones:', data.zones);
    } catch (error) {
      console.error('✗ Error:', error.response?.data?.message || error.message);
    }
  },

  async testGetWarehouseCapacity(warehouseId) {
    try {
      console.log('\n⚡ Testing: Get Warehouse Capacity');
      const response = await axios.get(`${API_BASE}/warehouses/${warehouseId}/capacity`, { headers });
      const data = response.data.data;
      console.log('✓ Success:');
      console.log('  - Total Capacity:', data.totalCapacity);
      console.log('  - Used Capacity:', data.usedCapacity);
      console.log('  - Available Capacity:', data.availableCapacity);
      console.log('  - Capacity %:', data.capacityPercent + '%');
      console.log('  - Status:', data.status);
    } catch (error) {
      console.error('✗ Error:', error.response?.data?.message || error.message);
    }
  },

  async testGetWarehouseZones(warehouseId) {
    try {
      console.log('\n🗺️  Testing: Get Warehouse Zones');
      const response = await axios.get(`${API_BASE}/warehouses/${warehouseId}/zones`, { headers });
      const zones = response.data.data;
      console.log('✓ Success:', zones.length, 'zones found');
      zones.forEach(zone => {
        console.log(`  - ${zone.name} (${zone.racks?.length || 0} racks)`);
      });
    } catch (error) {
      console.error('✗ Error:', error.response?.data?.message || error.message);
    }
  },

  async testSyncWarehouseCapacity(warehouseId) {
    try {
      console.log('\n🔄 Testing: Sync Warehouse Capacity');
      const response = await axios.get(`${API_BASE}/warehouses/${warehouseId}/sync`, { headers });
      const data = response.data.data;
      console.log('✓ Success:');
      console.log('  - Total Capacity:', data.totalCapacity);
      console.log('  - Used Capacity:', data.usedCapacity);
      console.log('  - Capacity %:', data.capacityPercent + '%');
    } catch (error) {
      console.error('✗ Error:', error.response?.data?.message || error.message);
    }
  },

  async testAddZone(warehouseId) {
    try {
      console.log('\n➕ Testing: Add Zone to Warehouse');
      const response = await axios.post(
        `${API_BASE}/warehouses/${warehouseId}/zones`,
        {
          zoneId: 'Z-TEST',
          name: 'Test Zone',
          color: '#9333ea',
          racks: []
        },
        { headers }
      );
      console.log('✓ Success: Zone added');
      console.log('  - Zone ID:', response.data.data.zones[response.data.data.zones.length - 1].zoneId);
    } catch (error) {
      console.error('✗ Error:', error.response?.data?.message || error.message);
    }
  }
};

async function runTests() {
  console.log('🧪 Warehouse Integration Tests');
  console.log('================================');

  const warehouseId = await tests.testGetWarehouses();
  
  if (warehouseId) {
    await tests.testGetWarehousesWithData();
    await tests.testGetWarehouseSummary(warehouseId);
    await tests.testGetWarehouseCapacity(warehouseId);
    await tests.testGetWarehouseZones(warehouseId);
    await tests.testSyncWarehouseCapacity(warehouseId);
    await tests.testAddZone(warehouseId);
  }

  console.log('\n✅ Tests completed');
}

runTests().catch(console.error);
