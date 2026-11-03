const { MongoClient } = require('mongodb');

const MONGO_URI = "mongodb+srv://parnetstech21_db_user:GGwD1mShraVH8v1w@cluster0.qgrphvw.mongodb.net/sriChakraBackend?appName=Cluster0";

async function main() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db('sriChakraBackend');
    const collection = db.collection('invoices');

    // Fetch invoices BIW2732 to BIW2795
    const invoices = await collection.find({
      invoiceNo: { $gte: "BIW2732", $lte: "BIW2795" }
    }, {
      projection: {
        invoiceNo: 1,
        partyName: 1,
        partyState: 1,
        grandTotal: 1,
        items: 1,
        tallyVoucher: 1
      }
    }).sort({ invoiceNo: 1 }).toArray();

    console.log(`Found ${invoices.length} invoices`);

    // Process each invoice and check for mismatches
    const result = invoices.map(inv => {
      const items = inv.items || [];

      // Sum item-level totals
      const sumCGST    = items.reduce((s, it) => s + (parseFloat(it.cgst)  || 0), 0);
      const sumSGST    = items.reduce((s, it) => s + (parseFloat(it.sgst)  || 0), 0);
      const sumIGST    = items.reduce((s, it) => s + (parseFloat(it.igst)  || 0), 0);
      const sumBasic   = items.reduce((s, it) => s + (parseFloat(it.basic) || 0), 0);
      const sumTotal   = items.reduce((s, it) => s + (parseFloat(it.total) || 0), 0);

      const tv = inv.tallyVoucher || {};
      const tvCGST  = parseFloat(tv._totalCGST)   || 0;
      const tvSGST  = parseFloat(tv._totalSGST)   || 0;
      const tvIGST  = parseFloat(tv._totalIGST)   || 0;
      const tvBase  = parseFloat(tv._salesBase)   || 0;
      const tvGrand = parseFloat(tv._grandTotal)  || 0;

      const round2 = v => Math.round(v * 100) / 100;

      const mismatches = [];
      if (Math.abs(round2(sumCGST) - round2(tvCGST)) > 0.01)
        mismatches.push(`CGST: items_sum=${round2(sumCGST)} vs tallyVoucher=${round2(tvCGST)}`);
      if (Math.abs(round2(sumSGST) - round2(tvSGST)) > 0.01)
        mismatches.push(`SGST: items_sum=${round2(sumSGST)} vs tallyVoucher=${round2(tvSGST)}`);
      if (Math.abs(round2(sumIGST) - round2(tvIGST)) > 0.01)
        mismatches.push(`IGST: items_sum=${round2(sumIGST)} vs tallyVoucher=${round2(tvIGST)}`);
      if (Math.abs(round2(sumBasic) - round2(tvBase)) > 0.01)
        mismatches.push(`Basic/SalesBase: items_sum=${round2(sumBasic)} vs tallyVoucher=${round2(tvBase)}`);

      return {
        invoiceNo: inv.invoiceNo,
        partyName: inv.partyName,
        partyState: inv.partyState,
        grandTotal: inv.grandTotal,
        items: items.map(it => ({
          description: it.description,
          hsn: it.hsn,
          qty: it.qty,
          rate: it.rate,
          basic: it.basic,
          taxRate: it.taxRate,
          cgst: it.cgst,
          sgst: it.sgst,
          igst: it.igst,
          total: it.total,
          tallySalesLedger: it.tallySalesLedger
        })),
        itemSums: {
          basic: round2(sumBasic),
          cgst:  round2(sumCGST),
          sgst:  round2(sumSGST),
          igst:  round2(sumIGST),
          total: round2(sumTotal)
        },
        tallyVoucher: {
          _salesBase:  tv._salesBase,
          _totalCGST:  tv._totalCGST,
          _totalSGST:  tv._totalSGST,
          _totalIGST:  tv._totalIGST,
          _grandTotal: tv._grandTotal
        },
        mismatches: mismatches.length > 0 ? mismatches : null
      };
    });

    // Print full JSON
    console.log(JSON.stringify(result, null, 2));

    // Summary of mismatches
    const withMismatches = result.filter(r => r.mismatches);
    console.error(`\n=== MISMATCH SUMMARY: ${withMismatches.length} invoices with issues ===`);
    withMismatches.forEach(r => {
      console.error(`${r.invoiceNo} (${r.partyName}): ${r.mismatches.join(' | ')}`);
    });

  } finally {
    await client.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
