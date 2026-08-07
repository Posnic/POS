const { ObjectId } = require('mongodb');

/**
 * PHP: returnReceivingOrder()
 * Process return of receiving items
 * @param {Object} data - Return data including id, items, items_return
 * @returns {Promise<Object>}
 */
async function returnReceivingOrder(data) {
  try {
    const BaseModel = require('./base.model');

    if (!data || !data.id) {
      return {
        status: false,
        data: null,
        message: 'Return receiving value is null',
      };
    }

    const baseModel = new BaseModel('receivings');
    const collection = await baseModel.getCollection('receivings');
    const itemsCollection = await baseModel.getCollection('items');
    const taxCollection = await baseModel.getCollection('grouptax');

    const license = BaseModel.license;
    const loggedUser = BaseModel.loggedUser;
    const loggedUserName = BaseModel.loggedUserName || '';
    const currentBranch = BaseModel.currentBranch;
    const currentBranchName = BaseModel.currentBranchName || '';
    const currentBranchState = BaseModel.currentBranchState || '';

    const receivingId = new ObjectId(data.id);
    const returnItems = data.items_return || [];
    const itemsReturn = [];

    // Get branch to check stock_management setting (PHP line 562)
    const branchesCollection = await baseModel.getCollection('branches');
    const branchDoc = await branchesCollection.findOne({
      _id: new ObjectId(currentBranch),
    });

    const stockManagement = branchDoc?.stock_management === true;
    const stockLogStatus = branchDoc?.stock_management_log !== false;

    console.log('[RETURN RECEIVING DEBUG] Stock log context:', {
      stockManagement: stockManagement,
      stockLogStatus: stockLogStatus,
      returnItemCount: returnItems.length,
    });

    // Process each return item
    for (const item of returnItems) {
      const returnPrefixId =
        'RFP' +
        new Date().toISOString().slice(0, 10).replace(/-/g, '') +
        Math.floor(Math.random() * 10000);

      const itemDoc = await itemsCollection.findOne({
        _id: new ObjectId(item.item_id),
        license: new ObjectId(license),
      });

      if (!itemDoc) continue;

      let igstValue = 0.0;
      let csgstValue = 0.0;
      let returnIgstValue = 0.0;
      let returnCsgstValue = 0.0;

      if (data.supplier_state !== currentBranchState) {
        igstValue = parseFloat(item.gst || 0);
        returnIgstValue = parseFloat(item.return_gst || 0);
      } else {
        csgstValue = parseFloat(item.gst || 0) / 2;
        returnCsgstValue = parseFloat(item.return_gst || 0) / 2;
      }

      // Update or remove item from receiving based on remaining quantity
      if (parseFloat(item.item_quantity) > 0) {
        await collection.updateOne(
          { _id: receivingId, 'items.item_id': item.item_id, license: new ObjectId(license) },
          {
            $set: {
              'items.$.item_quantity': parseFloat(item.item_quantity),
              'items.$.total_amount': parseFloat(item.total_amount),
              'items.$.igst_tax': parseFloat(igstValue),
              'items.$.cgst_tax': parseFloat(csgstValue),
              'items.$.sgst_tax': parseFloat(csgstValue),
            },
          }
        );
      } else {
        await collection.updateOne(
          { _id: receivingId, 'items.item_id': item.item_id, license: new ObjectId(license) },
          { $pull: { items: { item_id: item.item_id } } }
        );
      }

      // Update inventory - reduce quantity
      const returnQuantity = parseFloat(item.return_quantity || 0);

      console.log('[RETURN RECEIVING DEBUG] Item check:', {
        item_id: item.item_id,
        track_inventory: itemDoc?.track_inventory,
        track_inventory_type: typeof itemDoc?.track_inventory,
      });

      if (itemDoc.track_inventory === true || itemDoc.track_inventory === 'true') {
        const openingBalance = parseFloat(itemDoc.available_quantity || 0);
        const newQuantity = openingBalance - returnQuantity;

        // Create stock log for RETURN Receiving (PHP line 562-564)
        // Only if stock_management is enabled
        if (stockManagement) {
          console.log('[RETURN RECEIVING DEBUG] Creating stock log for item:', item.item_id);

          const stockLogData = {
            stocklog: stockLogStatus,
            branch_id: new ObjectId(currentBranch),
            view_item_id: new ObjectId(item.item_id),
            item_barcode_id: itemDoc.barcode_id || '',
            item_name: item.item_name || itemDoc.name || '',
            item_quantity: returnQuantity,
            process: 'Return Receiving',
            reference: data.id,
            opening_balance: openingBalance,
            closing_balance: newQuantity,
            count: '-' + returnQuantity,
            date: new Date(),
            action: 'Subtract',
            changed_by_userid: new ObjectId(loggedUser),
            changed_by: loggedUserName,
            license: new ObjectId(license),
            created_date: new Date(),
            updated_date: new Date(),
          };

          const stockLogsCollection = await baseModel.getCollection('stocklogs');
          await stockLogsCollection.insertOne(stockLogData);
          console.log('[RETURN RECEIVING] Stock log created successfully');
        } else {
          console.log('[RETURN RECEIVING DEBUG] Stock management disabled, skipping stock log');
        }

        await itemsCollection.updateOne(
          { _id: new ObjectId(item.item_id), license: new ObjectId(license) },
          { $set: { available_quantity: newQuantity } }
        );
      }

      // Get or create tax
      let taxFields, itemTax, taxName;
      const taxDoc = await taxCollection.findOne({
        branch_id: new ObjectId(currentBranch),
        rate: parseFloat(item.item_tax || 0),
        license: new ObjectId(license),
      });

      if (taxDoc) {
        taxFields = taxDoc.tax_fields || [];
        itemTax = taxDoc.rate;
        taxName = taxDoc.name;
      } else {
        const newTaxData = {
          branch_id: new ObjectId(currentBranch),
          branch_name: currentBranchName,
          name: `${item.item_tax}% Tax`,
          rate: parseFloat(item.item_tax || 0),
          tax_fields: [],
          tax_group: 'no',
          created_date: new Date(),
          created_by: loggedUserName,
          created_by_id: new ObjectId(loggedUser),
          updated_date: new Date(),
          updated_by: loggedUserName,
          updated_by_id: new ObjectId(loggedUser),
          license: new ObjectId(license),
        };

        const insertResult = await taxCollection.insertOne(newTaxData);
        const taxArrayData = {
          tax_id: insertResult.insertedId,
          tax_name: `${item.item_tax}% Tax`,
          tax_value: parseFloat(item.item_tax || 0),
        };

        await taxCollection.updateOne(
          { _id: insertResult.insertedId, license: new ObjectId(license) },
          { $push: { tax_fields: taxArrayData } }
        );

        taxFields = [taxArrayData];
        itemTax = item.item_tax;
        taxName = `${item.item_tax}% Tax`;
      }

      itemsReturn.push({
        item_name: item.item_name,
        item_sku: itemDoc.itemid,
        item_price: parseFloat(itemDoc.company_price || 0),
        item_quantity: parseFloat(returnQuantity),
        item_unit: item.item_unit || 'qty',
        item_id: item.item_id,
        total_amount: parseFloat(item.return_total_amount || 0),
        tax: parseFloat(itemTax),
        tax_type: 'exclusive',
        tax_name: taxName,
        igst_tax: parseFloat(returnIgstValue),
        cgst_tax: parseFloat(returnCsgstValue),
        sgst_tax: parseFloat(returnCsgstValue),
        return_id: returnPrefixId,
        return_date: new Date(),
        tax_fields: taxFields,
      });
    }

    // Create return record
    const returnObjId = new ObjectId();
    const itemsReturnData = {
      returnArray: {
        returnObjId: returnObjId,
        returnId:
          'RFP' +
          new Date().toISOString().slice(0, 10).replace(/-/g, '') +
          Math.floor(Math.random() * 10000),
        returnDate: new Date(),
        returnValue: itemsReturn,
      },
    };

    await collection.updateOne(
      { _id: receivingId, license: new ObjectId(license) },
      { $push: { items_return: itemsReturnData } }
    );

    // Recalculate totals
    const receivingDoc = await collection.findOne({
      _id: receivingId,
      license: new ObjectId(license),
    });

    let receivingTotalAmount = 0;
    let receivingTaxAmount = 0;
    let receivingSubtotalAmount = 0;

    for (const item of receivingDoc.items || []) {
      receivingTotalAmount += parseFloat(item.total_amount || 0);
      const itemQuantity = parseFloat(item.item_quantity || 0);
      const itemAmount = parseFloat(item.item_price || 0) * itemQuantity;
      const itemTax = parseFloat(item.tax || 0);
      const itemSubTaxTotal = (itemAmount / 100) * itemTax;
      receivingTaxAmount += itemSubTaxTotal;
      receivingSubtotalAmount += itemAmount;
    }

    let returnTotalAmount = 0;
    let returnTaxAmount = 0;
    let returnSubtotalAmount = 0;

    for (const returnRecord of receivingDoc.items_return || []) {
      for (const item of returnRecord.returnArray?.returnValue || []) {
        returnTotalAmount += parseFloat(item.total_amount || 0);
        const itemQuantity = parseFloat(item.item_quantity || 0);
        const itemAmount = parseFloat(item.item_price || 0) * itemQuantity;
        const itemTax = parseFloat(item.tax || 0);
        const itemSubTaxTotal = (itemAmount / 100) * itemTax;
        returnTaxAmount += itemSubTaxTotal;
        returnSubtotalAmount += itemAmount;
      }
    }

    const updateData = {
      receiving_status: receivingTotalAmount === 0 ? 'FullReturn' : 'PartialReturn',
      tax: Math.round(receivingTaxAmount * 100) / 100,
      items_subtotal: receivingSubtotalAmount,
      items_total: receivingTotalAmount,
      return_tax: Math.round(returnTaxAmount * 100) / 100,
      items_return_subtotal: returnSubtotalAmount,
      items_return_total: returnTotalAmount,
      updated_date: new Date(),
    };

    await collection.updateOne({ _id: receivingId }, { $set: updateData });

    return {
      status: true,
      data: {
        print: false,
        receiving_id: returnObjId.toString(),
      },
      message: 'Return receiving updated successfully',
    };
  } catch (error) {
    console.error('Error in returnReceivingOrder:', error);
    return {
      status: false,
      data: null,
      message: error.message || 'Failed to process return receiving',
    };
  }
}

module.exports = { returnReceivingOrder };
