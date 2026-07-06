import CorporateClient from '../models/CorporateClient.js';
import QuotationClient from '../models/QuotationClient.js';
import InvoiceClient from '../models/InvoiceClient.js';
import AccountsLedger from '../models/AccountsLedger.js';
import DispatchClient from '../models/DispatchClient.js';
import TallySyncLog from '../models/TallySyncLog.js';
import TallyConfig from '../models/TallyConfig.js';

/**
 * Dynamic Data Flow Service
 * Handles automatic data propagation between modules
 */
class DynamicDataFlowService {
  
  /**
   * Propagate corporate client data to all integrated modules
   */
  static async propagateCorporateClientData(clientId, action = 'create') {
    try {
      const client = await CorporateClient.findById(clientId);
      if (!client) throw new Error('Corporate client not found');

      const results = {
        quotation: false,
        invoice: false,
        accounts: false,
        dispatch: false,
        tally: false
      };

      // 1. Create Quotation Module Integration
      results.quotation = await this.integrateWithQuotation(client);
      
      // 2. Create Invoice Module Integration  
      results.invoice = await this.integrateWithInvoice(client);
      
      // 3. Create Accounts Ledger Integration
      results.accounts = await this.integrateWithAccounts(client);
      
      // 4. Create Dispatch Module Integration
      results.dispatch = await this.integrateWithDispatch(client);
      
      // 5. Sync with Tally
      results.tally = await this.syncWithTally(client, action);

      // Update integration status
      await CorporateClient.findByIdAndUpdate(clientId, {
        integrationStatus: results,
        updatedAt: new Date()
      });

      return {
        success: true,
        clientId: client.clientId,
        clientName: client.name,
        integrations: results,
        message: 'Dynamic data flow completed successfully'
      };

    } catch (error) {
      console.error('Dynamic Data Flow Error:', error);
      return {
        success: false,
        error: error.message,
        message: 'Dynamic data flow failed'
      };
    }
  }

  /**
   * Integrate with Quotation Module
   */
  static async integrateWithQuotation(client) {
    try {
      // Check if quotation client already exists
      let quotationClient = await QuotationClient.findOne({ corporateClientId: client._id });
      
      const quotationData = {
        corporateClientId: client._id,
        clientCode: client.clientId,
        clientName: client.name,
        contactPerson: client.contact,
        phone: client.phone,
        email: client.email,
        gstNumber: client.gstNumber,
        panNumber: client.panNumber,
        billingAddress: client.billingAddress,
        shippingAddress: client.shippingAddress,
        paymentTerms: client.paymentTerms,
        creditLimit: client.creditLimit,
        discountPercentage: client.discountPercentage,
        tier: client.tier,
        preferredCurrency: 'INR',
        taxType: this.determineTaxType(client.billingAddress?.state, client.address?.state),
        isActive: client.status === 'Active',
        lastUpdatedFromCorporate: new Date()
      };

      if (quotationClient) {
        // Update existing
        await QuotationClient.findByIdAndUpdate(quotationClient._id, quotationData);
      } else {
        // Create new
        await QuotationClient.create(quotationData);
      }

      console.log('Quotation Integration Success:', client.name);
      return true;
    } catch (error) {
      console.error('Quotation Integration Error:', error);
      return false;
    }
  }

