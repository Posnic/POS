// Demo data for different business types

const iceCreamDemoData = {
  categories: [
    { name: 'Ice Cream Flavors', description: 'Various ice cream flavors' },
    { name: 'Toppings', description: 'Ice cream toppings and sauces' },
    { name: 'Cones & Cups', description: 'Serving containers' },
    { name: 'Sundaes', description: 'Special sundae combinations' }
  ],
  products: [
    // Ice Cream Flavors (6 products)
    { name: 'Vanilla Ice Cream', category: 'Ice Cream Flavors', price: 3.50, unit: 'scoop', stock: 100 },
    { name: 'Chocolate Ice Cream', category: 'Ice Cream Flavors', price: 3.50, unit: 'scoop', stock: 100 },
    { name: 'Strawberry Ice Cream', category: 'Ice Cream Flavors', price: 3.75, unit: 'scoop', stock: 100 },
    { name: 'Mango Ice Cream', category: 'Ice Cream Flavors', price: 4.00, unit: 'scoop', stock: 100 },
    { name: 'Mint Chocolate Chip', category: 'Ice Cream Flavors', price: 4.25, unit: 'scoop', stock: 100 },
    { name: 'Cookie Dough Ice Cream', category: 'Ice Cream Flavors', price: 4.50, unit: 'scoop', stock: 100 },
    
    // Toppings (4 products)
    { name: 'Chocolate Syrup', category: 'Toppings', price: 0.75, unit: 'serving', stock: 200 },
    { name: 'Caramel Sauce', category: 'Toppings', price: 0.75, unit: 'serving', stock: 200 },
    { name: 'Sprinkles', category: 'Toppings', price: 0.50, unit: 'serving', stock: 200 },
    { name: 'Whipped Cream', category: 'Toppings', price: 0.50, unit: 'serving', stock: 200 },
    
    // Cones & Cups (3 products)
    { name: 'Waffle Cone', category: 'Cones & Cups', price: 1.50, unit: 'piece', stock: 150 },
    { name: 'Sugar Cone', category: 'Cones & Cups', price: 1.00, unit: 'piece', stock: 150 },
    { name: 'Cup (Small)', category: 'Cones & Cups', price: 0.50, unit: 'piece', stock: 200 },
    
    // Sundaes (2 products)
    { name: 'Banana Split', category: 'Sundaes', price: 8.99, unit: 'serving', stock: 50 },
    { name: 'Hot Fudge Sundae', category: 'Sundaes', price: 6.99, unit: 'serving', stock: 50 }
  ]
};

const cafeDemoData = {
  categories: [
    { name: 'Hot Beverages', description: 'Coffee, tea, and hot drinks' },
    { name: 'Cold Beverages', description: 'Iced drinks and smoothies' },
    { name: 'Snacks', description: 'Quick bites and snacks' },
    { name: 'Groceries', description: 'Daily essentials' }
  ],
  products: [
    // Hot Beverages (5 products)
    { name: 'Espresso', category: 'Hot Beverages', price: 2.50, unit: 'cup', stock: 100 },
    { name: 'Cappuccino', category: 'Hot Beverages', price: 3.50, unit: 'cup', stock: 100 },
    { name: 'Latte', category: 'Hot Beverages', price: 3.75, unit: 'cup', stock: 100 },
    { name: 'Hot Chocolate', category: 'Hot Beverages', price: 3.25, unit: 'cup', stock: 100 },
    { name: 'Green Tea', category: 'Hot Beverages', price: 2.00, unit: 'cup', stock: 100 },
    
    // Cold Beverages (4 products)
    { name: 'Iced Coffee', category: 'Cold Beverages', price: 3.50, unit: 'cup', stock: 100 },
    { name: 'Iced Latte', category: 'Cold Beverages', price: 4.00, unit: 'cup', stock: 100 },
    { name: 'Mango Smoothie', category: 'Cold Beverages', price: 4.50, unit: 'cup', stock: 100 },
    { name: 'Fresh Orange Juice', category: 'Cold Beverages', price: 3.50, unit: 'glass', stock: 100 },
    
    // Snacks (3 products)
    { name: 'Croissant', category: 'Snacks', price: 2.50, unit: 'piece', stock: 50 },
    { name: 'Muffin', category: 'Snacks', price: 2.75, unit: 'piece', stock: 50 },
    { name: 'Sandwich', category: 'Snacks', price: 5.50, unit: 'piece', stock: 50 },
    
    // Groceries (3 products)
    { name: 'Milk (1L)', category: 'Groceries', price: 2.00, unit: 'bottle', stock: 100 },
    { name: 'Bread Loaf', category: 'Groceries', price: 2.50, unit: 'loaf', stock: 80 },
    { name: 'Eggs (12 pack)', category: 'Groceries', price: 3.50, unit: 'pack', stock: 60 }
  ]
};

