/**
 * Sales Module Constants
 * Centralized constants for sale-related operations.
 */

// Error messages reused across the sales module
const ERROR_MESSAGES = {
  PAY_TOTAL_INVALID: 'Pay Total cannot be zero or less than zero.',
  BRANCH_LICENSE_REQUIRED: 'Branch and License context missing',
  ITEM_REMOVED: 'This product has already been removed, so you can not modify anything.',
  INVALID_ITEM_ID: 'Enter must correct item id',
  VALIDATION_ERROR: 'Validation Error',
  UNAUTHORIZED_UPDATE_SALES: 'You do not have permission to update sales',
  INVALID_SALE_ID: 'Invalid sale id supplied',
  INVALID_SALE_PAYLOAD: 'Invalid sale payload supplied',
  AT_LEAST_ONE_VALID_SALE_ITEM_REQUIRED: 'At least one valid sale item is required',
  BRANCH_CONTEXT_REQUIRED_UPDATE: 'Branch context is required to update a sale',
  SALES_DETAILS_NOT_FOUND: 'Sales Details Not Found',
  FAILED_TO_UPDATE_SALE_UNEXPECTED: 'Failed to update sale (unexpected service response)',
  SALES_NOT_UPDATED: 'Sales not updated',
  UNAUTHORIZED_VIEW_SALES: 'You do not have permission to view sales',
  UNAUTHORIZED_DELETE_SALES: 'You do not have permission to delete sales',
  NO_VALID_SALE_IDS_FOR_DELETE: 'No valid sale ids supplied for delete',
  SALES_NOT_DELETED: 'Sales Not deleted',
  FAILED_TO_SAVE_SALE_UNEXPECTED: 'Failed to save sale (unexpected service response)',
  SALES_NOT_ADDED: 'Sales not added',
  FAILED_TO_PROCESS_SALE: 'Failed to process sale',
  UNAUTHORIZED: 'Unauthorized',
  MISSING_BRANCH_AND_DATE_PARAMS: 'Missing required parameters: branch, starting_date, ending_date',
  INVALID_BRANCH_ID_FORMAT: 'Invalid branch id format',
  BRANCH_NOT_FOUND: 'Branch not found',
  INVALID_DATE_FORMAT: 'Invalid date format',
  SERVER_ERROR: 'Server error',
  DETAILS_NOT_FOUND: 'Details Not Found',
  VALID_EMAIL_REQUIRED: 'Valid email required',
  SALE_ID_REQUIRED: 'Sale ID required',
  SALES_ID_REQUIRED: 'Sales ID required',
  SALE_ID_REQUIRED_CAP: 'Sale ID Required',
  SALE_ID_IS_REQUIRED: 'Sale id is required',
  SALE_NOT_FOUND: 'Sale not found',
  SALES_NOT_FOUND_ALT: 'Sales Not Found',
  NO_SALES_IDS_FOR_EXPORT: 'No sales IDs provided for export',
  SALES_EXPORTED_UNSUCCESSFULLY: 'Sales exported unsuccessfully',
  AT_LEAST_ONE_BRANCH_ID_REQUIRED: 'At least one branch id is required',
  NO_VALID_BRANCH_IDS_PROVIDED: 'No valid branch ids provided',
  A_VALID_INSTANT_SALE_ID_REQUIRED: 'A valid instant sale id is required',
  SALE_NOT_FOUND_FOR_SELECTED_BRANCH: 'Sale not found for selected branch',
  CUSTOMER_NAME_REQUIRED: 'Customer name is required',
  MISSING_REPORT_PAYLOAD_DATA: 'Missing report payload: "data"',
  FAILED_TO_SEND_EMAIL_PREFIX: 'Failed to send email: ',
  FAILED_TO_RETRIEVE_USER_SALES_REPORT_PREFIX: 'Failed to retrieve user sales report: ',
  FAILED_TO_RETRIEVE_USER_GRAPHICAL_REPORTS_PREFIX: 'Failed to retrieve user graphical reports: ',
  FAILED_TO_RETRIEVE_RETURN_SALES_REPORT_PREFIX: 'Failed to retrieve return sales report: ',
  FAILED_TO_RETRIEVE_PRODUCT_BASED_RETURN_DETAILS_PREFIX:
    'Failed to retrieve product based return details: ',
  FAILED_TO_RETRIEVE_PENDING_SALES_REPORT_PREFIX: 'Failed to retrieve pending sales report: ',
  FAILED_TO_RETRIEVE_PENDING_CUSTOMER_REPORT_PREFIX: 'Failed to retrieve pending customer report: ',
  FAILED_TO_RETRIEVE_TAX_SALES_REPORT_PREFIX: 'Failed to retrieve tax sales report: ',
  FAILED_TO_RETRIEVE_PAYMENT_SALES_TRANSACTION_REPORT_PREFIX:
    'Failed to retrieve payment sales transaction report: ',
  FAILED_TO_RETRIEVE_PAYMENT_SALE_TYPE_REPORT_PREFIX:
    'Failed to retrieve payment sale type report: ',
  FAILED_TO_RETRIEVE_PAYMENT_RETURN_SALES_TRANSACTION_REPORT_PREFIX:
    'Failed to retrieve payment return sales transaction report: ',
  FAILED_TO_RETRIEVE_PAYMENT_GRAPHICAL_REPORTS_PREFIX:
    'Failed to retrieve payment graphical reports: ',
  UNABLE_TO_GENERATE_PDF: 'Unable to generate PDF',
  RECENT_SALES_NOT_RETRIEVED: 'Recent Sales Not Retrived ',
  NOT_VALID_INPUT: 'Not valid Input',
  ACTIVE_ORDERS_PERMISSION_DENIED: 'You do not have permission to view active orders',
  BRANCH_CONTEXT_REQUIRED: 'Branch context required',
  ACTIVE_ORDERS_FETCH_ERROR: 'An error occurred while fetching active orders',
  BRANCH_ID_REQUIRED: 'Branch ID is required',
  ORDER_ID_AND_ITEMS_REQUIRED: 'Order ID and items are required',
  BRANCH_ID_AND_SEARCH_QUERY_REQUIRED: 'Branch ID and search query are required',
  KOT_TABLEWISE_DETAILS_NOT_FOUND: 'KOT Tablewise Details Not Found',
  INCORRECT_FILTER_FORMAT: 'Incorrect format of filter',
  DATE_RANGE_REQUIRED: 'Date range is required',
};