  /**
   * Integrate with Invoice Module
   */
  static async integrateWithInvoice(client) {
    try {
      // Check if invoice client already exists
      let invoiceClient = await InvoiceClient.findOne({ corporateClientId: client._id });
      
      const invoiceData = {
        corporateClientId: client._id,
        clientCode: client.clientId,
        clientName: client.name,
        gstNumber: client.gstNumber,
        panNumber: client.panNumber,
        gstType: 'Regular',
        billingAddress: {
          ...client.billingAddress,
          stateCode: this.getStateCode(client.billingAddress?.state)
        },
        shippingAddress: {
          ...client.shippingAddress,
          stateCode: this.getStateCode(client.shippingAddress?.state)
        },
        contactPerson: client.contact,
        phone: client.phone,
        email: client.email,
        creditLimit: client.creditLimit,
        outstanding: client.outstanding,
        paymentTerms: client.paymentTerms,
        taxPreferences: {
          applyTDS: false,
          tdsPercentage: 0,
          exemptFromTax: false,
          reverseCharge: false
        },
        invoiceSettings: {
          currency: 'INR',
          language: 'English',
          paymentMode: 'NEFT'
        },
        tier: client.tier,
        discountPercentage: client.discountPercentage,
        isActive: client.status === 'Active',
        gstCompliant: !!client.gstNumber,
        lastUpdatedFromCorporate: new Date()
      };

      if (invoiceClient) {
        // Update existing
        await InvoiceClient.findByIdAndUpdate(invoiceClient._id, invoiceData);
      } else {
        // Create new
        await InvoiceClient.create(invoiceData);
      }

      console.log('Invoice Integration Success:', client.name);
      return true;
    } catch (error) {
      console.error('Invoice Integration Error:', error);
      return false;
    }
  }

  /**
   * Integrate with Accounts Module
   */
  static async integrateWithAccounts(client) {
    try {
      // Check if accounts ledger already exists
      let accountsLedger = await AccountsLedger.findOne({ corporateClientId: client._id });
      
      const ledgerData = {
        corporateClientId: client._id,
        ledgerCode: client.clientId,
        ledgerName: client.name,
        ledgerGroup: 'Sundry Debtors',
        ledgerType: 'Customer',
        gstNumber: client.gstNumber,
        panNumber: client.panNumber,
        gstRegistrationType: 'Regular',
        address: client.billingAddress,
        contactPerson: client.contact,
        phone: client.phone,
        email: client.email,
        creditLimit: client.creditLimit,
        openingBalance: 0,
        currentBalance: client.outstanding || 0,
        balanceType: 'Dr',
        paymentTerms: client.paymentTerms,
        interestRate: 0,
        ledgerSettings: {
          billWise: true,
          costCentre: false,
          interestCalculation: false,
          tdsApplicable: false,
          tdsPercentage: 0
        },
        tallyLedgerId: `LED-${client.clientId}`,
        isActive: client.status === 'Active',
        lastUpdatedFromCorporate: new Date()
      };

      if (accountsLedger) {
        // Update existing
        await AccountsLedger.findByIdAndUpdate(accountsLedger._id, ledgerData);
      } else {
        // Create new
        await AccountsLedger.create(ledgerData);
      }

      console.log('Accounts Integration Success:', client.name);
      return true;
    } catch (error) {
      console.error('Accounts Integration Error:', error);
      return false;
    }
  }