const bakeryDemoData = {
  categories: [
    { name: 'Bread', description: 'Fresh baked bread' },
    { name: 'Pastries', description: 'Sweet and savory pastries' },
    { name: 'Cakes', description: 'Cakes and celebration items' },
    { name: 'Cookies', description: 'Cookies and biscuits' }
  ],
  products: [
    // Bread (4 products)
    { name: 'White Bread', category: 'Bread', price: 2.50, unit: 'loaf', stock: 100 },
    { name: 'Whole Wheat Bread', category: 'Bread', price: 3.00, unit: 'loaf', stock: 100 },
    { name: 'Baguette', category: 'Bread', price: 2.75, unit: 'piece', stock: 80 },
    { name: 'Sourdough', category: 'Bread', price: 4.50, unit: 'loaf', stock: 60 },
    
    // Pastries (5 products)
    { name: 'Croissant', category: 'Pastries', price: 2.50, unit: 'piece', stock: 100 },
    { name: 'Danish Pastry', category: 'Pastries', price: 3.00, unit: 'piece', stock: 80 },
    { name: 'Cinnamon Roll', category: 'Pastries', price: 3.25, unit: 'piece', stock: 80 },
    { name: 'Apple Turnover', category: 'Pastries', price: 2.75, unit: 'piece', stock: 80 },
    { name: 'Donut', category: 'Pastries', price: 1.50, unit: 'piece', stock: 120 },
    
    // Cakes (3 products)
    { name: 'Chocolate Cake Slice', category: 'Cakes', price: 4.50, unit: 'slice', stock: 40 },
    { name: 'Cheesecake Slice', category: 'Cakes', price: 5.00, unit: 'slice', stock: 40 },
    { name: 'Birthday Cake (8")', category: 'Cakes', price: 25.00, unit: 'cake', stock: 10 },
    
    // Cookies (3 products)
    { name: 'Chocolate Chip Cookies', category: 'Cookies', price: 1.50, unit: 'piece', stock: 150 },
    { name: 'Oatmeal Cookies', category: 'Cookies', price: 1.50, unit: 'piece', stock: 150 },
    { name: 'Sugar Cookies', category: 'Cookies', price: 1.25, unit: 'piece', stock: 150 }
  ]
};

