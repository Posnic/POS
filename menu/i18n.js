/*
 * The customer's language.
 *
 * Every word a customer reads on /menu and /order is English in the source.
 * This file is the one place a second language lives: a dictionary keyed by
 * the English sentence itself, and a walker that swaps the words in the page
 * as they appear - the static ones as the page is parsed, the ones scripts
 * draw later as they land. Nothing else on the pages has to know a second
 * language exists.
 *
 * WHO DECIDES THE LANGUAGE, in order:
 *   1. ?lang=ta on the link - a shop prints it on the codes it puts out
 *      for Tamil-reading customers;
 *   2. the choice the customer made last time on this phone;
 *   3. the phone's own language;
 *   4. English.
 *
 * WHY THE ENGLISH SENTENCE IS THE KEY. Two hundred keys called
 * lang_pay_at_counter_2 would have to be invented, looked up and kept in
 * step with the markup; the sentence itself is already unique, already in
 * the markup, and reads as what it is. A translation that is missing shows
 * the English, never a key.
 *
 * WHY A WALKER AND NOT ATTRIBUTES. The pages draw most of what they say from
 * scripts - a card, a count, a line on the bill - and marking every string
 * in every template would touch two thousand lines to no benefit. The
 * walker translates a text node whose whole trimmed text is a known
 * sentence, and the observer does the same to nodes added later. A sentence
 * built around a number goes through t() in the script instead, so the
 * number lands where the other language wants it.
 *
 * Numbers stay in the digits the bill will show. Names the shop typed -
 * dishes, categories, the shop's own name - are never translated, because
 * they are not in the dictionary.
 *
 * ONE FILE, TWO COPIES. /menu and /order are separate bundles deployed to
 * separate folders, and neither may reach into the other. order/assets/i18n.js
 * and menu/i18n.js are the same bytes; tests/customer-i18n.test.js refuses a
 * commit where they differ.
 */