  /**
   * Integrate with Dispatch Module
   */
  static async integrateWithDispatch(client) {
    try {
      // Check if dispatch client already exists
      let dispatchClient = await DispatchClient.findOne({ corporateClientId: client._id });
      
      const dispatchData = {
        corporateClientId: client._id,
        clientCode: client.clientId,
        clientName: client.name,
        deliveryAddress: client.shippingAddress || client.billingAddress,
        contactPerson: client.contact,
        phone: client.phone,
        email: client.email,
        deliveryPreferences: {
          preferredTimeSlot: 'Any Time',
          deliveryInstructions: '',
          requiresAppointment: false,
          appointmentLeadTime: 24,
          specialHandling: {
            fragile: false,
            hazardous: false,
            temperatureControlled: false,
            highValue: client.tier === 'Platinum'
          },
          packagingRequirements: client.tier === 'Platinum' ? 'Premium' : 'Standard'
        },
        logisticsInfo: {
          serviceType: client.tier === 'Platinum' ? 'Express' : 'Standard',
          insuranceRequired: client.tier === 'Platinum',
          deliveryCharges: {
            freeDeliveryThreshold: client.tier === 'Platinum' ? 10000 : client.tier === 'Gold' ? 25000 : 50000,
            standardCharges: 100,
            expressCharges: 200
          }
        },
        accessDetails: {
          gatePass: { required: false },
          securityClearance: { required: false },
          workingHours: {
            monday: { start: '09:00', end: '18:00' },
            tuesday: { start: '09:00', end: '18:00' },
            wednesday: { start: '09:00', end: '18:00' },
            thursday: { start: '09:00', end: '18:00' },
            friday: { start: '09:00', end: '18:00' },
            saturday: { start: '09:00', end: '13:00' },
            sunday: { start: '', end: '' }
          }
        },
        deliveryStats: {
          totalDeliveries: 0,
          successfulDeliveries: 0,
          failedDeliveries: 0,
          averageDeliveryTime: 0,
          deliveryRating: 5
        },
        isActive: client.status === 'Active',
        lastUpdatedFromCorporate: new Date()
      };

      if (dispatchClient) {
        // Update existing
        await DispatchClient.findByIdAndUpdate(dispatchClient._id, dispatchData);
      } else {
        // Create new
        await DispatchClient.create(dispatchData);
      }

      console.log('Dispatch Integration Success:', client.name);
      return true;
    } catch (error) {
      console.error('Dispatch Integration Error:', error);
      return false;
    }
  }

  /**
   * Utility method to determine tax type based on state
   */
  static determineTaxType(billingState, shippingState) {
    // If states are different, use IGST, otherwise CGST+SGST
    if (billingState && shippingState && billingState !== shippingState) {
      return 'IGST';
    }
    return 'CGST+SGST';
  }

