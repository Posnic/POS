/*
---------------------------------------
    : Custom - Table Footable js :
---------------------------------------
*/
"use strict";
$(document).ready(function() {
    /* -- Table - Footable -- */
    $('.foo-basic-table').footable();
    $('.foo-filtering-table').footable();
    $('.foo-pagination-table').footable({
		"columns": $.get('./static/plugins/footable/columns.json'),
		"rows": $.get('./static/plugins/footable/rows.json')
	});
});