'use strict';

// Presentation only. Signed contributions never grant data access or register
// arbitrary host routes, URLs, selectors or executable handlers.
function uiContributions(contributes = {}, hasView = false) {
  const menu = ['sales', 'inventory', 'manage'].includes(contributes?.menu)
    ? contributes.menu
    : null;
  const page = contributes?.page;
  if (page !== undefined) {
    if (
      !page ||
      typeof page !== 'object' ||
      Array.isArray(page) ||
      Object.keys(page).some((key) => key !== 'header') ||
      !['host', 'extension'].includes(page.header) ||
      !hasView
    )
      throw new Error('extension_page_contribution_invalid');
  }
  return {
    menu: hasView ? menu : null,
    page: Object.freeze({ header: page?.header || 'host' }),
  };
}

module.exports = { uiContributions };