(function () {
  "use strict";

  var LANGS = { en: "English", ta: "தமிழ்" };
  var STORAGE_KEY = "posnic_lang";
  var ATTRS = ["placeholder", "aria-label", "title"];

  var DICT = {
    ta: {
      /* ---------------------------------------------------- the menu */
      "Menu": "மெனு",
      "Our Menu": "எங்கள் மெனு",
      "Products": "பொருட்கள்",
      "All products": "எல்லா பொருட்களும்",
      "{shop} menu": "{shop} மெனு",
      "{shop} · Order": "{shop} · ஆர்டர்",
      "Order": "ஆர்டர்",
      "Search the menu": "மெனுவில் தேடுங்கள்",
      "Search products": "பொருட்களைத் தேடுங்கள்",
      "Catalogue order": "பட்டியல் வரிசை",
      "Search by voice": "குரல் மூலம் தேடுங்கள்",
      "Clear search": "தேடலை அழிக்கவும்",
      "Back to the menu": "மெனுவிற்குத் திரும்பு",
      "Menu sections": "மெனு பிரிவுகள்",
      "Sort": "வரிசை",
      "Sort the menu": "மெனுவை வரிசைப்படுத்து",
      "Menu order": "மெனு வரிசை",
      "Most ordered": "அதிகம் ஆர்டர் செய்தவை",
      "Price: low to high": "விலை: குறைவு முதல் அதிகம்",
      "Price: high to low": "விலை: அதிகம் முதல் குறைவு",
      "Veg only": "சைவம் மட்டும்",
      "Available now": "இப்போது கிடைப்பவை",
      "Loading the menu": "மெனு ஏற்றப்படுகிறது",
      "One moment.": "ஒரு நிமிடம்.",
      "Results": "முடிவுகள்",
      "Show all {n}": "{n}ஐயும் காட்டு",
      "Often ordered with": "இதனுடன் அடிக்கடி ஆர்டர் செய்யப்படுவது",
      "Order now": "இப்போது ஆர்டர் செய்யுங்கள்",
      "Photo": "படம்",
      "Close": "மூடு",
      "Close photo": "படத்தை மூடு",
      "Prices shown for {venue}": "{venue} க்கான விலைகள்",
      "Change language": "மொழியை மாற்று",

      /* counts */
      "dish": "உணவு",
      "dishes": "உணவுகள்",
      "item": "பொருள்",
      "items": "பொருட்கள்",
      "Items": "உருப்படிகள்",
      "{n} dish": "{n} உணவு",
      "{n} dishes": "{n} உணவுகள்",
      "{n} item": "{n} பொருள்",
      "{n} items": "{n} பொருட்கள்",
      "{n} dish found": "{n} உணவு கிடைத்தது",
      "{n} dishes found": "{n} உணவுகள் கிடைத்தன",
      "{n} item found": "{n} பொருள் கிடைத்தது",
      "{n} items found": "{n} பொருட்கள் கிடைத்தன",
      "Nothing matches those filters": "இந்த வடிகட்டிகளுக்கு எதுவும் பொருந்தவில்லை",
      "Nothing matches \"{q}\"": "\"{q}\" க்கு எதுவும் பொருந்தவில்லை",
      "Nothing matches \"{q}\". Try a different word.": "\"{q}\" க்கு எதுவும் பொருந்தவில்லை. வேறு வார்த்தையை முயற்சிக்கவும்.",
      "Try a different word.": "வேறு வார்த்தையை முயற்சிக்கவும்.",
      "Try turning one off.": "ஒன்றை அணைத்துப் பாருங்கள்.",
      "Nothing on the menu is marked vegetarian.": "மெனுவில் எதுவும் சைவம் எனக் குறிக்கப்படவில்லை.",
      "No dishes yet": "இன்னும் உணவுகள் இல்லை",
      "This shop has not added anything to its menu.": "இந்தக் கடை தனது மெனுவில் இன்னும் எதையும் சேர்க்கவில்லை.",

      /* a dish */
      "Add": "சேர்",
      "Add one": "ஒன்று சேர்",
      "One more": "இன்னொன்று",
      "One fewer": "ஒன்று குறை",
      "Quantity": "எண்ணிக்கை",
      "Category": "வகை",
      "Diet": "உணவு வகை",
      "Vegetarian": "சைவம்",
      "Non-vegetarian": "அசைவம்",
      "Contains egg": "முட்டை உள்ளது",
      "Vegan": "வீகன்",
      "Served at": "பரிமாறப்படும் நேரம்",
      "Served at {when} only": "{when} மட்டும் பரிமாறப்படும்",
      "Takes about": "தயாராக ஆகும் நேரம்",
      "{n} minutes": "{n} நிமிடங்கள்",
      "~{n} min": "~{n} நிமி",
      "Right now": "இப்போது",
      "Available": "கிடைக்கிறது",
      "Not available today": "இன்று கிடைக்காது",
      "Not available right now": "இப்போது கிடைக்காது",
      "Not being served - {when} only": "இப்போது பரிமாறப்படவில்லை - {when} மட்டும்",
      "{when} only": "{when} மட்டும்",
      " and ": " மற்றும் ",
      "A note for this dish": "இந்த உணவுக்கு ஒரு குறிப்பு",
      "Any request for this dish?": "இந்த உணவுக்கு ஏதேனும் வேண்டுகோள்?",
      "Add a request: less spicy, no onion...": "வேண்டுகோள் சேர்க்கவும்: காரம் குறைவாக, வெங்காயம் வேண்டாம்...",
      "Edit request": "வேண்டுகோளைத் திருத்து",
      "Less spicy, no onion, extra gravy...": "காரம் குறைவாக, வெங்காயம் வேண்டாம், கூடுதல் குழம்பு...",
      "A note for the kitchen": "சமையலறைக்கு ஒரு குறிப்பு",
      "A note for the shop": "கடைக்கு ஒரு குறிப்பு",
      "Add a note": "குறிப்பு சேர்",
      "Edit note": "குறிப்பைத் திருத்து",
      "Save note": "குறிப்பைச் சேமி",
      "Less spicy, no onion, cut in half...": "காரம் குறைவாக, வெங்காயம் வேண்டாம், பாதியாக வெட்டவும்...",
      "Anything we should know?": "நாங்கள் தெரிந்து கொள்ள வேண்டியது ஏதேனும்?",
      "Need more than that? The counter can help.": "இதற்கு மேல் வேண்டுமா? கவுண்டரில் கேளுங்கள்.",

      /* the order */
      "Your order": "உங்கள் ஆர்டர்",
      "Review order": "ஆர்டரைப் பார்க்கவும்",
      "View order": "ஆர்டரைப் பார்",
      "Nothing yet. Add a dish to start.": "இன்னும் எதுவும் இல்லை. தொடங்க ஒரு உணவைச் சேர்க்கவும்.",
      "Loading your order": "உங்கள் ஆர்டர் ஏற்றப்படுகிறது",
      "Total": "மொத்தம்",
      "Taxes": "வரிகள்",
      "Tax": "வரி",
      "Subtotal": "கூட்டுத்தொகை",
      "Discount": "தள்ளுபடி",
      "Bill": "பில்",
      "Continue": "தொடரவும்",
      "Cancel": "ரத்து",
      "Clear the order": "ஆர்டரை அழி",
      "Clear the order?": "ஆர்டரை அழிக்கவா?",
      "Everything you have added will be removed.": "நீங்கள் சேர்த்த அனைத்தும் நீக்கப்படும்.",
      "Keep it": "வைத்திரு",
      "Yes, clear it": "ஆம், அழி",
      "We will bring it to {place}": "{place} க்குக் கொண்டு வருகிறோம்",
      "Room": "அறை",
      "Floor": "தளம்",
      "Table": "மேசை",
      "Table {n}": "மேசை {n}",

      /* paying */
      "Almost done": "கிட்டத்தட்ட முடிந்தது",
      "Back to your order": "உங்கள் ஆர்டருக்குத் திரும்பு",
      "Back to cart": "ஆர்டருக்குத் திரும்பு",
      "How would you like it?": "எப்படி வேண்டும்?",
      "How would you like it served?": "எப்படிப் பரிமாற வேண்டும்?",
      "Choose one to continue.": "தொடர ஒன்றைத் தேர்ந்தெடுங்கள்.",
      "Bring it to my table": "என் மேசைக்குக் கொண்டு வாருங்கள்",
      "Bring it to table {table}": "மேசை {table} க்குக் கொண்டு வாருங்கள்",
      "I'll collect it at the counter": "கவுண்டரில் நானே வாங்கிக் கொள்கிறேன்",
      "I'll collect it from the shop": "கடையில் நானே வாங்கிக் கொள்கிறேன்",
      "Deliver it to me": "எனக்கு டெலிவரி செய்யுங்கள்",
      "Which table?": "எந்த மேசை?",
      "Which table are you at?": "நீங்கள் எந்த மேசையில் இருக்கிறீர்கள்?",
      "Table number": "மேசை எண்",
      "Where to deliver": "எங்கு டெலிவரி செய்ய வேண்டும்",
      "Your name": "உங்கள் பெயர்",
      "Name": "பெயர்",
      "Door, street, landmark": "கதவு எண், தெரு, அடையாளம்",
      "Your mobile number": "உங்கள் மொபைல் எண்",
      "Enter mobile number": "மொபைல் எண்ணை உள்ளிடுங்கள்",
      "For this order only, so the shop can reach you about it.": "இந்த ஆர்டருக்கு மட்டும், கடை உங்களைத் தொடர்பு கொள்ள.",
      "Number keys": "எண் விசைகள்",
      "Delete the last digit": "கடைசி இலக்கை நீக்கு",
      "Clear": "அழி",
      "Please enter a valid 10-digit mobile number starting with 6-9.": "6-9 இல் தொடங்கும் சரியான 10 இலக்க மொபைல் எண்ணை உள்ளிடுங்கள்.",
      "How will you pay?": "எப்படி பணம் செலுத்துவீர்கள்?",
      "Pay now": "இப்போது செலுத்து",
      "Pay at the counter": "கவுண்டரில் செலுத்து",
      "Pay on delivery": "டெலிவரியின் போது செலுத்து",
      "Pay when collecting": "வாங்கும் போது செலுத்து",
      "Pay {amount}": "{amount} செலுத்து",
      "Place order": "ஆர்டர் செய்",
      "Add {amount} more": "இன்னும் {amount} சேர்க்கவும்",
      "Orders start at {min}. Add {more} more.": "ஆர்டர் குறைந்தபட்சம் {min}. இன்னும் {more} சேர்க்கவும்.",
      "Delivery orders start at {min}. Add {more} more.": "டெலிவரி ஆர்டர் குறைந்தபட்சம் {min}. இன்னும் {more} சேர்க்கவும்.",
      "Add {amount} more and {what} is free.": "இன்னும் {amount} சேர்த்தால் {what} இலவசம்.",
      "Delivery": "டெலிவரி",
      "delivery": "டெலிவரி",
      "Service": "சேவை",
      "service": "சேவை",
      "Packing": "பேக்கிங்",
      "packing": "பேக்கிங்",
      "Free": "இலவசம்",
      "Setting up your payment": "பணம் செலுத்துதல் தயாராகிறது",
      "One moment. Please keep this page open.": "ஒரு நிமிடம். இந்தப் பக்கத்தைத் திறந்து வையுங்கள்.",
      "Something went wrong. Please try again.": "ஏதோ தவறு நடந்தது. மீண்டும் முயற்சிக்கவும்.",
      "Payment could not be started": "பணம் செலுத்துதலைத் தொடங்க முடியவில்லை",
      "Payment request failed. Please try again.": "பணம் செலுத்தும் கோரிக்கை தோல்வி. மீண்டும் முயற்சிக்கவும்.",
      "Payment failed": "பணம் செலுத்துதல் தோல்வி",
      "The payment was not completed. Return to the cart and try again.": "பணம் செலுத்துதல் முடியவில்லை. ஆர்டருக்குத் திரும்பி மீண்டும் முயற்சிக்கவும்.",
      "Payment confirmation timed out": "பணம் செலுத்திய உறுதிப்படுத்தல் நேரம் முடிந்தது",
      "Payment page could not be loaded": "பணம் செலுத்தும் பக்கத்தை ஏற்ற முடியவில்லை",
      "Please check the connection and try again.": "இணைப்பைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.",
      "Unable to load Razorpay checkout script.": "Razorpay ஐ ஏற்ற முடியவில்லை.",
      "Razorpay payment could not be started.": "Razorpay பணம் செலுத்துதலைத் தொடங்க முடியவில்லை.",
      "This shop is not taking payment through this page right now. Please order at the counter.": "இந்தக் கடை இப்போது இந்தப் பக்கத்தின் மூலம் பணம் பெறவில்லை. கவுண்டரில் ஆர்டர் செய்யுங்கள்.",
      "Retry payment": "பணம் செலுத்த மீண்டும் முயற்சி",
      "Checking the payment": "பணம் செலுத்துதல் சரிபார்க்கப்படுகிறது",
      "Payment status": "பணம் செலுத்திய நிலை",

      /* placed */
      "Order placed": "ஆர்டர் செய்யப்பட்டது",
      "The kitchen has it. Show this at the counter.": "சமையலறைக்குச் சென்றது. இதைக் கவுண்டரில் காட்டுங்கள்.",
      "The kitchen has it. We'll bring it to table {table}.": "சமையலறைக்குச் சென்றது. மேசை {table} க்குக் கொண்டு வருகிறோம்.",
      "The kitchen has it. We'll bring it to your table.": "சமையலறைக்குச் சென்றது. உங்கள் மேசைக்குக் கொண்டு வருகிறோம்.",
      "The kitchen has it. Collect it at the counter when your token is called.": "சமையலறைக்குச் சென்றது. உங்கள் டோக்கன் அழைக்கப்படும்போது கவுண்டரில் வாங்கிக் கொள்ளுங்கள்.",
      "Your order is in. Collect it from the shop when it's ready.": "உங்கள் ஆர்டர் பெறப்பட்டது. தயாரானதும் கடையில் வாங்கிக் கொள்ளுங்கள்.",
      "Your order is in. It's on its way as soon as it's ready.": "உங்கள் ஆர்டர் பெறப்பட்டது. தயாரானதும் உடனே அனுப்பப்படும்.",
      "Pay {amount} on delivery.": "டெலிவரியின் போது {amount} செலுத்துங்கள்.",
      "Pay {amount} when you collect it.": "வாங்கும் போது {amount} செலுத்துங்கள்.",
      "Pay {amount} at the counter.": "கவுண்டரில் {amount} செலுத்துங்கள்.",
      "Your token": "உங்கள் டோக்கன்",
      "Token": "டோக்கன்",
      "Placed": "ஆர்டர் நேரம்",
      "Order more": "மேலும் ஆர்டர் செய்",
      "Finish": "முடி",
      "Receipt": "ரசீது",
      "Date": "தேதி",
      "· Paid by": "· செலுத்திய முறை",
      "Cash": "ரொக்கம்",
      "Unknown": "தெரியவில்லை",
      "Thank you. Visit again.": "நன்றி. மீண்டும் வாருங்கள்.",
      "Receipt PDF could not be generated.": "ரசீது PDF உருவாக்க முடியவில்லை.",
      "Nothing to show": "காட்ட எதுவும் இல்லை",
      "Nothing to show here": "இங்கே காட்ட எதுவும் இல்லை",
      "This receipt is not from an order placed on this phone.": "இந்த ரசீது இந்த போனில் செய்யப்பட்ட ஆர்டருடையது அல்ல.",
      "See the menu": "மெனுவைப் பாருங்கள்",

      /* the machine's resting screen */
      "Start your order": "ஆர்டரைத் தொடங்குங்கள்",
      "Welcome": "வரவேற்கிறோம்",
      "Touch to start your order": "ஆர்டர் செய்யத் தொடுங்கள்",
      "Dine in": "இங்கே சாப்பிட",
      "We bring it to your table": "உங்கள் மேசைக்குக் கொண்டு வருகிறோம்",
      "Take away": "பார்சல்",
      "Packed to carry": "எடுத்துச் செல்ல பேக் செய்யப்படும்",

      /* when things go wrong */
      "This menu is not available": "இந்த மெனு கிடைக்கவில்லை",
      "Could not load the menu": "மெனுவை ஏற்ற முடியவில்லை",
      "Check your connection and try again.": "இணைப்பைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.",
      "Menu not loaded": "மெனு ஏற்றப்படவில்லை",
      "Scan the code on the table again, or ask at the counter.": "மேசையில் உள்ள குறியீட்டை மீண்டும் ஸ்கேன் செய்யுங்கள், அல்லது கவுண்டரில் கேளுங்கள்.",
      "Unable to load the menu": "மெனுவை ஏற்ற முடியவில்லை",
      "Unable to reach the server": "சர்வரை அடைய முடியவில்லை",
      "The server returned an invalid response.": "சர்வர் தவறான பதிலைத் தந்தது.",
      "You are offline": "இணையம் இல்லை",
      "Check the internet connection, then tap Retry.": "இணைய இணைப்பைச் சரிபார்த்து, மீண்டும் முயற்சி என்பதைத் தட்டவும்.",
      "Connection restored. Tap Retry to continue.": "இணைப்பு மீண்டும் வந்தது. தொடர மீண்டும் முயற்சி என்பதைத் தட்டவும்.",
      "Internet connection is still unavailable.": "இணைய இணைப்பு இன்னும் இல்லை.",
      "Retry": "மீண்டும் முயற்சி",
      "Retrying...": "மீண்டும் முயற்சிக்கிறது...",
      "Retry failed. Check the connection and try again.": "மீண்டும் முயற்சி தோல்வி. இணைப்பைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.",
      "Retry order": "ஆர்டரை மீண்டும் முயற்சி",
      "Your order is being submitted. Please do not close this page.": "உங்கள் ஆர்டர் அனுப்பப்படுகிறது. இந்தப் பக்கத்தை மூட வேண்டாம்.",
      "Order could not be completed": "ஆர்டரை முடிக்க முடியவில்லை",
      "Checkout failed. Please try again.": "ஆர்டர் அனுப்ப முடியவில்லை. மீண்டும் முயற்சிக்கவும்.",
      "This shop is not taking online orders yet.": "இந்தக் கடை இன்னும் ஆன்லைன் ஆர்டர் எடுக்கவில்லை.",
      "This shop is not taking orders right now.": "இந்தக் கடை இப்போது ஆர்டர் எடுக்கவில்லை."
    }
  };

  function saved() {
    try {
      return localStorage.getItem(STORAGE_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function remember(code) {
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch (e) {
      /* A browser that keeps nothing still gets the language for this page. */
    }
  }

  function fromUrl() {
    try {
      var code = new URLSearchParams(window.location.search).get("lang");
      return code && LANGS[code] ? code : "";
    } catch (e) {
      return "";
    }
  }

  function fromPhone() {
    var list = navigator.languages || [navigator.language || ""];
    for (var i = 0; i < list.length; i++) {
      var code = String(list[i] || "").toLowerCase().split("-")[0];
      if (LANGS[code]) return code;
    }
    return "";
  }

  var lang = fromUrl();
  if (lang) remember(lang);
  else lang = LANGS[saved()] ? saved() : fromPhone() || "en";

  document.documentElement.setAttribute("lang", lang);

  /** The sentence in the customer's language, with {names} filled in. */
  function t(key, vars) {
    var table = DICT[lang];
    var out = table && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : String(key);
    if (vars) {
      out = out.replace(/\{(\w+)\}/g, function (m, name) {
        return vars[name] != null ? String(vars[name]) : m;
      });
    }
    return out;
  }

  function lookup(text) {
    var table = DICT[lang];
    return table && Object.prototype.hasOwnProperty.call(table, text) ? table[text] : null;
  }

  function untranslatable(el) {
    var tag = el.nodeName;
    return tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || el.getAttribute("translate") === "no";
  }

  function underUntranslatable(node) {
    for (var el = node.parentNode; el && el.nodeType === 1; el = el.parentNode) {
      if (untranslatable(el)) return true;
    }
    return false;
  }

  /* The text around the sentence - a space before a number, a line break in
     the markup - stays exactly as it was. */
  function fixText(node) {
    var data = node.data;
    var key = data.trim();
    if (!key) return;
    var out = lookup(key);
    if (out == null || out === key) return;
    node.data = data.replace(key, out);
  }

  function fixAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var name = ATTRS[i];
      if (!el.hasAttribute(name)) continue;
      var out = lookup(el.getAttribute(name).trim());
      if (out != null) el.setAttribute(name, out);
    }
  }

  /** Translate everything under `root`, root included. */
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) {
      if (!underUntranslatable(root)) fixText(root);
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) {
      if (untranslatable(root) || underUntranslatable(root)) return;
      fixAttrs(root);
    }
    var doc = root.ownerDocument || root;
    var tw = doc.createTreeWalker(root, 5 /* elements and text */, {
      acceptNode: function (n) {
        return n.nodeType === 1 && untranslatable(n) ? 2 /* skip the subtree */ : 1;
      }
    });
    var n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 1) fixAttrs(n);
      else fixText(n);
    }
  }

  /* Nodes the parser and the scripts add later come through here. Our own
     rewrite fires a characterData record too, but the rewritten text is no
     longer a key, so it stops there. */
  function observe() {
    if (!window.MutationObserver) return;
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === "characterData") {
          if (!underUntranslatable(r.target)) fixText(r.target);
        } else if (r.type === "attributes") {
          if (!untranslatable(r.target) && !underUntranslatable(r.target)) fixAttrs(r.target);
        } else {
          for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]);
        }
      }
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS
    });
  }

  function nextLang() {
    var codes = Object.keys(LANGS);
    return codes[(codes.indexOf(lang) + 1) % codes.length];
  }

  /* The toggle names the language it would switch TO, in that language, so
     the person who cannot read the current one can still find their way. */
  function paintToggles() {
    var other = nextLang();
    var list = document.querySelectorAll("[data-lang-toggle]");
    for (var i = 0; i < list.length; i++) {
      list[i].textContent = LANGS[other];
      list[i].setAttribute("lang", other);
      list[i].setAttribute("aria-label", t("Change language"));
      list[i].hidden = false;
    }
  }

  /* A choice is kept and the page reloaded: every sentence a script has
     already composed comes back in the new language, and nothing on these
     pages is lost by a reload - the order lives in IndexedDB. */
  function set(code) {
    if (!LANGS[code] || code === lang) return;
    remember(code);
    try {
      var url = new URL(window.location.href);
      url.searchParams.delete("lang");
      window.history.replaceState(null, "", url.toString());
    } catch (e) {
      /* An old browser reloads with the URL it has. */
    }
    window.location.reload();
  }

  document.addEventListener("click", function (e) {
    var target = e.target && e.target.closest ? e.target.closest("[data-lang-toggle]") : null;
    if (!target) return;
    e.preventDefault();
    set(target.getAttribute("data-lang-toggle") || nextLang());
  });

  function start() {
    walk(document.body);
    var title = lookup(document.title.trim());
    if (title) document.title = title;
    paintToggles();
  }

  if (lang !== "en") observe();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  window.i18n = { t: t, lang: lang, languages: LANGS, apply: walk, set: set };
  window.t = t;
})();
