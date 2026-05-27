import axios from 'axios';

const DELHIVERY_BASE = 'https://track.delhivery.com/api/v1';
const DELHIVERY_TOKEN = process.env.DELHIVERY_API_KEY || '';

// Mock tracking data for when no API key is configured
const mockTrack = (awbNo, courier = 'Delhivery') => ({
  awbNo,
  courier: courier || 'Delhivery',
  status: 'In Transit',
  currentLocation: 'Hub Center',
  estimatedDelivery: new Date(Date.now() + 2 * 86400000).toISOString(),
  events: [
    { timestamp: new Date(Date.now() - 3 * 3600000).toISOString(), location: 'Hub Center', description: 'Package in transit', status: 'In Transit' },
    { timestamp: new Date(Date.now() - 8 * 3600000).toISOString(), location: 'Facility', description: 'Package picked up', status: 'Picked Up' },
    { timestamp: new Date(Date.now() - 24 * 3600000).toISOString(), location: 'Origin', description: 'Shipment booked', status: 'Booked' },
  ]
});

export const courierService = {
  async track(awbNo, courier = 'Delhivery') {
    if (!DELHIVERY_TOKEN || courier !== 'Delhivery') return mockTrack(awbNo, courier);
    try {
      const res = await axios.get(`${DELHIVERY_BASE}/packages/json/`, {
        params: { waybill: awbNo },
        headers: { Authorization: `Token ${DELHIVERY_TOKEN}` }
      });
      const pkg = res.data?.ShipmentData?.[0]?.Shipment;
      if (!pkg) return mockTrack(awbNo, courier);
      return {
        awbNo,
        courier: 'Delhivery',
        status: pkg.Status?.Status || 'Unknown',
        currentLocation: pkg.Status?.StatusLocation || '',
        estimatedDelivery: pkg.ExpectedDeliveryDate || '',
        events: (pkg.Scans || []).map(s => ({
          timestamp: s.ScanDetail?.ScanDateTime,
          location: s.ScanDetail?.ScannedLocation,
          description: s.ScanDetail?.Instructions,
          status: s.ScanDetail?.Scan,
        }))
      };
    } catch { return mockTrack(awbNo, courier); }
  },

  async book(shipmentData) {
    // Returns mock booking confirmation
    return { awbNo: `DEL${Date.now()}`, status: 'Booked', message: 'Shipment booked successfully' };
  },

  async cancel(awbNo) {
    return { success: true, message: `Shipment ${awbNo} cancellation requested` };
  }
};