const supermarketDemoData = {
  categories: [
    { name: 'Groceries & Staples', description: 'Rice, flour, dal, oil and daily staples' },
    { name: 'Snacks & Biscuits', description: 'Packaged snacks, biscuits and namkeen' },
    { name: 'Beverages', description: 'Tea, coffee, soft drinks and juices' },
    { name: 'Dairy & Bread', description: 'Milk, curd, butter, paneer and bakery' },
    { name: 'Personal Care', description: 'Soap, shampoo, toothpaste and hygiene' },
    { name: 'Household & Cleaning', description: 'Detergents, cleaners and home needs' }
  ],
  products: [
    // Groceries & Staples
    { name: 'Rice (Sona Masoori) 5kg', category: 'Groceries & Staples', price: 380, unit: 'bag', stock: 40 },
    { name: 'Wheat Atta 5kg', category: 'Groceries & Staples', price: 260, unit: 'bag', stock: 40 },
    { name: 'Toor Dal 1kg', category: 'Groceries & Staples', price: 165, unit: 'kg', stock: 50 },
    { name: 'Sugar 1kg', category: 'Groceries & Staples', price: 46, unit: 'kg', stock: 80 },
    { name: 'Iodised Salt 1kg', category: 'Groceries & Staples', price: 24, unit: 'kg', stock: 100 },
    { name: 'Sunflower Oil 1L', category: 'Groceries & Staples', price: 145, unit: 'bottle', stock: 60 },
    { name: 'Tea Powder 250g', category: 'Groceries & Staples', price: 140, unit: 'pack', stock: 50 },
    // Snacks & Biscuits
    { name: 'Glucose Biscuits', category: 'Snacks & Biscuits', price: 10, unit: 'pack', stock: 200 },
    { name: 'Cream Biscuits', category: 'Snacks & Biscuits', price: 30, unit: 'pack', stock: 120 },
    { name: 'Potato Chips 52g', category: 'Snacks & Biscuits', price: 20, unit: 'pack', stock: 150 },
    { name: 'Mixture Namkeen 200g', category: 'Snacks & Biscuits', price: 55, unit: 'pack', stock: 80 },
    // Beverages
    { name: 'Cola 750ml', category: 'Beverages', price: 40, unit: 'bottle', stock: 96 },
    { name: 'Mango Drink 600ml', category: 'Beverages', price: 35, unit: 'bottle', stock: 96 },
    { name: 'Packaged Water 1L', category: 'Beverages', price: 20, unit: 'bottle', stock: 120 },
    // Dairy & Bread
    { name: 'Milk 500ml', category: 'Dairy & Bread', price: 27, unit: 'packet', stock: 60 },
    { name: 'Curd 400g', category: 'Dairy & Bread', price: 35, unit: 'cup', stock: 40 },
    { name: 'Bread (Sandwich)', category: 'Dairy & Bread', price: 40, unit: 'loaf', stock: 30 },
    { name: 'Butter 100g', category: 'Dairy & Bread', price: 58, unit: 'pack', stock: 30 },
    // Personal Care
    { name: 'Bath Soap 100g', category: 'Personal Care', price: 35, unit: 'piece', stock: 100 },
    { name: 'Shampoo Sachet', category: 'Personal Care', price: 2, unit: 'sachet', stock: 400 },
    { name: 'Toothpaste 100g', category: 'Personal Care', price: 55, unit: 'tube', stock: 80 },
    // Household & Cleaning
    { name: 'Detergent Powder 1kg', category: 'Household & Cleaning', price: 110, unit: 'pack', stock: 50 },
    { name: 'Dishwash Bar', category: 'Household & Cleaning', price: 20, unit: 'piece', stock: 100 },
    { name: 'Floor Cleaner 500ml', category: 'Household & Cleaning', price: 95, unit: 'bottle', stock: 40 }
  ]
};

const textileDemoData = {
  categories: [
    { name: "Men's Wear", description: 'Shirts, trousers and menswear' },
    { name: "Women's Wear", description: 'Sarees, kurtis and womenswear' },
    { name: 'Kids Wear', description: "Children's clothing" },
    { name: 'Fabrics', description: 'Cloth sold by the meter' }
  ],
  products: [
    { name: 'Formal Shirt (Cotton)', category: "Men's Wear", price: 799, unit: 'piece', stock: 40 },
    { name: 'Casual T-Shirt', category: "Men's Wear", price: 399, unit: 'piece', stock: 60 },
    { name: 'Formal Trousers', category: "Men's Wear", price: 999, unit: 'piece', stock: 35 },
    { name: 'Lungi', category: "Men's Wear", price: 250, unit: 'piece', stock: 50 },
    { name: 'Cotton Saree', category: "Women's Wear", price: 1200, unit: 'piece', stock: 30 },
    { name: 'Silk Saree', category: "Women's Wear", price: 4500, unit: 'piece', stock: 15 },
    { name: 'Kurti (Printed)', category: "Women's Wear", price: 599, unit: 'piece', stock: 45 },
    { name: 'Chudidar Set', category: "Women's Wear", price: 899, unit: 'set', stock: 30 },
    { name: 'Kids T-Shirt', category: 'Kids Wear', price: 249, unit: 'piece', stock: 50 },
    { name: 'Kids Frock', category: 'Kids Wear', price: 449, unit: 'piece', stock: 35 },
    { name: 'School Uniform Set', category: 'Kids Wear', price: 699, unit: 'set', stock: 40 },
    { name: 'Shirting Fabric (Cotton)', category: 'Fabrics', price: 220, unit: 'meter', stock: 200 },
    { name: 'Suiting Fabric', category: 'Fabrics', price: 450, unit: 'meter', stock: 150 },
    { name: 'Blouse Material', category: 'Fabrics', price: 150, unit: 'meter', stock: 100 }
  ]
};