// Success messages reused across the sales module
const SUCCESS_MESSAGES = {
  SALE_CREATED: 'Sale created successfully',
  SALE_UPDATED: 'Sale updated successfully',
  SALE_DELETED: 'Sale deleted successfully',
  SALES_EXPORTED: 'Sales exported successfully',
  SALE_ADDED: 'Sale added successfully',
  SALES_RETRIEVED: 'Sales retrieved successfully',
  SALES_DELETED: 'Sales deleted successfully',
  GET_SUCCESSFULLY: 'Get Successfully',
  GET_SUCCESSFULLY_LOWER: 'Get successfully',
  NO_RECORDS_FOUND: 'No records found',
  RECENT_SALES_RETRIEVED: 'Recent Sales Retrived',
  PAYMENT_PROCESSED_SUCCESSFULLY: 'Payment processed successfully',
  GENERIC_SUCCESS_LOWER: 'success',
  SALE_HOLD_SUCCESS: 'Sales has been successfully hold',
  SERVER_IS_RUNNING: 'Server is running',
  RETURN_SALES_UPDATED_SUCCESSFULLY: 'Return Sales updated successfully',
  CHANGES_RETRIEVED: 'Changes Retrieved',
  RECENT_SALE_RETRIEVED: 'Recent Sale Retrieved',
  RECENT_SALE_NOT_RETRIEVED: 'Recent Sale Not Retrieved',
  SALES_RECEIPT_EMAIL_SUCCESS: 'Sales receipt email sent successfully',
};

// Legacy payment mode and sale process labels used by the sales model
// for enum validation and legacy report helpers. These mirror the
// original PHP values and should not be changed without a compatible
// migration.
const PAYMENT_MODE_VALUES = ['Cash', 'Cheque', 'CreditCard', 'Pending', 'Qrpay', 'Other'];

const SALE_PROCESS_VALUES = ['Add', 'Edit', 'Hold', 'PartialReturn', 'Return', 'KOT'];

const GRAPH_ALLOWED_SALE_PROCESSES = ['Add', 'Edit', 'PartialReturn'];

module.exports = {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  PAYMENT_MODE_VALUES,
  SALE_PROCESS_VALUES,
  GRAPH_ALLOWED_SALE_PROCESSES,
};