  /**
   * Utility method to get state code for GST
   */
  static getStateCode(stateName) {
    const stateCodes = {
      'Andhra Pradesh': '28',
      'Arunachal Pradesh': '12',
      'Assam': '18',
      'Bihar': '10',
      'Chhattisgarh': '22',
      'Goa': '30',
      'Gujarat': '24',
      'Haryana': '06',
      'Himachal Pradesh': '02',
      'Jharkhand': '20',
      'Karnataka': '29',
      'Kerala': '32',
      'Madhya Pradesh': '23',
      'Maharashtra': '27',
      'Manipur': '14',
      'Meghalaya': '17',
      'Mizoram': '15',
      'Nagaland': '13',
      'Odisha': '21',
      'Punjab': '03',
      'Rajasthan': '08',
      'Sikkim': '11',
      'Tamil Nadu': '33',
      'Telangana': '36',
      'Tripura': '16',
      'Uttar Pradesh': '09',
      'Uttarakhand': '05',
      'West Bengal': '19',
      'Delhi': '07'
    };
    
    return stateCodes[stateName] || '00';
  }
  static async syncWithTally(client, action = 'create') {
    const syncId = `SYNC-${Date.now()}-${client.clientId}`;
    try {
      const config = await TallyConfig.findOne();
      if (!config) {
        console.log('[DynamicDataFlow] No TallyConfig found, skipping Tally sync');
        return false;
      }
      if (config.connectionStatus !== 'Connected') {
        console.log('[DynamicDataFlow] Tally not connected (status:', config.connectionStatus, '), skipping sync');
        return false;
      }

      // Build the actual Tally local URL (same logic as tallyService.js)
      const localUrl = (config.tallyLocalUrl || '').trim();
      const port     = config.port || '9000';
      let tallyEndpoint = localUrl
        ? (localUrl.match(/:\d+$/) ? localUrl.replace(/\/$/, '') : `${localUrl.replace(/\/$/, '')}:${port}`)
        : null;

      if (!tallyEndpoint) {
        console.warn('[DynamicDataFlow] tallyLocalUrl not configured — cannot push ledger to Tally');
        await TallySyncLog.create({
          syncId,
          type: 'Ledger',
          entity: client.name,
          direction: 'ERP → Tally',
          status: 'Failed',
          error: 'tallyLocalUrl not configured — set Tally machine IP in Tally configuration tab',
          duration: '0s',
          records: 0,
          triggeredBy: client.createdBy
        });
        return false;
      }

      // Generate Tally XML for ledger creation
      const tallyXML = this.generateTallyLedgerXML(client, action);

      console.log('[DynamicDataFlow] Posting ledger XML to Tally:', tallyEndpoint);
      console.log('[DynamicDataFlow] XML body:\n', tallyXML);

      // POST to Tally
      const { default: axios } = await import('axios');
      const startMs = Date.now();
      let responseBody = '';
      try {
        const axiosResp = await axios({
          method: 'POST',
          url: tallyEndpoint,
          data: tallyXML,
          headers: { 'Content-Type': 'text/xml', Accept: '*/*' },
          timeout: 120000,
          responseType: 'text',
          validateStatus: () => true,
        });
        responseBody = typeof axiosResp.data === 'string' ? axiosResp.data : JSON.stringify(axiosResp.data);
        console.log(`[DynamicDataFlow] Tally response HTTP ${axiosResp.status} — ${responseBody.slice(0, 300)}`);
      } catch (httpErr) {
        const duration = `${((Date.now() - startMs) / 1000).toFixed(1)}s`;
        console.error('[DynamicDataFlow] HTTP POST to Tally failed:', httpErr.message);
        await TallySyncLog.create({
          syncId,
          type: 'Ledger',
          entity: client.name,
          direction: 'ERP → Tally',
          status: 'Failed',
          error: `HTTP error: ${httpErr.message}`,
          duration,
          records: 0,
          triggeredBy: client.createdBy
        });
        await CorporateClient.findByIdAndUpdate(client._id, {
          'tallySync.synced': false,
          'tallySync.syncStatus': 'Failed',
          'tallySync.syncError': httpErr.message
        });
        return false;
      }

      const duration = `${((Date.now() - startMs) / 1000).toFixed(1)}s`;

      // Parse Tally response for errors
      const hasError = responseBody.includes('<LINEERROR>') || responseBody.includes('<ERRORS>');
      const created  = parseInt(responseBody.match(/<CREATED>(\d+)<\/CREATED>/i)?.[1] || '0');
      const altered  = parseInt(responseBody.match(/<ALTERED>(\d+)<\/ALTERED>/i)?.[1] || '0');
      const syncOk   = !hasError || (created > 0 || altered > 0);

      if (!syncOk) {
        const errMatch = responseBody.match(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/i);
        const errMsg   = errMatch ? errMatch[1].trim() : 'Tally returned an error response';
        console.error('[DynamicDataFlow] Tally rejected ledger:', errMsg);
        await TallySyncLog.create({
          syncId, type: 'Ledger', entity: client.name, direction: 'ERP → Tally',
          status: 'Failed', error: errMsg, duration, records: 0, triggeredBy: client.createdBy
        });
        await CorporateClient.findByIdAndUpdate(client._id, {
          'tallySync.synced': false, 'tallySync.syncStatus': 'Failed', 'tallySync.syncError': errMsg
        });
        return false;
      }

      console.log(`[DynamicDataFlow] Ledger "${client.name}" synced to Tally — created:${created} altered:${altered}`);

      await TallySyncLog.create({
        syncId, type: 'Ledger', entity: client.name, direction: 'ERP → Tally',
        status: 'Success', duration, records: 1, triggeredBy: client.createdBy
      });

      await CorporateClient.findByIdAndUpdate(client._id, {
        tallyLedgerId: `LED-${client.clientId}`,
        'tallySync.synced': true,
        'tallySync.lastSyncAt': new Date(),
        'tallySync.syncStatus': 'Success'
      });

      return true;
    } catch (error) {
      console.error('[DynamicDataFlow] syncWithTally unexpected error:', error);

      await TallySyncLog.create({
        syncId, type: 'Ledger', entity: client.name, direction: 'ERP → Tally',
        status: 'Failed', error: error.message, records: 0, triggeredBy: client.createdBy
      }).catch(() => {});

      await CorporateClient.findByIdAndUpdate(client._id, {
        'tallySync.synced': false, 'tallySync.syncStatus': 'Failed', 'tallySync.syncError': error.message
      }).catch(() => {});

      return false;
    }
  }