const electricalDemoData = {
  categories: [
    { name: 'Wires & Cables', description: 'House wiring and cables' },
    { name: 'Switches & Sockets', description: 'Modular switches, sockets and MCBs' },
    { name: 'Lighting', description: 'Bulbs, tubes and decorative lights' },
    { name: 'Fans & Appliances', description: 'Fans and small appliances' }
  ],
  products: [
    { name: 'Copper Wire 1.5sqmm (90m)', category: 'Wires & Cables', price: 1450, unit: 'roll', stock: 25 },
    { name: 'Copper Wire 2.5sqmm (90m)', category: 'Wires & Cables', price: 2250, unit: 'roll', stock: 20 },
    { name: 'Extension Cord 5m', category: 'Wires & Cables', price: 350, unit: 'piece', stock: 30 },
    { name: 'Modular Switch 6A', category: 'Switches & Sockets', price: 45, unit: 'piece', stock: 200 },
    { name: '3-Pin Socket 16A', category: 'Switches & Sockets', price: 95, unit: 'piece', stock: 100 },
    { name: 'MCB 16A Single Pole', category: 'Switches & Sockets', price: 180, unit: 'piece', stock: 60 },
    { name: 'Switch Board Plate (8M)', category: 'Switches & Sockets', price: 120, unit: 'piece', stock: 80 },
    { name: 'LED Bulb 9W', category: 'Lighting', price: 99, unit: 'piece', stock: 150 },
    { name: 'LED Tube 20W 4ft', category: 'Lighting', price: 220, unit: 'piece', stock: 80 },
    { name: 'LED Panel 15W (Round)', category: 'Lighting', price: 320, unit: 'piece', stock: 50 },
    { name: 'Ceiling Fan 1200mm', category: 'Fans & Appliances', price: 1650, unit: 'piece', stock: 20 },
    { name: 'Table Fan 400mm', category: 'Fans & Appliances', price: 1350, unit: 'piece', stock: 15 },
    { name: 'Electric Kettle 1.5L', category: 'Fans & Appliances', price: 850, unit: 'piece', stock: 15 }
  ]
};

const hardwareDemoData = {
  categories: [
    { name: 'Hand Tools', description: 'Hammers, screwdrivers and tools' },
    { name: 'Fasteners', description: 'Screws, nails, nuts and bolts' },
    { name: 'Plumbing', description: 'Pipes, taps and fittings' },
    { name: 'Paint & Supplies', description: 'Paints, brushes and finishing' }
  ],
  products: [
    { name: 'Claw Hammer 500g', category: 'Hand Tools', price: 280, unit: 'piece', stock: 25 },
    { name: 'Screwdriver Set (6pc)', category: 'Hand Tools', price: 350, unit: 'set', stock: 30 },
    { name: 'Measuring Tape 5m', category: 'Hand Tools', price: 120, unit: 'piece', stock: 40 },
    { name: 'Pliers 8 inch', category: 'Hand Tools', price: 220, unit: 'piece', stock: 30 },
    { name: 'Hacksaw with Blade', category: 'Hand Tools', price: 180, unit: 'piece', stock: 20 },
    { name: 'Wood Screws 1" (100pc)', category: 'Fasteners', price: 90, unit: 'box', stock: 60 },
    { name: 'Wire Nails 2" 1kg', category: 'Fasteners', price: 110, unit: 'kg', stock: 50 },
    { name: 'Anchor Fastener 6mm (50pc)', category: 'Fasteners', price: 150, unit: 'box', stock: 40 },
    { name: 'PVC Pipe 3/4" (3m)', category: 'Plumbing', price: 210, unit: 'piece', stock: 40 },
    { name: 'Bib Tap (Brass)', category: 'Plumbing', price: 380, unit: 'piece', stock: 25 },
    { name: 'Teflon Tape', category: 'Plumbing', price: 15, unit: 'roll', stock: 150 },
    { name: 'PVC Elbow 3/4"', category: 'Plumbing', price: 18, unit: 'piece', stock: 100 },
    { name: 'Emulsion Paint 1L (White)', category: 'Paint & Supplies', price: 320, unit: 'tin', stock: 30 },
    { name: 'Paint Brush 4 inch', category: 'Paint & Supplies', price: 95, unit: 'piece', stock: 40 },
    { name: 'Sandpaper Sheet (80 grit)', category: 'Paint & Supplies', price: 12, unit: 'sheet', stock: 200 }
  ]
};

