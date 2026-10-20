/* Shared receipt design contract. Loaded in the dashboard and required by the API. */
/* global window */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PosnicReceiptDesign = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function taxLabel(data, fallbackCountry) {
    data = data || {};
    const country = String(
      data.branch_country || data.country || data.sortname || fallbackCountry || ''
    )
      .trim()
      .toLowerCase();
    if (['in', 'ind', 'india', 'au', 'aus', 'australia'].includes(country)) return 'GST';
    if (
      [
        'gb',
        'gbr',
        'uk',
        'united kingdom',
        'united kingdom of great britain and northern ireland',
        'za',
        'zaf',
        'south africa',
      ].includes(country)
    )
      return 'VAT';
    return 'Tax';
  }
  function taxRegistrationLabel(data, fallbackCountry) {
    data = data || {};
    const country = String(
      data.branch_country || data.country || data.sortname || fallbackCountry || ''
    )
      .trim()
      .toLowerCase();
    if (
      [
        'gb',
        'gbr',
        'uk',
        'united kingdom',
        'united kingdom of great britain and northern ireland',
      ].includes(country)
    )
      return 'VAT No.';
    if (['in', 'ind', 'india'].includes(country)) return 'GSTIN';
    if (country) return 'Tax ID';
    // Preserve existing Indian documents which predate saved country details.
    return 'GSTIN';
  }
  const formats = {
    58: { name: '58 mm thermal', width: 58, content: 48, font: 10 },
    80: { name: '80 mm thermal', width: 80, content: 72, font: 12 },
    112: { name: '112 mm thermal', width: 112, content: 104, font: 12 },
    a4: { name: 'A4', width: 210, height: 297, content: 186, font: 12 },
    a5: { name: 'A5', width: 148, height: 210, content: 124, font: 11 },
    letter: { name: 'US Letter', width: 215.9, height: 279.4, content: 191.9, font: 12 },
  };
  const fields = {
    customer_name: 'Customer name',
    customer_phone: 'Customer phone',
    customer_email: 'Customer email',
    customer_address: 'Customer address',
    customer_tax_number: 'Customer tax number',
    total_quantity: 'Total quantity',
    brand_url: 'Brand website',
    sale_note: 'Sale note',
    table: 'Table',
    order_type: 'Order type',
    covers: 'Covers',
    steward: 'Steward',
    session: 'Session',
    fssai: 'FSSAI licence number',
    source: 'Order source',
  };
  const restaurant = ['table', 'order_type', 'covers', 'steward', 'session', 'fssai', 'source'];
  function fieldAvailable(field, branch = {}) {
    const restaurantEnabled = [true, 'true', 'enable'].includes(branch.table_options);
    if (field === 'fssai') {
      const country = String(branch.branch_country || branch.country || '')
        .trim()
        .toUpperCase();
      // A saved food licence also supports food retailers without restaurant workflows.
      const foodBusiness =
        restaurantEnabled || Boolean(String(branch.branch_fssai_number || '').trim());
      return ['INDIA', 'IN', 'IND'].includes(country) && foodBusiness;
    }
    return !restaurant.includes(field) || restaurantEnabled;
  }
  const types = [
    'store',
    'transaction',
    'items',
    'totals',
    'logo',
    'text',
    'field',
    'qr',
    'image',
    'barcode',
    'divider',
    'signature',
  ];
  const required = ['store', 'transaction', 'items', 'totals'];
  const textTypes = ['store', 'transaction', 'items', 'totals', 'text', 'field', 'signature'];
  function image(value) {
    return (
      typeof value === 'string' &&
      value.length <= 400000 &&
      /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
    );
  }
  function layoutFor(value, format) {
    const layout = value.layouts[format];
    if (format === '112' && layout === undefined && Array.isArray(value.layouts['80']?.blocks)) {
      return JSON.parse(JSON.stringify(value.layouts['80']));
    }
    // Designs saved before A5 shipped keep their A4 content as an independent
    // starting point, with text sized for the smaller sheet. Nothing is mutated.
    if (format === 'a5' && layout === undefined && Array.isArray(value.layouts.a4?.blocks)) {
      return {
        fontSize: formats.a5.font,
        blocks: JSON.parse(JSON.stringify(value.layouts.a4.blocks)),
      };
    }
    return layout;
  }
  function normalize(value) {
    if (
      !value ||
      value.version !== 1 ||
      !Object.prototype.hasOwnProperty.call(formats, value.defaultFormat) ||
      !value.layouts
    )
      throw new Error('Choose a valid receipt format.');
    if (JSON.stringify(value).length > 1800000)
      throw new Error('Receipt images are too large. Use smaller images.');
    const out = {
      version: 1,
      defaultFormat: value.defaultFormat,
      showBranding: value.showBranding !== false,
      layouts: {},
    };
    if (value.brandingText != null) {
      if (typeof value.brandingText !== 'string' || value.brandingText.length > 200)
        throw new Error('Receipt footer text must be at most 200 characters.');
      out.brandingText = value.brandingText.trim();
    }
    if (value.customHeading != null) {
      if (typeof value.customHeading !== 'string' || value.customHeading.length > 60)
        throw new Error('Custom receipt heading must be at most 60 characters.');
      out.customHeading = value.customHeading.trim();
    }
    if (value.quoteFooter != null) {
      const q = value.quoteFooter;
      if (
        !q ||
        !['none', 'custom', 'thirukkural'].includes(q.source) ||
        !['sequential', 'random', 'fixed'].includes(q.order)
      )
        throw new Error('Choose a valid quote library and order.');
      if (
        !Array.isArray(q.quotes) ||
        q.quotes.length > 200 ||
        q.quotes.some((text) => typeof text !== 'string' || text.length > 600)
      )
        throw new Error('Use up to 200 quotes, each at most 600 characters.');
      const quotes = q.quotes.map((text) => text.trim()).filter(Boolean);
      if (q.source === 'custom' && !quotes.length) throw new Error('Add at least one quote.');
      out.quoteFooter = { source: q.source, order: q.order, quotes };
      if (q.order === 'fixed' && q.source !== 'none') {
        const maximum = q.source === 'thirukkural' ? 1330 : quotes.length;
        if (
          !Number.isInteger(q.selectedNumber) ||
          q.selectedNumber < 1 ||
          q.selectedNumber > maximum
        )
          throw new Error('Choose a quote number between 1 and ' + maximum + '.');
        out.quoteFooter.selectedNumber = q.selectedNumber;
      }
      if (q.qrSizeMm !== undefined) {
        if (![18, 22, 26].includes(q.qrSizeMm))
          throw new Error('Choose a QR size of 18, 22 or 26 mm.');
        out.quoteFooter.qrSizeMm = q.qrSizeMm;
      }
      if (q.showQr !== undefined) {
        if (typeof q.showQr !== 'boolean')
          throw new Error('Choose whether to show the Thirukkural QR code.');
        out.quoteFooter.showQr = q.showQr;
      }
    }
    Object.keys(formats).forEach(function (format) {
      const layout = layoutFor(value, format);
      if (!layout || !Array.isArray(layout.blocks) || layout.blocks.length > 40)
        throw new Error('Each design must have at most 40 blocks.');
      const size = Number(layout.fontSize);
      if (!Number.isFinite(size) || size < 8 || size > 18)
        throw new Error('Text size must be between 8 and 18 px.');
      const seen = new Set();
      const blocks = layout.blocks.map(function (block) {
        if (!block || !types.includes(block.type)) throw new Error('Unknown receipt block.');
        if (!/^[a-zA-Z0-9_-]{1,60}$/.test(block.id || '') || seen.has(block.id))
          throw new Error('Receipt blocks need unique identifiers.');
        seen.add(block.id);
        const b = {
          id: block.id,
          type: block.type,
          align: ['left', 'center', 'right'].includes(block.align) ? block.align : 'left',
        };
        if (block.type === 'field') {
          if (!Object.prototype.hasOwnProperty.call(fields, block.field))
            throw new Error('Unknown receipt field.');
          b.field = block.field;
          b.width = block.width == null ? 100 : Number(block.width);
          if (![50, 100].includes(b.width))
            throw new Error('Choose full or half width for a field.');
        }
        if (block.type === 'items') {
          if (block.heading != null) {
            if (typeof block.heading !== 'string' || block.heading.length > 40)
              throw new Error('Item heading must be at most 40 characters.');
            b.heading = block.heading.trim();
          }
          b.hsn = block.hsn === true;
          b.showRowNumbers = block.showRowNumbers === true;
          b.showUnit = block.showUnit === true;
          if (block.rowNumberLabel != null) {
            if (typeof block.rowNumberLabel !== 'string' || block.rowNumberLabel.length > 12)
              throw new Error('Row number label must be at most 12 characters.');
            b.rowNumberLabel = block.rowNumberLabel.trim();
          }
          if (block.lineStyle != null) {
            if (!['solid', 'dashed', 'dotted'].includes(block.lineStyle))
              throw new Error('Choose a valid separator style.');
            b.lineStyle = block.lineStyle;
          }
          b.itemLayout = block.itemLayout || 'detailed';
          if (!['detailed', 'compact', 'columns'].includes(b.itemLayout))
            throw new Error('Choose a valid item layout.');
        }
        if (block.type === 'totals') b.showPaymentMethod = block.showPaymentMethod !== false;
        if (block.type === 'items' && block.nameMaxChars != null) {
          b.nameMaxChars = Number(block.nameMaxChars);
          if (!Number.isInteger(b.nameMaxChars) || b.nameMaxChars < 8 || b.nameMaxChars > 80)
            throw new Error('Item name length must be between 8 and 80 characters.');
        }
        if (block.type === 'transaction' && block.showTitle === false) b.showTitle = false;
        if (block.type === 'transaction') {
          if (block.labelText != null) {
            if (typeof block.labelText !== 'string' || block.labelText.length > 40)
              throw new Error('Receipt label must be at most 40 characters.');
            b.labelText = block.labelText.trim();
          }
          for (const [key, values] of Object.entries({
            dateFormat: ['auto', 'dmy', 'dmy-short', 'mdy', 'ymd'],
            timeFormat: ['auto', '12h', '24h', 'none'],
          })) {
            if (block[key] != null) {
              if (!values.includes(block[key]))
                throw new Error('Choose a valid receipt date or time format.');
              b[key] = block[key];
            }
          }
        }
        if (block.type === 'store') {
          for (const [key, max] of Object.entries({
            nameText: 200,
            addressText: 1000,
            phoneText: 100,
            emailText: 200,
            registrationText: 100,
            fssaiText: 100,
          })) {
            if (block[key] != null) {
              if (typeof block[key] !== 'string' || block[key].length > max)
                throw new Error('Store receipt text is too long.');
              if (block[key].trim()) b[key] = block[key].trim();
            }
          }
          for (const key of ['showName', 'showAddress', 'showPhone', 'showRegistration']) {
            if (block[key] === false) b[key] = false;
          }
        }
        if (block.type === 'store' && block.fssaiInHeader === true) b.fssaiInHeader = true;
        if (block.type === 'store' && block.showEmail === false) b.showEmail = false;
        if (textTypes.includes(block.type)) {
          b.bold = block.bold === true;
          if (block.fontSize != null && block.fontSize !== '') {
            const fontSize = Number(block.fontSize);
            if (!Number.isFinite(fontSize) || fontSize < 8 || fontSize > 32)
              throw new Error('Block text size must be between 8 and 32 px.');
            b.fontSize = fontSize;
          }
        }
        if (block.type === 'divider') {
          b.lineStyle = block.lineStyle || 'dashed';
          if (!['solid', 'dashed', 'dotted'].includes(b.lineStyle))
            throw new Error('Choose a solid, dashed or dotted divider.');
          b.width = block.width == null ? 100 : Number(block.width);
          b.thickness = block.thickness == null ? 1 : Number(block.thickness);
          if (!Number.isFinite(b.width) || b.width < 15 || b.width > 100)
            throw new Error('Divider width must be between 15 and 100 percent.');
          if (!Number.isFinite(b.thickness) || b.thickness < 1 || b.thickness > 4)
            throw new Error('Divider thickness must be between 1 and 4 px.');
        }
        if (block.type === 'text' || block.type === 'qr') {
          b.text = String(block.text || '');
          if (b.text.length > 1000)
            throw new Error('Text and QR content must be 1,000 characters or fewer.');
          if (block.type === 'qr' && !b.text.trim())
            throw new Error('Enter content for every QR code.');
          b.bold = block.bold === true;
        }
        if (block.type === 'image' || block.type === 'qr' || block.type === 'signature') {
          if (block.type === 'image' && !image(block.src))
            throw new Error('Upload a PNG, JPEG or WebP image for each image block.');
          // Signatures always come from the branch, never a stale per-layout copy.
          if (block.type !== 'signature' && image(block.src)) b.src = block.src;
          b.width = Math.max(
            15,
            Math.min(100, Number(block.width) || (block.type === 'qr' ? 45 : 60))
          );
        }
        return b;
      });
      required.forEach(function (type) {
        if (
          blocks.filter(function (b) {
            return b.type === type;
          }).length !== 1
        )
          throw new Error(
            'Keep one store, receipt details, items and totals block in every design.'
          );
      });
      if (
        blocks.findIndex((b) => b.type === 'totals') < blocks.findIndex((b) => b.type === 'items')
      )
        throw new Error('Place totals after the items.');
      out.layouts[format] = { fontSize: size, blocks: blocks };
    });
    return out;
  }
  return {
    taxLabel: taxLabel,
    taxRegistrationLabel: taxRegistrationLabel,
    formats: formats,
    fields: fields,
    restaurant: restaurant,
    fieldAvailable: fieldAvailable,
    types: types,
    required: required,
    textTypes: textTypes,
    image: image,
    normalize: normalize,
    layoutFor: layoutFor,
  };
});