  /**
   * Generate Tally XML for ledger creation
   */
  static generateTallyLedgerXML(client, action) {
    const actionType = action === 'create' ? 'Create' : action === 'update' ? 'Alter' : 'Create';
    
    return `
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <LEDGER NAME="${client.name}" ACTION="${actionType}">
            <OLDAUDITENTRYIDS.LIST TYPE="Number">
              <OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>
            </OLDAUDITENTRYIDS.LIST>
            <GUID>${client.clientId}-GUID</GUID>
            <PARENT>Sundry Debtors</PARENT>
            <LEDGERNAME>${client.name}</LEDGERNAME>
            <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
            <PARTYGSTIN>${client.gstNumber || ''}</PARTYGSTIN>
            <PARTYPAN>${client.panNumber || ''}</PARTYPAN>
            <CREDITLIMIT>${client.creditLimit}</CREDITLIMIT>
            <ISBILLWISEON>Yes</ISBILLWISEON>
            <ISCOSTCENTRESON>No</ISCOSTCENTRESON>
            <ISINTERESTON>No</ISINTERESTON>
            <ALLOWINMOBILE>No</ALLOWINMOBILE>
            <ISCOSTTRACKINGON>No</ISCOSTTRACKINGON>
            <ISBENEFICIARYCODEON>No</ISBENEFICIARYCODEON>
            <ISUPDATINGTARGETID>No</ISUPDATINGTARGETID>
            <ASORIGINAL>Yes</ASORIGINAL>
            <ISCONDENSED>No</ISCONDENSED>
            <AFFECTSSTOCK>No</AFFECTSSTOCK>
            <USEFORVAT>No</USEFORVAT>
            <IGNOREPHYSICALDIFFERENCE>No</IGNOREPHYSICALDIFFERENCE>
            <IGNORENEGATIVESTOCK>No</IGNORENEGATIVESTOCK>
            <TREATSALESASMANUFACTURED>No</TREATSALESASMANUFACTURED>
            <TREATPURCHASESASCONSUMED>No</TREATPURCHASESASCONSUMED>
            <TREATEXPENSESASCONSUMED>No</TREATEXPENSESASCONSUMED>
            <ADDRESS.LIST>
              <ADDRESS>${client.billingAddress?.street || ''}, ${client.billingAddress?.area || ''}</ADDRESS>
              <ADDRESS>${client.billingAddress?.city || ''}, ${client.billingAddress?.state || ''} - ${client.billingAddress?.pincode || ''}</ADDRESS>
            </ADDRESS.LIST>
          </LEDGER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`.trim();
  }

  /**
   * Bulk sync all pending clients with Tally
   */
  static async bulkSyncWithTally() {
    try {
      const pendingClients = await CorporateClient.getPendingTallySync();
      const results = [];

      for (const client of pendingClients) {
        const result = await this.propagateCorporateClientData(client._id, 'create');
        results.push({
          clientId: client.clientId,
          clientName: client.name,
          success: result.success
        });
      }

      return {
        success: true,
        totalClients: pendingClients.length,
        results,
        message: `Bulk sync completed for ${pendingClients.length} clients`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Bulk sync failed'
      };
    }
  }

  /**
   * Get integration status for a client
   */
  static async getClientIntegrationStatus(clientId) {
    try {
      const client = await CorporateClient.findById(clientId);
      if (!client) throw new Error('Client not found');

      return {
        success: true,
        clientId: client.clientId,
        clientName: client.name,
        integrationStatus: client.integrationStatus,
        tallySync: client.tallySync,
        lastUpdated: client.updatedAt
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default DynamicDataFlowService;