/*
 * Which pack a shop gets, from whatever word describes it.
 *
 * THE VOCABULARY IS NOT OURS ALONE. The word arrives from the cloud signup,
 * where the list is: retail, supermarket, restaurant, cafe, bakery, pharmacy,
 * hardware, electronics, textile, other. This file was written against a
 * different list, and the two disagreed in a way nothing reported:
 *
 *   - "electronics" matched no case, so the ELECTRICAL pack was unreachable
 *     and an electronics shop was handed groceries
 *   - "icecream" could not be sent at all, so that pack was unreachable too
 *   - "restaurant" fell to the default, so a restaurant was handed groceries
 *     when the cafe pack - prepared food and drink - is what it wanted
 *
 * Two of the seven packs could not be reached by any real signup. The failure
 * was silent because the default returns something plausible: every shop got a
 * supermarket, which looks like a decision rather than a miss.
 *
 * So both vocabularies are accepted, and the input is normalised, because
 * "Cafe" and "ice cream" are the same answers as "cafe" and "icecream" and a
 * switch on a raw string does not think so.
 */
const DEMO_PACK_BY_TYPE = {
  icecream: 'iceCream',
  'ice cream': 'iceCream',

  cafe: 'cafe',
  coffee: 'cafe',
  /* A restaurant sells prepared food and drink, which is what this pack is.
     Closer than groceries, which is where it landed before. */
  restaurant: 'cafe',

  bakery: 'bakery',

  supermarket: 'supermarket',
  kirana: 'supermarket',
  grocery: 'supermarket',
  groceries: 'supermarket',
  retail: 'supermarket',

  textile: 'textile',
  textiles: 'textile',
  apparel: 'textile',
  clothing: 'textile',

  electrical: 'electrical',
  electronics: 'electronics',

  hardware: 'hardware',
};

const DEMO_PACKS = {
  iceCream: iceCreamDemoData,
  cafe: cafeDemoData,
  bakery: bakeryDemoData,
  supermarket: supermarketDemoData,
  textile: textileDemoData,
  electrical: electricalDemoData,
  electronics: electricalDemoData,
  hardware: hardwareDemoData,
};

/*
 * The packs a shop can be offered, in the order a chooser should list them.
 *
 * SEPARATE FROM DEMO_PACK_BY_TYPE on purpose. That map is an INPUT vocabulary -
 * every word a signup form, an onboarding answer or a Gateway payload might use
 * for a trade, and several of them point at the same pack ("kirana", "grocery"
 * and "retail" are all the supermarket set). Showing that map to somebody
 * choosing an industry would offer them the same catalogue five times under
 * five names.
 *
 * This is the OUTPUT list: one entry per distinct catalogue, with the words a
 * shopkeeper would use for their own trade. A pack added to DEMO_PACKS without
 * a line here fails the test rather than quietly never being offered.
 */
const DEMO_PACK_LABELS = {
  supermarket: 'Supermarket, kirana & grocery',
  cafe: 'Cafe & restaurant',
  bakery: 'Bakery',
  iceCream: 'Ice cream parlour',
  textile: 'Clothing & textiles',
  electrical: 'Electronics & electrical',
  hardware: 'Hardware & tools',
};

