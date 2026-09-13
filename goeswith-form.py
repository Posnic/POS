import io

ROOT = 'D:/Claude/Claude6/POS/'

# --- 1. the field on the form
p = ROOT + 'frontend/modules/items_write.html'
s = io.open(p, encoding='utf-8', newline='').read()
old = """                                    <div class="form-group col-md-8">
                                        <label for="item_prep_note"><lang class="lang_prep_note">Note for the kitchen</lang></label>
                                        <input type="text" class="form-control border-control" id="item_prep_note"
                                            name="item_prep_note" maxlength="200">
                                        <small class="form-text text-muted">
                                            <lang class="lang_prep_note_help">Printed on every ticket for this dish. The customer never sees it.</lang>
                                        </small>
                                    </div>"""
new = """                                    <div class="form-group col-md-8">
                                        <label for="item_prep_note"><lang class="lang_prep_note">Note for the kitchen</lang></label>
                                        <input type="text" class="form-control border-control" id="item_prep_note"
                                            name="item_prep_note" maxlength="200">
                                        <small class="form-text text-muted">
                                            <lang class="lang_prep_note_help">Printed on every ticket for this dish. The customer never sees it.</lang>
                                        </small>
                                    </div>
                                    <!--
                                        WHAT GOES WITH THIS DISH.

                                        Owner: "for checken briyani its
                                        suggessting french fries. not good
                                        combination. ask would like to add
                                        cock. only related prducts good."

                                        The ordering pages offer something
                                        alongside a placed order, and without
                                        this they work it out from what sells
                                        on the same bill. That is a reasonable
                                        guess and it is only a guess; this is
                                        the shop saying it outright, and what
                                        is said here comes first. Leave it
                                        empty and the guess is used, which is
                                        the right default for most of a menu.
                                    -->
                                    <div class="form-group col-md-12">
                                        <label for="item_goes_with"><lang class="lang_goes_with">Goes well with</lang></label>
                                        <select class="form-control border-control select2" id="item_goes_with"
                                            name="item_goes_with" multiple="multiple"
                                            data-placeholder="Worked out from what sells together"
                                            data-t-placeholder="lang_goes_with_placeholder"></select>
                                        <small class="form-text text-muted">
                                            <lang class="lang_goes_with_help">Offered to a customer who has ordered this. Leave it empty and the shop works it out from what sells on the same bill.</lang>
                                        </small>
                                    </div>"""
assert s.count(old) == 1, 'form markup: ' + str(s.count(old))
io.open(p, 'w', encoding='utf-8', newline='').write(s.replace(old, new))
print('markup done')

# --- 2. the form reads and writes it
p = ROOT + 'frontend/static/script/js/modules/js/items.js'
s = io.open(p, encoding='utf-8', newline='').read()

sends = s.count("            daypart_ids: $('#item_dayparts').val() || [],")
sends += s.count("                    daypart_ids: $('#item_dayparts').val() || [],")
assert sends == 2, 'send sites: ' + str(sends)
s = s.replace(
    "            daypart_ids: $('#item_dayparts').val() || [],",
    "            daypart_ids: $('#item_dayparts').val() || [],\n            /* What the shop says goes with this dish; empty means work it\n               out from what sells on the same bill. */\n            goes_with: $('#item_goes_with').val() || [],",
)
s = s.replace(
    "                    daypart_ids: $('#item_dayparts').val() || [],",
    "                    daypart_ids: $('#item_dayparts').val() || [],\n                    goes_with: $('#item_goes_with').val() || [],",
)

loads = s.count("                PosnicPro.itemDayparts.set(data.daypart_ids || []);")
assert loads == 2, 'load sites: ' + str(loads)
s = s.replace(
    "                PosnicPro.itemDayparts.set(data.daypart_ids || []);",
    "                PosnicPro.itemDayparts.set(data.daypart_ids || []);\n                PosnicPro.itemGoesWith.set(data.goes_with || []);",
)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('form wiring done')
