# Expected column mappings for the sample fixtures

## Products

Product Name -> name
SKU -> itemid
Barcode -> barcode_id
Category -> category_name
Vendor -> supplier_name
MRP -> mrp_price
Cost Price -> company_price
Rate -> selling_price
GST % -> tax
Stock -> available_quantity
Unit -> unit

## Customers

Customer Name -> name
Mobile -> phone
Email Address -> email
Billing Address -> address

## Invalid customers

File: invalid-customers.csv

Expected result:
ERROR - Missing required column: Billing Address