/*
 * What a chooser needs to draw itself: the key to send back, the words to show,
 * and how much arrives if it is picked.
 *
 * The counts are COUNTED, never written down. A hand-maintained "24 products"
 * is right on the day it is typed and wrong from the next edit onwards, and
 * nothing about a stale number looks wrong.
 */
function listDemoPacks() {
  return Object.keys(DEMO_PACK_LABELS).map((key) => {
    const pack = DEMO_PACKS[key] || { categories: [], products: [] };
    return {
      key,
      label: DEMO_PACK_LABELS[key],
      categories: (pack.categories || []).length,
      products: (pack.products || []).length,
      /* Photographs are attached from the manifest at load, so this says what
         the shop will actually see rather than what the catalogue hoped for. */
      photos: (pack.products || []).filter((p) => p && p.image).length,
    };
  });
}

/*
 * Is this a pack a caller may ask for by name?
 *
 * getDemoDataByType falls back to supermarket for anything it does not know,
 * which is right when the input is a trade somebody typed - but wrong when it
 * is a deliberate choice from a list. Silently installing groceries into a
 * bakery because a key was misspelt is a bad answer delivered confidently.
 */
function isDemoPack(key) {
  return Object.prototype.hasOwnProperty.call(DEMO_PACK_LABELS, String(key || ''));
}

function getDemoDataByType(businessType) {
  const key = String(businessType == null ? '' : businessType)
    .trim()
    .toLowerCase();
  const pack = DEMO_PACK_BY_TYPE[key];
  /* Generic retail default: a kirana/supermarket set fits most shops, and is
     the right answer for "retail", "pharmacy" and "other", which have no pack
     of their own yet. */
  return DEMO_PACKS[pack] || supermarketDemoData;
}

/*
 * Attach the photographs, where there is one.
 *
 * DERIVED, NOT WRITTEN IN. The images live in the frontend as static files and
 * their manifest is written by scripts/fetch-demo-images.js. Pasting paths into
 * the product literals would mean a product could name a file that is not
 * there, or a file could sit unused, and neither would say so. Reading the
 * manifest means the two cannot disagree: an image exists and is used, or it
 * does not and the product simply has none.
 *
 * A product without one is a normal, finished state - PosnicPro.autoTile gives
 * it a coloured tile from its own name, which is a real answer on a sale grid.
 * Fifty-five of these products have no photograph because the automated search
 * returned somebody's brand, a photograph of people, or the wrong object
 * entirely, and those were turned down on sight. A wrong picture is read as
 * fact; an absent one is read as an absent one.
 *
 * Best-effort on purpose: a missing or unreadable manifest must never stop a
 * shop being created. It costs the pictures, nothing else.
 */
function attachImages() {
  /* Declared without a value: the catch below returns, so the only way past
     this point is with the manifest assigned. Seeding it with {} first is an
     assignment nothing ever reads, which eslint reports as an error. */
  let credits;
  try {
    // eslint-disable-next-line global-require
    credits = require('../../frontend/static/images/demo/credits.json');
  } catch (e) {
    return;
  }

  const byPack = {};
  for (const entry of Object.values(credits)) {
    if (!entry || !entry.pack || !entry.product || !entry.file) continue;
    (byPack[entry.pack] = byPack[entry.pack] || {})[entry.product] = entry.file;
  }

  const packs = {
    iceCream: iceCreamDemoData,
    cafe: cafeDemoData,
    bakery: bakeryDemoData,
    supermarket: supermarketDemoData,
    textile: textileDemoData,
    electrical: electricalDemoData,
    hardware: hardwareDemoData,
  };

  for (const [name, pack] of Object.entries(packs)) {
    const map = byPack[name];
    if (!map || !pack || !Array.isArray(pack.products)) continue;
    for (const product of pack.products) {
      if (map[product.name]) product.image = map[product.name];
    }
  }
}

attachImages();

module.exports = {
  getDemoDataByType,
  listDemoPacks,
  isDemoPack,
  DEMO_PACK_LABELS,
  attachImages,
  iceCreamDemoData,
  cafeDemoData,
  bakeryDemoData,
  supermarketDemoData,
  textileDemoData,
  electricalDemoData,
  hardwareDemoData
};
